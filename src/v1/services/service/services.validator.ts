/**
 * Validator: the request parsing (BE-09: an expected failure is an `AppError`; nothing here throws
 * a Nest exception). The list is parsed by `shared/http/pagination.ts`'s `parseListQuery` (BE-19),
 * then this file adds ONE sort segment (default `name` ascending, Perfex's order), the cursor decoded for that
 * sort, and `?q=` bounded. This list takes no filter.
 */
import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS, parseListQuery } from '../../../shared/http/pagination.js';
import {
  createServicesBodySchema,
  SERVICES_SEARCH_MAX,
  servicesParamsSchema,
  updateServicesBodySchema,
  type CreateServicesBody,
  type ServicesParams,
  type UpdateServicesBody,
} from '../dto/services.dto.js';
import type { ServicesListRequest, ServicesSortField } from '../model/services.model.js';

/** The columns `?sort=` accepts. With no `sort`, the list reads `name` ascending. */
export const SERVICES_SORT_FIELDS = ['id', 'name'] as const satisfies readonly ServicesSortField[];

/** The sort with no `?sort=`: the name ascending, Perfex's `[1,'asc']`. */
const DEFAULT_SORT = { field: 'name', direction: 'asc' } as const;

/** The kind of value each sort column's cursor must carry: a decoded cursor is checked, not trusted. */
const SORT_KINDS = { id: 'number', name: 'string' } as const satisfies Record<
  ServicesSortField,
  'number' | 'string'
>;

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

/** `safeParse` -> `AppError('ERP-VALIDATION-0001')` with the zod issues (BE-09). */
function parse<T>(schema: z.ZodType<T>, input: unknown, detail: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new AppError('ERP-VALIDATION-0001', detail, { issues: parsed.error.issues });
  return parsed.data;
}

/** `?q=`: the last value, at most `SERVICES_SEARCH_MAX` characters; an empty one is no search. */
function parseSearch(input: unknown): string | null {
  const search = scalar(isRecord(input) ? input.q : undefined);
  if (search !== null && search.length > SERVICES_SEARCH_MAX) {
    refuse(
      'Query is invalid',
      ['q'],
      `q must be at most ${String(SERVICES_SEARCH_MAX)} characters`,
    );
  }
  return search === '' ? null : search;
}

@Injectable()
export class ServicesValidator {
  /** `GET` list: BE-19's grammar, one keyset sort (default `name` ascending), the cursor bound to it, `q`. */
  parseListQuery(input: unknown): ServicesListRequest {
    const query = parseListQuery(input, SERVICES_SORT_FIELDS);
    if (query.filters.length > 0)
      refuse('Query is invalid', ['filter'], 'this list takes no filter');
    const [first, ...rest] = query.sort;
    if (rest.length > 0)
      refuse('Query is invalid', ['sort'], 'the list sorts on one field at a time');
    const sort = first ?? DEFAULT_SORT;
    const cursor = decodeCursor(query.cursor, sort.field);
    if (cursor !== null && typeof cursor.key[0] !== SORT_KINDS[sort.field]) {
      refuse('Query is invalid', ['cursor'], 'cursor is not a cursor of this list');
    }
    return {
      search: parseSearch(input),
      sortField: sort.field,
      order: sort.direction,
      cursor,
      limit: query.limit,
    };
  }

  /**
   * `GET export`: the list's query (`q`, one sort), read from the first row in batches of the list
   * maximum. The export parameters and the refusal of `limit` and `cursor` are the shared core's
   * (`parseExportOptions`, `shared/http/export.ts`), which the service runs first.
   */
  parseExportList(input: unknown): ServicesListRequest {
    return { ...this.parseListQuery(input), cursor: null, limit: LIST_QUERY_LIMITS.max };
  }

  /** `:id`: a non-numeric or non-positive id is a 400, never a 404 probe. */
  parseParams(input: unknown): ServicesParams {
    return parse(servicesParamsSchema, input, 'Path parameter is invalid');
  }

  /** `POST`: `{ name }`, strict; trimmed, 1 to 50 characters. */
  parseCreateBody(input: unknown): CreateServicesBody {
    return parse(createServicesBodySchema, input, 'Request body is invalid');
  }

  /** `PATCH :id`: the same body. */
  parseUpdateBody(input: unknown): UpdateServicesBody {
    return parse(updateServicesBodySchema, input, 'Request body is invalid');
  }
}
