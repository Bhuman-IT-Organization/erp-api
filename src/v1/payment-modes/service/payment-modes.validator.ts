/**
 * Validator: the request parsing (BE-09: an expected failure is an `AppError` the shared filter
 * maps to problem details; nothing here throws a Nest exception, the architecture block in
 * `eslint.config.mjs` rejects the import).
 *
 * The list is parsed by `shared/http/pagination.ts`'s `parseListQuery` (BE-19: `limit`, `cursor`,
 * `sort`; `page`/`size` refused), then this file adds what a keyset list needs: ONE sort segment
 * from `PAYMENT_MODES_SORT_FIELDS` (default `name` ascending, Perfex's DataTable order `[1, 'asc']`,
 * `views/admin/paymentmodes/manage.php:35`), the opaque cursor decoded for that sort
 * (`shared/http/keyset.ts`) with the right kind of value, and `?q=` bounded. This list takes no
 * filter: any `filter[...]` is a 400 on `filter`. The description is not a sort: it is a nullable
 * MEDIUMTEXT and the shared keyset admits only NOT NULL columns; `active` is (a NOT NULL boolean).
 *
 * `?q=` is matched by the repository: the name or the description contains it (case per the
 * columns' collation); when it is all digits and fits the INT id column, also the id equal to it.
 * Perfex's DataTable searched the id, the name, the description and the Active cell's export word;
 * the difference is in the README's parity table.
 */
import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS, parseListQuery } from '../../../shared/http/pagination.js';
import {
  PAYMENT_MODES_SEARCH_MAX,
  paymentModesActiveBodySchema,
  paymentModesBodySchema,
  paymentModesParamsSchema,
  type PaymentModesActiveBody,
  type PaymentModesBody,
  type PaymentModesParams,
} from '../dto/payment-modes.dto.js';
import type {
  PaymentModesListRequest,
  PaymentModesSortField,
} from '../model/payment-modes.model.js';

/** The columns `?sort=` accepts. With no `sort`, the list reads the name ascending (Perfex's order). */
export const PAYMENT_MODES_SORT_FIELDS = [
  'name',
  'id',
  'active',
] as const satisfies readonly PaymentModesSortField[];

/** The sort with no `?sort=`: the name ascending, Perfex's DataTable `[1, 'asc']`. */
const DEFAULT_SORT = { field: 'name', direction: 'asc' } as const;

/** The kind of value each sort column's cursor must carry: a decoded cursor is checked, not trusted. */
const SORT_KINDS = { name: 'string', id: 'number', active: 'boolean' } as const satisfies Record<
  PaymentModesSortField,
  'number' | 'string' | 'boolean'
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

/** `safeParse` -> `AppError('ERP-VALIDATION-0001')` with the zod issues (BE-09). */
function parse<T>(schema: z.ZodType<T>, input: unknown, detail: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new AppError('ERP-VALIDATION-0001', detail, { issues: parsed.error.issues });
  return parsed.data;
}

/** `?q=`: the last value, at most `PAYMENT_MODES_SEARCH_MAX` characters; an empty one is no search. */
function parseSearch(input: unknown): string | null {
  const search = scalar(isRecord(input) ? input.q : undefined);
  if (search !== null && search.length > PAYMENT_MODES_SEARCH_MAX) {
    refuse(
      'Query is invalid',
      ['q'],
      `q must be at most ${String(PAYMENT_MODES_SEARCH_MAX)} characters`,
    );
  }
  return search === '' ? null : search;
}

@Injectable()
export class PaymentModesValidator {
  /** `GET` list: BE-19's grammar, one keyset sort (default `name`), the cursor bound to it, `q`. */
  parseListQuery(input: unknown): PaymentModesListRequest {
    const query = parseListQuery(input, PAYMENT_MODES_SORT_FIELDS);
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
  parseExportList(input: unknown): PaymentModesListRequest {
    return { ...this.parseListQuery(input), cursor: null, limit: LIST_QUERY_LIMITS.max };
  }

  /** `:id`: a non-numeric or non-positive id is a 400, never a 404 probe. */
  parseParams(input: unknown): PaymentModesParams {
    return parse(paymentModesParamsSchema, input, 'Path parameter is invalid');
  }

  /** `POST`: the seven fields, strict (any other key is a 400 naming it, D-35); the name trimmed, 1 to 100. */
  parseCreateBody(input: unknown): PaymentModesBody {
    return parse(paymentModesBodySchema, input, 'Request body is invalid');
  }

  /** `PATCH :id`: the same seven fields; `{}` is a 400 on `['name']` (Perfex's edit rewrites all seven). */
  parseUpdateBody(input: unknown): PaymentModesBody {
    return parse(paymentModesBodySchema, input, 'Request body is invalid');
  }

  /** `PATCH :id/active`: `{ active }`, a boolean, strict. */
  parseActiveBody(input: unknown): PaymentModesActiveBody {
    return parse(paymentModesActiveBodySchema, input, 'Request body is invalid');
  }
}
