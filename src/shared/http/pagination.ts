/**
 * The BE-19 list grammar: keyset paging, filtering and sorting, parsed once for every module.
 *
 * BE-19 reserves this file until the first module that needs filtering or sorting is built; that
 * module is `v1/identity` (the staff list has a search box and an `active` filter), so it is built
 * here, by its first consumer, with a spec case per operator and per rejection.
 *
 * The grammar, verbatim from BE-19:
 *   paging      `?limit=<1..500, default 50>&cursor=<opaque>` — keyset, **never `page`/`size`**
 *   filtering   `?filter[<field>]=<value>` or `?filter[<field>][<op>]=<value>`
 *               over `eq, ne, gt, gte, lt, lte, in, like` (a bare filter means `eq`)
 *   sorting     `?sort=-<field>,<field>` (leading `-` descending)
 *
 * Fastify parses a query string with `node:querystring`, which does no bracket nesting, so the
 * request object carries flat keys such as `'filter[name][like]'`. A parser that only understood a
 * nested `{ filter: { name: { like: … } } }` object would silently see no filters at all, so both
 * shapes are read.
 *
 * Every refusal is `ERP-VALIDATION-0001` (400) with zod-shaped issues, the same code and shape a
 * module validator produces (BE-09), so a caller cannot tell a shared parser from a module one.
 *
 * What this does NOT do: it does not build SQL. It returns a checked, typed description of the
 * request; the repository decides how to express it, which is where the keyset cursor and the
 * bound parameters live.
 */
import { AppError } from '../errors/app-error.js';

/** BE-19's paging bounds. `limit` outside them is a 400, never a silent clamp. */
export const LIST_QUERY_LIMITS = { min: 1, max: 500, default: 50 } as const;

/** BE-19's eight filter operators. A bare `filter[field]=v` means `eq`. */
export const FILTER_OPERATORS = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'like'] as const;

export type FilterOperator = (typeof FILTER_OPERATORS)[number];

/**
 * Paging is keyset. The two offset spellings BE-19 forbids are a 400, never silently ignored — a
 * caller that thinks it is paging by offset must be told it is not.
 */
export const FORBIDDEN_PAGING_KEY = /^(page|size)$/;

/**
 * The cursor is opaque to this parser: it only checks it is a plausible token, never decodes it.
 * The cap is 4096 characters because the boundary row's sort value travels in the cursor
 * (`keyset.ts` `encodeCursor`): 512 stopped the next page of a 191-character Arabic name, and 4096
 * covers every capped name, Arabic included. A longer sort value on a page boundary is a known limit
 * (plan 04.10-02, the cursor decision (a), the lead's planning answer 1 of 2026-10-06).
 */
const CURSOR_MAX_LENGTH = 4096;
const CURSOR_PATTERN = /^[A-Za-z0-9_.~-]+$/;

/** `in` values arrive comma-separated: `filter[id][in]=1,2,3`. */
const IN_SEPARATOR = ',';

export interface ListFilter<TField extends string> {
  readonly field: TField;
  readonly op: FilterOperator;
  readonly value: string | readonly string[];
}

export interface ListSort<TField extends string> {
  readonly field: TField;
  readonly direction: 'asc' | 'desc';
}

export interface ListQuery<TField extends string> {
  readonly limit: number;
  readonly cursor: string | null;
  readonly filters: readonly ListFilter<TField>[];
  readonly sort: readonly ListSort<TField>[];
}

interface Issue {
  readonly path: readonly string[];
  readonly message: string;
}

/** `filter[field]` or `filter[field][op]` as Fastify's flat query parser leaves it. */
const FLAT_FILTER_KEY = /^filter\[([^[\]]+)\](?:\[([^[\]]+)\])?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The last value wins when a key repeats, which is what `querystring.parse` arrays mean here. */
function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const last: unknown = value[value.length - 1];
    return typeof last === 'string' ? last : undefined;
  }
  return undefined;
}

function isFilterOperator(op: string): op is FilterOperator {
  return (FILTER_OPERATORS as readonly string[]).includes(op);
}

function parseLimit(raw: string | undefined, issues: Issue[]): number {
  if (raw === undefined || raw === '') return LIST_QUERY_LIMITS.default;
  const value = Number(raw);
  const whole = Number.isInteger(value);
  if (!whole || value < LIST_QUERY_LIMITS.min || value > LIST_QUERY_LIMITS.max) {
    issues.push({
      path: ['limit'],
      message: `limit must be an integer between ${String(LIST_QUERY_LIMITS.min)} and ${String(
        LIST_QUERY_LIMITS.max,
      )}`,
    });
    return LIST_QUERY_LIMITS.default;
  }
  return value;
}

