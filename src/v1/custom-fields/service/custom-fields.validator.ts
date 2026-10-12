/**
 * Validator: the request parsing and the business refusals (BE-09: an expected failure is an
 * `AppError` the shared filter maps to problem details; nothing here throws a Nest exception).
 *
 * The list is parsed by `shared/http/pagination.ts`'s `parseListQuery` (BE-19), then this file adds
 * what a keyset list needs: ONE sort segment from `CUSTOM_FIELDS_SORT_FIELDS`, the opaque cursor
 * decoded for that sort with the right kind of value (`false` stands for a NULL `fieldto` or
 * `field_order`), `?q=` bounded, and the one filter the screen offers, `filter[fieldto][in]`, whose
 * values must be entities Perfex's Setup offers. Any other filter is a 400 on `filter`. The module
 * takes no body: it serves read routes only.
 */
import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import {
  LIST_QUERY_LIMITS,
  parseListQuery,
  type ListFilter,
} from '../../../shared/http/pagination.js';
import { CUSTOM_FIELD_ENTITIES } from '../custom-fields.routes.js';
import {
  CUSTOM_FIELDS_SEARCH_MAX,
  customFieldsParamsSchema,
  type CustomFieldsParams,
} from '../dto/custom-fields.dto.js';
import type {
  CustomFieldsListRequest,
  CustomFieldsSortField,
} from '../model/custom-fields.model.js';

/** The columns `?sort=` accepts (and the one filter field); the first is the default (ascending). */
export const CUSTOM_FIELDS_SORT_FIELDS = [
  'id',
  'name',
  'fieldto',
  'type',
  'fieldOrder',
] as const satisfies readonly CustomFieldsSortField[];

/** The kind of value each sort column's cursor carries; `false` is a NULL of a nullable column. */
const SORT_KINDS: Readonly<Record<CustomFieldsSortField, readonly string[]>> = {
  id: ['number'],
  name: ['string'],
  fieldto: ['string', 'boolean'],
  type: ['string'],
  fieldOrder: ['number', 'boolean'],
};

const ENTITIES: ReadonlySet<string> = new Set(CUSTOM_FIELD_ENTITIES);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuse(detail: string, path: readonly (string | number)[], message: string): never {
  throw new AppError('ERP-VALIDATION-0001', detail, { issues: [{ path: [...path], message }] });
}

/** The last value of a repeated query key. */
function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const last: unknown = value.at(-1);
    return typeof last === 'string' ? last : null;
  }
  return null;
}

function parse<T>(schema: z.ZodType<T>, input: unknown, detail: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new AppError('ERP-VALIDATION-0001', detail, { issues: parsed.error.issues });
  return parsed.data;
}

function parseSearch(input: unknown): string | null {
  const search = scalar(isRecord(input) ? input.q : undefined);
  if (search !== null && search.length > CUSTOM_FIELDS_SEARCH_MAX) {
    refuse(
      'Query is invalid',
      ['q'],
      `q must be at most ${String(CUSTOM_FIELDS_SEARCH_MAX)} characters`,
    );
  }
  return search === '' ? null : search;
}

/** `filter[fieldto][in]` (the only filter) as its entities, or `null` when absent. */
function parseFieldtoFilter(
  filters: readonly ListFilter<CustomFieldsSortField>[],
): readonly string[] | null {
  const [filter, ...more] = filters;
  if (filter === undefined) return null;
  if (more.length > 0 || filter.field !== 'fieldto' || filter.op !== 'in') {
    refuse('Query is invalid', ['filter'], 'this list takes only filter[fieldto][in]');
  }
  const values = typeof filter.value === 'string' ? [filter.value] : filter.value;
  if (!values.every((value) => ENTITIES.has(value))) {
    refuse(
      'Query is invalid',
      ['filter'],
      'filter[fieldto][in] names an entity Setup does not offer',
    );
  }
  return values;
}

@Injectable()
export class CustomFieldsValidator {
  /** `GET` list: BE-19's grammar, one keyset sort, the cursor bound to it, `q`, `filter[fieldto][in]`. */
  parseListQuery(input: unknown): CustomFieldsListRequest {
    const query = parseListQuery(input, CUSTOM_FIELDS_SORT_FIELDS);
    const fieldto = parseFieldtoFilter(query.filters);
    const [first, ...rest] = query.sort;
    if (rest.length > 0)
      refuse('Query is invalid', ['sort'], 'the list sorts on one field at a time');
    const sortField = first?.field ?? CUSTOM_FIELDS_SORT_FIELDS[0];
    const cursor = decodeCursor(query.cursor, sortField);
    if (cursor !== null && !SORT_KINDS[sortField].includes(typeof cursor.key[0])) {
      refuse('Query is invalid', ['cursor'], 'cursor is not a cursor of this list');
    }
    return {
      search: parseSearch(input),
      fieldto,
      sortField,
      order: first?.direction ?? 'asc',
      cursor,
      limit: query.limit,
    };
  }

  /** `GET export`: the list's query from the first row in batches of the list maximum. */
  parseExportList(input: unknown): CustomFieldsListRequest {
    return { ...this.parseListQuery(input), cursor: null, limit: LIST_QUERY_LIMITS.max };
  }

  /** `:id`: a non-numeric or non-positive id is a 400, never a 404 probe. */
  parseParams(input: unknown): CustomFieldsParams {
    return parse(customFieldsParamsSchema, input, 'Path parameter is invalid');
  }
}
