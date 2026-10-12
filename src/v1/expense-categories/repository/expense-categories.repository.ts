/**
 * Repository: the module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Owner of the one table it writes (ADR-0029; `ownership.json` since plan 04.1-02):
 *   `tblexpenses_categories`             node: `name` and `description` (stored in Perfex's `nl2br`
 *                                        form, so Perfex keeps reading the rows Node writes); `id`
 *                                        is assigned by the database. Every read and write goes
 *                                        through the typed delegate, which the ownership guard
 *                                        admits because the register names `node`.
 *
 * Read only, for the delete refusal (D-07, D-15), never written (DB-03):
 *   `tblexpenses.category`               perfex-core: Perfex's own delete checks it.
 *   `tblacc_expense_category_mappings.category_id`
 *                                        accounting's category mappings.
 *   `tblpur_petty_cash_advances.expense_category`
 *                                        purchase's petty cash advances, WHENEVER that table exists.
 *
 * `usageByCategory` reads each source ONCE for all the ids it is given (a grouped count, as
 * identity's `countMembersByRole` does), never once per row. The petty-cash table is optional: the
 * purchase module creates it when it is installed, and the local copy lacks it. So each call first
 * asks `information_schema.TABLES` whether it exists, with the table name bound as a VALUE, and only
 * then runs one grouped count whose ids are bound with `Prisma.join`; the table and column names are
 * literal SQL text, never interpolated. The probe runs on every call and is never cached, because
 * the table can appear while the api runs. Both statements are tagged `$queryRaw` `SELECT`s, which
 * the ownership guard admits as read-only.
 *
 * Fail closed: an error from the probe or from the count is not caught. The list then answers its
 * retryable error and a delete is refused, never allowed on a count nobody could read (D-15). The
 * service adds the other half: a usage answer that does not name the id refuses the delete too.
 *
 * Every row is re-parsed through its zod schema, never trusted from the generic (BE-11).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { Prisma } from '../../../shared/db/generated/client.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import type {
  ExpenseCategoriesListRequest,
  ExpenseCategoriesPage,
  ExpenseCategoriesSortField,
  ExpenseCategory,
  ExpenseCategoryUsage,
  NewExpenseCategory,
} from '../model/expense-categories.model.js';

/** The optional referencing table of D-15; bound as a value in the presence probe. */
export const EXPENSE_CATEGORIES_PETTY_CASH_TABLE = 'tblpur_petty_cash_advances';

/** Prisma's "record to update not found". */
const RECORD_NOT_FOUND = 'P2025';

/** The three columns of the table; nothing else is selected. */
const COLUMNS = { id: true, name: true, description: true } as const;

const rowSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  description: z.string().nullable(),
});
const rowsSchema = z.array(rowSchema);

/** `COUNT(*)` arrives from MySQL as a bigint; a driver may hand a number. */
const countSchema = z.union([z.bigint(), z.number().int()]).transform(Number);

/** The probe answers exactly one row; anything else is refused, never read as "absent". */
const probeSchema = z.tuple([z.object({ n: countSchema })]);

const expenseCountsSchema = z.array(
  z.object({ category: z.number().int(), _count: z.object({ id: z.number().int() }) }),
);
const mappingCountsSchema = z.array(
  z.object({ category_id: z.number().int(), _count: z.object({ id: z.number().int() }) }),
);
const pettyCashCountsSchema = z.array(
  z.object({ category: z.coerce.number().int(), n: countSchema }),
);

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];

/** `?q=` over the name or the description; `{}` matches every row. */
function matchOf(search: string | null): WhereValue {
  return search === null
    ? {}
    : { OR: [{ name: { contains: search } }, { description: { contains: search } }] };
}