function parseCursor(raw: string | undefined, issues: Issue[]): string | null {
  if (raw === undefined || raw === '') return null;
  if (raw.length > CURSOR_MAX_LENGTH || !CURSOR_PATTERN.test(raw)) {
    issues.push({ path: ['cursor'], message: 'cursor is malformed' });
    return null;
  }
  return raw;
}

/** Collects `field -> op -> value` from both the flat and the nested query shapes. */
function collectFilterPairs(query: Record<string, unknown>): [string, string, unknown][] {
  const pairs: [string, string, unknown][] = [];
  for (const [key, value] of Object.entries(query)) {
    const match = FLAT_FILTER_KEY.exec(key);
    if (match?.[1] !== undefined) pairs.push([match[1], match[2] ?? 'eq', value]);
  }
  const nested: unknown = query.filter;
  if (isRecord(nested)) {
    for (const [field, byOp] of Object.entries(nested)) {
      if (isRecord(byOp)) {
        for (const [op, value] of Object.entries(byOp)) pairs.push([field, op, value]);
      } else {
        pairs.push([field, 'eq', byOp]);
      }
    }
  }
  return pairs;
}

function parseFilters<TField extends string>(
  query: Record<string, unknown>,
  allowed: readonly TField[],
  issues: Issue[],
): ListFilter<TField>[] {
  const filters: ListFilter<TField>[] = [];
  for (const [field, op, rawValue] of collectFilterPairs(query)) {
    const path = ['filter', field, op];
    if (!(allowed as readonly string[]).includes(field)) {
      issues.push({ path, message: `unknown filter field "${field}"` });
      continue;
    }
    if (!isFilterOperator(op)) {
      issues.push({ path, message: `unknown filter operator "${op}"` });
      continue;
    }
    const value = scalar(rawValue);
    if (value === undefined) {
      issues.push({ path, message: 'filter value must be a string' });
      continue;
    }
    if (op === 'in') {
      const parts = value.split(IN_SEPARATOR).map((part) => part.trim());
      if (parts.some((part) => part === '')) {
        issues.push({ path, message: 'in expects a non-empty comma-separated list' });
        continue;
      }
      filters.push({ field: field as TField, op, value: parts });
      continue;
    }
    filters.push({ field: field as TField, op, value });
  }
  return filters;
}

function parseSort<TField extends string>(
  raw: string | undefined,
  allowed: readonly TField[],
  issues: Issue[],
): ListSort<TField>[] {
  if (raw === undefined || raw === '') return [];
  const sort: ListSort<TField>[] = [];
  const seen = new Set<string>();
  for (const segment of raw.split(',')) {
    const trimmed = segment.trim();
    const descending = trimmed.startsWith('-');
    const field = descending ? trimmed.slice(1) : trimmed;
    if (field === '') {
      issues.push({ path: ['sort'], message: 'sort has an empty field' });
      continue;
    }
    if (!(allowed as readonly string[]).includes(field)) {
      issues.push({ path: ['sort'], message: `unknown sort field "${field}"` });
      continue;
    }
    if (seen.has(field)) {
      issues.push({ path: ['sort'], message: `sort names "${field}" more than once` });
      continue;
    }
    seen.add(field);
    sort.push({ field: field as TField, direction: descending ? 'desc' : 'asc' });
  }
  return sort;
}

/**
 * Parses BE-19's list query. `allowedFields` is the endpoint's allowlist: a field outside it is a
 * 400, never a silently dropped filter, so a caller cannot probe columns the endpoint does not
 * expose. Rejects an unknown field, an unknown operator, `page`/`size`, a limit out of range and a
 * malformed cursor with `ERP-VALIDATION-0001`.
 */
export function parseListQuery<TField extends string>(
  input: unknown,
  allowedFields: readonly TField[],
): ListQuery<TField> {
  const query = isRecord(input) ? input : {};
  const issues: Issue[] = [];

  for (const key of Object.keys(query)) {
    if (FORBIDDEN_PAGING_KEY.test(key)) {
      issues.push({
        path: [key],
        message: `paging is keyset: use limit and cursor, never ${key}`,
      });
    }
  }

  const limit = parseLimit(scalar(query.limit), issues);
  const cursor = parseCursor(scalar(query.cursor), issues);
  const filters = parseFilters(query, allowedFields, issues);
  const sort = parseSort(scalar(query.sort), allowedFields, issues);

  if (issues.length > 0) {
    throw new AppError('ERP-VALIDATION-0001', 'Query is invalid', { issues });
  }
  return { limit, cursor, filters, sort };
}
