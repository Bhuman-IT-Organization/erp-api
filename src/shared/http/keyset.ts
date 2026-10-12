/**
 * The keyset half of BE-19's list grammar: the opaque cursor, the "rows strictly after (or before)
 * this row" predicate, the in-memory comparator, and the list meta — written once, here, for every
 * list that pages on `(sortField, id)`.
 *
 * `pagination.ts` parses the query and treats the cursor as an opaque token; this file is what
 * gives the token a meaning. A list that sorts on any column other than its id cannot page on the
 * id alone (two rows may share a first name), so the cursor carries the sort column's value AND the
 * id, and the predicate breaks ties on the id. The same file serves the repository (the predicate),
 * the test fakes (the comparator) and the next module, because a keyset re-implemented in each of
 * them drifts (the "five-file" lesson).
 *
 * What this does NOT do: it never imports Prisma and never builds SQL. The predicate is a plain
 * object the repository hands to Prisma, so every value in it reaches the database as a bound
 * parameter, and every column name in it is the caller's constant, never a string from the cursor.
 */
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';

/** Which side of the cursor row the next page lies on: `after` is Next, `before` is Previous. */
export type CursorDirection = 'after' | 'before';

/** A sort column's value as a cursor carries it. Every sortable column is NOT NULL, so no `null`. */
export type KeyValue = string | number | boolean;

/** A checked cursor: the sort it was minted for, the `[value, id]` of its row, and its direction. */
export interface DecodedCursor<TField extends string> {
  /** The sort field the cursor was minted for; a cursor is refused under any other sort. */
  readonly sort: TField;
  /** `[value of the sort column, id]` of the row the cursor points at. */
  readonly key: readonly [KeyValue, number];
  readonly direction: CursorDirection;
}

/** The wire form of a cursor, before it is trusted: strict, so an extra key is also a refusal. */
const cursorPayloadSchema = z.strictObject({
  s: z.string().min(1),
  k: z.tuple([z.union([z.string(), z.number(), z.boolean()]), z.number().int()]),
  d: z.enum(['after', 'before']),
});

/** Every refusal of this file: the one validation code, on the `cursor` path, as pagination.ts does. */
function refuseCursor(): never {
  throw new AppError('ERP-VALIDATION-0001', 'Query is invalid', {
    issues: [{ path: ['cursor'], message: 'cursor is not a cursor of this list' }],
  });
}

/**
 * The opaque cursor: base64url, no padding, of `{"s": sort, "k": [value, id], "d": direction}`. The
 * alphabet is `[A-Za-z0-9_-]`, a subset of `pagination.ts`'s `CURSOR_PATTERN`, so the shared parser
 * admits every cursor this file mints. Opaque is a promise to the caller, not a secret: the cursor is
 * not signed, so `decodeCursor` checks everything it carries.
 */
export function encodeCursor(
  sort: string,
  key: readonly [KeyValue, number],
  direction: CursorDirection,
): string {
  return Buffer.from(JSON.stringify({ s: sort, k: key, d: direction }), 'utf8').toString(
    'base64url',
  );
}

/**
 * `null` for a `null` cursor (the first page). Otherwise the checked cursor, or a 400
 * `ERP-VALIDATION-0001` on the `cursor` path when the token is not base64url JSON, has any other
 * shape, or was minted for another sort than `expectedSort` — a cursor from a `firstName` page sent
 * with `sort=email` would otherwise start the page at a meaningless row. Never a silent first page.
 */
export function decodeCursor<TField extends string>(
  raw: string | null,
  expectedSort: TField,
): DecodedCursor<TField> | null {
  if (raw === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    return refuseCursor();
  }
  const parsed = cursorPayloadSchema.safeParse(payload);
  if (!parsed.success || parsed.data.s !== expectedSort) return refuseCursor();
  return { sort: expectedSort, key: parsed.data.k, direction: parsed.data.d };
}

/**
 * The Prisma-shaped predicate "rows strictly after (or before) the cursor row in this order":
 * `{ OR: [ { [column]: { [op]: value } }, { [column]: value, [idColumn]: { [op]: id } } ] }`, with
 * `op` = `gt` for (asc, after) and (desc, before), `lt` for (asc, before) and (desc, after). The id
 * breaks ties, so a page boundary between two equal names loses and repeats no row. When the list
 * sorts by the id itself (`column === idColumn`) both branches collapse to "id strictly after",
 * which is still exactly right.
 */
export function keysetWhere(
  column: string,
  idColumn: string,
  cursor: DecodedCursor<string>,
  order: 'asc' | 'desc',
): Record<string, unknown> {
  const op = (order === 'asc') === (cursor.direction === 'after') ? 'gt' : 'lt';
  const [value, id] = cursor.key;
  return {
    OR: [{ [column]: { [op]: value } }, { [column]: value, [idColumn]: { [op]: id } }],
  };
}

/** Booleans order `false` before `true`, as a tinyint column does. */
function comparable(value: KeyValue): string | number {
  return typeof value === 'boolean' ? Number(value) : value;
}

function compareValues(left: KeyValue, right: KeyValue): number {
  const a = comparable(left);
  const b = comparable(right);
  if (typeof a === 'number' && typeof b === 'number') return Math.sign(a - b);
  if (typeof a === 'string' && typeof b === 'string') {
    if (a === b) return 0;
    return a < b ? -1 : 1;
  }
  // One list never mixes kinds; numbers first keeps the comparator total if one ever does.
  return typeof a === 'number' ? -1 : 1;
}

/**
 * The in-memory twin of `keysetWhere`'s order: `[value, id]` compared value first, then id, in
 * `order`. The test fakes sort and page with it, so a fake cannot answer an order the repository
 * would not. Strings compare by code unit; the database compares by its collation, which only
 * matters to a spec that mixes case, and none relies on that.
 */
export function compareKeys(
  a: readonly [KeyValue, number],
  b: readonly [KeyValue, number],
  order: 'asc' | 'desc',
): number {
  const byValue = compareValues(a[0], b[0]);
  const result = byValue === 0 ? Math.sign(a[1] - b[1]) : byValue;
  if (result === 0) return 0;
  return order === 'asc' ? result : -result;
}

/**
 * The meta both identity lists answer: a superset of BE-19's `{ nextCursor, total? }`. `total` counts
 * every row matching the filters and `q` (never the cursor); `rangeStart` is the 1-based rank of the
 * page's first row, `0` on an empty page — together they are the pager's "Showing 1–25 of 1,240".
 * `prevCursor` is `null` on the first page, `nextCursor` on the last.
 */
export const listPageMetaSchema = z.object({
  nextCursor: z.string().nullable(),
  prevCursor: z.string().nullable(),
  total: z.number().int().nonnegative(),
  rangeStart: z.number().int().nonnegative(),
});

export type ListPageMeta = z.infer<typeof listPageMetaSchema>;