function keyOf(row: ExpenseCategory, sortField: ExpenseCategoriesSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** A `before` cursor reads the rows just before it in the reversed order, then reverses them back. */
function readDirection(request: ExpenseCategoriesListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

/** Next exists while rows remain after the page, Previous while rows exist before it. */
function pageMeta(
  sortField: ExpenseCategoriesSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<ExpenseCategoriesPage, 'items'> {
  const first = keys[0];
  const last = keys.at(-1);
  if (first === undefined || last === undefined) {
    return { nextCursor: null, prevCursor: null, total, rangeStart: 0 };
  }
  const rangeStart = before + 1;
  return {
    nextCursor:
      rangeStart - 1 + keys.length < total ? encodeCursor(sortField, last, 'after') : null,
    prevCursor: rangeStart > 1 ? encodeCursor(sortField, first, 'before') : null,
    total,
    rangeStart,
  };
}

/** Prisma's P2025, read from the error's `code` so no Prisma class leaves this file. */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === RECORD_NOT_FOUND
  );
}

/** `id -> count` from one grouped read. */
function countsBy<T>(
  rows: readonly T[],
  id: (row: T) => number,
  n: (row: T) => number,
): Map<number, number> {
  return new Map(rows.map((row) => [id(row), n(row)]));
}

@Injectable()
export class ExpenseCategoriesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One keyset page ordered by `(sortField, id)`, then `total` (the match without the cursor) and
   * the rank of the first row, both through `count`, exactly as v1/identity's lists page.
   */
  async list(request: ExpenseCategoriesListRequest): Promise<ExpenseCategoriesPage> {
    const { sortField, order, cursor, limit } = request;
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.prisma.client.tblexpenses_categories.findMany({
      where:
        cursor === null ? match : { AND: [match, keysetWhere(sortField, 'id', cursor, order)] },
      orderBy: [{ [sortField]: read }, { id: read }],
      take: limit,
      select: COLUMNS,
    });
    const items = rowsSchema.parse(rows);
    if (read !== order) items.reverse();
    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tblexpenses_categories.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblexpenses_categories.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  sortField,
                  'id',
                  { sort: sortField, key: first, direction: 'before' },
                  order,
                ),
              ],
            },
          }),
    ]);
    return { items, ...pageMeta(sortField, keys, total, before) };
  }

  /** The list's own match without the cursor: what the export counts before it reads a row. */
  count(request: ExpenseCategoriesListRequest): Promise<number> {
    return this.prisma.client.tblexpenses_categories.count({ where: matchOf(request.search) });
  }

  /** One row in its stored form, or `null` when the id is missing. */
  async findById(id: number): Promise<ExpenseCategory | null> {
    const row = await this.prisma.client.tblexpenses_categories.findFirst({
      where: { id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  /** Inserts a row in its stored form; the database assigns the id. */
  async create(input: NewExpenseCategory): Promise<ExpenseCategory> {
    const row = await this.prisma.client.tblexpenses_categories.create({
      data: { name: input.name, description: input.description },
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  /** Changes the given fields (stored form); `null` when the id is missing (Prisma P2025). */
  async update(id: number, patch: Partial<NewExpenseCategory>): Promise<ExpenseCategory | null> {
    try {
      const row = await this.prisma.client.tblexpenses_categories.update({
        where: { id },
        data: patch,
        select: COLUMNS,
      });
      return rowSchema.parse(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /** Deletes a row; `false` when nothing was deleted (the id was missing). */
  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tblexpenses_categories.deleteMany({
      where: { id },
    });
    return count > 0;
  }

  /**
   * What refers to each category (D-07, D-15): one grouped read per source over all the ids, then
   * one `ExpenseCategoryUsage` per id, zeros where a source has no row for it. No ids, no query.
   * An error from any read rejects the whole answer (fail closed).
   */
  async usageByCategory(
    ids: readonly number[],
  ): Promise<ReadonlyMap<number, ExpenseCategoryUsage>> {
    if (ids.length === 0) return new Map();
    const [expenseRows, mappingRows, pettyCash] = await Promise.all([
      this.prisma.client.tblexpenses.groupBy({
        by: ['category'],
        where: { category: { in: [...ids] } },
        _count: { id: true },
      }),
      this.prisma.client.tblacc_expense_category_mappings.groupBy({
        by: ['category_id'],
        where: { category_id: { in: [...ids] } },
        _count: { id: true },
      }),
      this.pettyCashByCategory(ids),
    ]);
    const expenses = countsBy(
      expenseCountsSchema.parse(expenseRows),
      (row) => row.category,
      (row) => row._count.id,
    );
    const mappings = countsBy(
      mappingCountsSchema.parse(mappingRows),
      (row) => row.category_id,
      (row) => row._count.id,
    );
    return new Map(
      ids.map((id) => [
        id,
        {
          expenses: expenses.get(id) ?? 0,
          accountingMappings: mappings.get(id) ?? 0,
          pettyCashAdvances: pettyCash.get(id) ?? 0,
        },
      ]),
    );
  }

  /**
   * Whether `table` exists in the connected schema. `table` is a BOUND value, never SQL text, so
   * the probe reads nothing but `information_schema`.
   */
  async tablePresent(table: string): Promise<boolean> {
    const rows = await this.prisma.client.$queryRaw<
      unknown[]
    >`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table}`;
    const [{ n }] = probeSchema.parse(rows);
    return n > 0;
  }

  /**
   * `id -> petty cash advances` when `tblpur_petty_cash_advances` exists, else an empty map. The
   * table and the column are literal SQL text; the ids are bound with `Prisma.join`.
   */
  private async pettyCashByCategory(ids: readonly number[]): Promise<Map<number, number>> {
    if (!(await this.tablePresent(EXPENSE_CATEGORIES_PETTY_CASH_TABLE))) return new Map();
    const rows = await this.prisma.client.$queryRaw<
      unknown[]
    >`SELECT expense_category AS category, COUNT(*) AS n FROM tblpur_petty_cash_advances WHERE expense_category IN (${Prisma.join([...ids])}) GROUP BY expense_category`;
    return countsBy(
      pettyCashCountsSchema.parse(rows),
      (row) => row.category,
      (row) => row.n,
    );
  }
}
