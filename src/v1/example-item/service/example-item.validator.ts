/**
 * Validator: the request parsing and the business refusals (BE-09: an expected failure is an
 * `AppError` the shared filter maps to problem details; nothing here throws a Nest exception — the
 * architecture block in `eslint.config.mjs` rejects the import).
 *
 * The list is parsed by `shared/http/pagination.ts`'s `parseListQuery` (BE-19: `limit`, `cursor`,
 * `sort`; `page`/`size` refused), then this file adds what a keyset list needs: ONE sort segment
 * from `EXAMPLE_ITEM_SORT_FIELDS`, the opaque cursor decoded for that sort (`shared/http/keyset.ts`)
 * with the right kind of value, and `?q=` bounded. This list takes no filter: any `filter[…]` is a
 * 400 on `filter`. A module that adds a filter adds its field here and in the repository's match,
 * never silently drops one.
 */
import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS, parseListQuery } from '../../../shared/http/pagination.js';
import {
  createExampleItemBodySchema,
  EXAMPLE_ITEM_SEARCH_MAX,
  exampleItemParamsSchema,
  updateExampleItemBodySchema,
  type CreateExampleItemBody,
  type ExampleItemParams,
  type UpdateExampleItemBody,
} from '../dto/example-item.dto.js';
import type { ExampleItemListRequest, ExampleItemSortField } from '../model/example-item.model.js';

/** The columns `?sort=` accepts; the first is the default (ascending). */
export const EXAMPLE_ITEM_SORT_FIELDS = [
  'id',
  'name',
] as const satisfies readonly ExampleItemSortField[];

/** The kind of value each sort column's cursor must carry: a decoded cursor is checked, not trusted. */
const SORT_KINDS = { id: 'number', name: 'string' } as const satisfies Record<
  ExampleItemSortField,
  'number' | 'string'
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuse(detail: string, path: readonly (string | number)[], message: string): never {
  throw new AppError('ERP-VALIDATION-0001', detail, { issues: [{ path: [...path], message }] });
}

/** The last value of a repeated query key, as `pagination.ts` reads one. */
function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const last: unknown = value.at(-1);
    return typeof last === 'string' ? last : null;
  }
  return null;
}

/** `safeParse` → `AppError('ERP-VALIDATION-0001')` with the zod issues (BE-09). */
function parse<T>(schema: z.ZodType<T>, input: unknown, detail: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new AppError('ERP-VALIDATION-0001', detail, { issues: parsed.error.issues });
  return parsed.data;
}

/** `?q=`: the last value, at most `EXAMPLE_ITEM_SEARCH_MAX` characters; an empty one is no search. */
function parseSearch(input: unknown): string | null {
  const search = scalar(isRecord(input) ? input.q : undefined);
  if (search !== null && search.length > EXAMPLE_ITEM_SEARCH_MAX) {
    refuse(
      'Query is invalid',
      ['q'],
      `q must be at most ${String(EXAMPLE_ITEM_SEARCH_MAX)} characters`,
    );
  }
  return search === '' ? null : search;
}

@Injectable()
export class ExampleItemValidator {
  /** `GET` list: BE-19's grammar, one keyset sort, the cursor bound to it, `q`; no filter. */
  parseListQuery(input: unknown): ExampleItemListRequest {
    const query = parseListQuery(input, EXAMPLE_ITEM_SORT_FIELDS);
    if (query.filters.length > 0)
      refuse('Query is invalid', ['filter'], 'this list takes no filter');
    const [first, ...rest] = query.sort;
    if (rest.length > 0)
      refuse('Query is invalid', ['sort'], 'the list sorts on one field at a time');
    const sortField = first?.field ?? EXAMPLE_ITEM_SORT_FIELDS[0];
    const cursor = decodeCursor(query.cursor, sortField);
    if (cursor !== null && typeof cursor.key[0] !== SORT_KINDS[sortField]) {
      refuse('Query is invalid', ['cursor'], 'cursor is not a cursor of this list');
    }
    const search = parseSearch(input);
    return {
      search,
      sortField,
      order: first?.direction ?? 'asc',
      cursor,
      limit: query.limit,
    };
  }

  /**
   * `GET export`: the list's query (`q`, one sort), read from the first row in batches of the list
   * maximum. The export parameters (`format`, `column`, `header`, `key`, the presentation ones)
   * and the refusal of `limit` and `cursor` are the shared core's (`parseExportOptions`,
   * `shared/http/export.ts`), which the service runs first.
   */
  parseExportList(input: unknown): ExampleItemListRequest {
    return { ...this.parseListQuery(input), cursor: null, limit: LIST_QUERY_LIMITS.max };
  }

  /** `:id`: a non-numeric or non-positive id is a 400, never a 404 probe. */
  parseParams(input: unknown): ExampleItemParams {
    return parse(exampleItemParamsSchema, input, 'Path parameter is invalid');
  }

  /** `POST`: `{ name }`, strict (mass assignment is a 400 naming the key). */
  parseCreateBody(input: unknown): CreateExampleItemBody {
    return parse(createExampleItemBodySchema, input, 'Request body is invalid');
  }

  /** `PATCH :id`: any part of the create body, but not nothing (a 400 on the body, path `[]`). */
  parseUpdateBody(input: unknown): UpdateExampleItemBody {
    const body = parse(updateExampleItemBodySchema, input, 'Request body is invalid');
    if (Object.keys(body).length === 0)
      refuse('Request body is invalid', [], 'send at least one field');
    return body;
  }
}
