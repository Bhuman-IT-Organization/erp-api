/**
 * Validator: the request parsing and the business refusals (BE-09: an expected failure is an
 * `AppError` the shared filter maps to problem details; nothing here throws a Nest exception (the
 * architecture block in `eslint.config.mjs` rejects the import).
 *
 * The list is parsed by `shared/http/pagination.ts`'s `parseListQuery` (BE-19: `limit`, `cursor`,
 * `sort`; `page`/`size` refused), then this file adds what a keyset list needs: ONE sort segment
 * from `EXPENSE_CATEGORIES_SORT_FIELDS`, the opaque cursor decoded for that sort (`shared/http/keyset.ts`)
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
  createExpenseCategoriesBodySchema,
  EXPENSE_CATEGORIES_SEARCH_MAX,
  expenseCategoriesParamsSchema,
  updateExpenseCategoriesBodySchema,
  type CreateExpenseCategoriesBody,
  type ExpenseCategoriesParams,
  type UpdateExpenseCategoriesBody,
} from '../dto/expense-categories.dto.js';
import type {
  ExpenseCategoriesListRequest,
  ExpenseCategoriesSortField,
} from '../model/expense-categories.model.js';

/**
 * The columns `?sort=` accepts; the first is the default (ascending). `name` comes first because
 * Perfex's list opens sorted by name ascending (its `[1,'asc']`); the description is not a keyset
 * key (D-41 precedent).
 */
export const EXPENSE_CATEGORIES_SORT_FIELDS = [
  'name',
  'id',
] as const satisfies readonly ExpenseCategoriesSortField[];

/** The kind of value each sort column's cursor must carry: a decoded cursor is checked, not trusted. */
const SORT_KINDS = { name: 'string', id: 'number' } as const satisfies Record<
  ExpenseCategoriesSortField,
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

/**
 * `?q=`: the last value, at most `EXPENSE_CATEGORIES_SEARCH_MAX` characters; an empty one is no
 * search. The repository matches it against the name or the description (contains).
 */
function parseSearch(input: unknown): string | null {
  const search = scalar(isRecord(input) ? input.q : undefined);
  if (search !== null && search.length > EXPENSE_CATEGORIES_SEARCH_MAX) {
    refuse(
      'Query is invalid',
      ['q'],
      `q must be at most ${String(EXPENSE_CATEGORIES_SEARCH_MAX)} characters`,
    );
  }
  return search === '' ? null : search;
}

@Injectable()
export class ExpenseCategoriesValidator {
  /** `GET` list: BE-19's grammar, one keyset sort, the cursor bound to it, `q`; no filter. */
  parseListQuery(input: unknown): ExpenseCategoriesListRequest {
    const query = parseListQuery(input, EXPENSE_CATEGORIES_SORT_FIELDS);
    if (query.filters.length > 0)
      refuse('Query is invalid', ['filter'], 'this list takes no filter');
    const [first, ...rest] = query.sort;
    if (rest.length > 0)
      refuse('Query is invalid', ['sort'], 'the list sorts on one field at a time');
    const sortField = first?.field ?? EXPENSE_CATEGORIES_SORT_FIELDS[0];
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
   * maximum. The export parameters and the refusal of `limit` and `cursor` are the shared core's
   * (`parseExportOptions`, `shared/http/export.ts`), which the service runs first.
   */
  parseExportList(input: unknown): ExpenseCategoriesListRequest {
    return { ...this.parseListQuery(input), cursor: null, limit: LIST_QUERY_LIMITS.max };
  }

  /** `:id`: a non-numeric or non-positive id is a 400, never a 404 probe. */
  parseParams(input: unknown): ExpenseCategoriesParams {
    return parse(expenseCategoriesParamsSchema, input, 'Path parameter is invalid');
  }

  /**
   * `POST`: `{ name, description? }`, strict (mass assignment is a 400 naming the key). D-19: the
   * name is trimmed and bounded and no character is refused; the description has no Node cap.
   */
  parseCreateBody(input: unknown): CreateExpenseCategoriesBody {
    return parse(createExpenseCategoriesBodySchema, input, 'Request body is invalid');
  }

  /** `PATCH :id`: any part of the create body, but not nothing (a 400 on the body, path `[]`). */
  parseUpdateBody(input: unknown): UpdateExpenseCategoriesBody {
    const body = parse(updateExpenseCategoriesBodySchema, input, 'Request body is invalid');
    if (Object.keys(body).length === 0)
      refuse('Request body is invalid', [], 'send at least one field');
    return body;
  }
}
