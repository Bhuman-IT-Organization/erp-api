/**
 * Repository: the module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Owner of the one table it writes (ADR-0029; `ownership.json` since plan 04.1-10, D-20):
 *   `tbltaxes`            node: `name` (`VARCHAR(100)`) and `taxrate` (`DECIMAL(15,2)`, written as
 *                         two-decimal text); `id` is assigned by the database. Every read and write
 *                         goes through the typed delegate, which the ownership guard admits because
 *                         the register names `node`. Perfex core Subscriptions also inserts rows
 *                         (a recorded co-writer, D-20): Node lists them like any other row.
 *
 * Read only, never written (DB-03):
 *   `tbloptions.value` where `name = 'default_tax'`   perfex-core: Perfex's default taxes as
 *                         `<name>|<rate>` text. Read through the typed delegate for D-21 only; never
 *                         logged, never answered on the wire (the service turns it into a boolean).
 *
 * `TAX_REFERENCES`: what refers to a tax, read for the delete refusal (D-07) and Perfex's edit lock.
 * Every source is a Perfex or Perfex-module table; each is read with ONE tagged `$queryRaw` per table
 * over all the ids at once, the table and column names literal SQL text and the ids bound with
 * `Prisma.join` (no unsafe or raw-text variant). Two forms:
 *
 *   form A, an integer id column (or a pair):
 *     SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN <table> r
 *       ON r.<c1> = t.id [OR r.<c2> = t.id] WHERE t.id IN (<ids>) GROUP BY t.id
 *   form B, a text list of ids joined with `|` (a `,` also splits):
 *     ... JOIN <table> r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.<c>, '[|]', ',')) > 0 ...
 *   Both count ROWS, not occurrences: a row naming the id twice (`tax` and `tax2`, or `3|3`) counts
 *   once. Form B splits with `REGEXP_REPLACE`, not `REPLACE`: the ownership guard refuses a raw
 *   statement holding the word `REPLACE` (a write keyword), and `REGEXP_REPLACE` reads the same.
 *
 *   group                owner             table.column                                  form
 *   items                perfex-core       tblitems (tax, tax2)                          A   Perfex's own delete check
 *   expenses             perfex-core       tblexpenses (tax, tax2)                       A   Perfex's delete check; edit lock
 *   subscriptions        perfex-core       tblsubscriptions (tax_id, tax_id_2)           A   Perfex's delete check; edit lock
 *   vendorItems          purchase          tblitems_of_vendor (tax, tax2)                A
 *   purchaseLines        purchase          tblpur_order_detail.tax                       B
 *                                          tblpur_request_detail.tax                     B
 *                                          tblpur_estimate_detail.tax                    B
 *                                          tblpur_invoice_details.tax                    B
 *   warehouseLines       warehouse         tblgoods_receipt_detail.tax                   B
 *                                          tblgoods_delivery_detail.tax_id               B
 *                                          tblwh_order_return_details.tax_id             B
 *                                          tblwh_packing_list_details.tax_id             B
 *   fixedEquipmentLines  fixed_equipment   tblfe_cart.tax_id                             B
 *                                          tblfe_cart_detailt (tax, tax_id)              B   either column, one row once
 *                                          tblfe_goods_delivery_detail.tax_id            B
 *                                          tblfe_goods_receipt_detail.tax                B
 *                                          tblfe_packing_list_details.tax_id             B
 *   salesReturnLines     perfex-core       tblsales_return_items.tax_id                  B
 *   accounting           accounting        tblacc_tax_mappings.tax_id                    A
 *                                          tblacc_account_history.tax                    A
 *
 * 20 statements in one `Promise.all` per call; a group's count is the sum of its tables' counts.
 *
 * Fail closed: an error from any statement is not caught, so `usageByTax` rejects. The list then
 * answers its retryable error and a delete or an edit is refused, never allowed on a count nobody
 * could read (D-07). The service adds the other half: an answer without the id refuses too.
 *
 * Every row is re-parsed through its zod schema, never trusted from the generic (BE-11).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { Prisma } from '../../../shared/db/generated/client.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import {
  TAXES_FACADE_MAX_ROWS,
  type NewTax,
  type TaxesListRequest,
  type TaxesPage,
  type TaxesSortField,
  type TaxRow,
  type TaxUsage,
} from '../model/taxes.model.js';
import { NO_TAX_USAGE, roundRate } from '../service/taxes.transformer.js';

/** Prisma's "record to update not found". */
const RECORD_NOT_FOUND = 'P2025';

/** The `tbloptions` row that holds Perfex's default taxes (D-21). */
export const DEFAULT_TAX_OPTION = 'default_tax';

/** The largest value of MySQL's signed `INT` (the id column): a longer `q` is not an id. */
const MAX_INT_ID = 2_147_483_647;

/** The three columns of the table; nothing else is selected. */
const COLUMNS = { id: true, name: true, taxrate: true } as const;

/** The two-decimal text `DECIMAL(15,2)` holds. */
const TWO_DECIMALS = /^-?\d+\.\d{2}$/;
const RATE_PLACES = 2;

/** Prisma's `Decimal` as far as this file reads it. */
interface DecimalLike {
  toFixed(places: number): string;
}

function isDecimalLike(value: unknown): value is DecimalLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toFixed' in value &&
    typeof value.toFixed === 'function'
  );
}

/** The column's value as two-decimal text; `-0.00` reads as `0.00`. */
const taxrateSchema = z
  .union([
    z.string().regex(TWO_DECIMALS),
    z.number(),
    z.custom<DecimalLike>(isDecimalLike, 'taxrate is not a decimal'),
  ])
  .transform((value) => {
    const text = typeof value === 'string' ? value : value.toFixed(RATE_PLACES);
    return text === '-0.00' ? '0.00' : text;
  });

const rowSchema = z.object({ id: z.number().int(), name: z.string(), taxrate: taxrateSchema });
const rowsSchema = z.array(rowSchema);
const idSchema = z.object({ id: z.number().int() });
const optionSchema = z.object({ value: z.string() });

/** `COUNT(*)` arrives from MySQL as a bigint; a driver may hand a number. */
const countSchema = z.union([z.bigint(), z.number().int()]).transform(Number);
const usageRowsSchema = z.array(z.object({ tax: z.coerce.number().int(), n: countSchema }));

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];
type UsageGroup = keyof TaxUsage;

/** The column each sort field reads. */
const SORT_COLUMNS = { rate: 'taxrate', name: 'name', id: 'id' } as const satisfies Record<
  TaxesSortField,
  string
>;

/** One tax's counts while the 20 answers are summed into them. */
type MutableUsage = Record<UsageGroup, number>;

/**
 * `?q=`: the name contains it; an all-digit `q` that fits the id column also matches the id; a `q`
 * that is a rate also matches the rate rounded to two places. `{}` matches every row.
 */
function matchOf(search: string | null): WhereValue {
  if (search === null) return {};
  const or: WhereValue[] = [{ name: { contains: search } }];
  if (/^\d+$/.test(search) && Number(search) <= MAX_INT_ID) or.push({ id: Number(search) });
  const rate = roundRate(search);
  if (rate !== null) or.push({ taxrate: rate });
  return { OR: or };
}

/** The keyset key of a row: the rate as a NUMBER, so the order is numeric in the fake too. */
function keyOf(row: TaxRow, sortField: TaxesSortField): Key {
  if (sortField === 'rate') return [Number(row.taxrate), row.id];
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** A `before` cursor reads the rows just before it in the reversed order, then reverses them back. */
function readDirection(request: TaxesListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

/** Next exists while rows remain after the page, Previous while rows exist before it. */
function pageMeta(
  sortField: TaxesSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<TaxesPage, 'items'> {
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

/** Adds one statement's `{ tax, n }` rows to the group's count of each tax it names. */
function addCounts(totals: Map<number, MutableUsage>, group: UsageGroup, answer: unknown): void {
  for (const { tax, n } of usageRowsSchema.parse(answer)) {
    const counts = totals.get(tax);
    if (counts !== undefined) counts[group] += n;
  }
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

@Injectable()
export class TaxesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One keyset page ordered by `(sort column, id)`, then `total` (the match without the cursor)
   * and the rank of the first row, both through `count`, exactly as the expense-categories list.
   */
  async list(request: TaxesListRequest): Promise<TaxesPage> {
    const { sortField, order, cursor, limit } = request;
    const column = SORT_COLUMNS[sortField];
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.prisma.client.tbltaxes.findMany({
      where: cursor === null ? match : { AND: [match, keysetWhere(column, 'id', cursor, order)] },
      orderBy: [{ [column]: read }, { id: read }],
      take: limit,
      select: COLUMNS,
    });
    const items = rowsSchema.parse(rows);
    if (read !== order) items.reverse();
    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tbltaxes.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tbltaxes.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  column,
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
  count(request: TaxesListRequest): Promise<number> {
    return this.prisma.client.tbltaxes.count({ where: matchOf(request.search) });
  }

  /** One row in its stored form, or `null` when the id is missing. */
  async findById(id: number): Promise<TaxRow | null> {
    const row = await this.prisma.client.tbltaxes.findFirst({ where: { id }, select: COLUMNS });
    return row === null ? null : rowSchema.parse(row);
  }

  /**
   * The id of ANOTHER row holding `name` (Perfex's `tax_name_exists`: `where name = ?`, so the
   * column's collation decides letter case and trailing spaces), or `null`. `exceptId` is the row
   * being edited.
   */
  async findOtherByName(name: string, exceptId?: number): Promise<number | null> {
    const row = await this.prisma.client.tbltaxes.findFirst({
      where: exceptId === undefined ? { name } : { name, NOT: { id: exceptId } },
      select: { id: true },
    });
    return row === null ? null : idSchema.parse(row).id;
  }

  /** Inserts a row (the rate already rounded); the database assigns the id. */
  async create(input: NewTax): Promise<TaxRow> {
    const row = await this.prisma.client.tbltaxes.create({
      data: { name: input.name, taxrate: input.taxrate },
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  /** Changes the given fields; `null` when the id is missing (Prisma P2025). */
  async update(id: number, patch: Partial<NewTax>): Promise<TaxRow | null> {
    try {
      const row = await this.prisma.client.tbltaxes.update({
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
    const { count } = await this.prisma.client.tbltaxes.deleteMany({ where: { id } });
    return count > 0;
  }

  /**
   * What refers to each tax: the 20 statements of `TAX_REFERENCES` over all the ids at once, then
   * one `TaxUsage` per id (zeros where nothing refers to it). No ids, no query. An error from any
   * statement rejects the whole answer (fail closed).
   */
  async usageByTax(ids: readonly number[]): Promise<ReadonlyMap<number, TaxUsage>> {
    if (ids.length === 0) return new Map();
    const reads = this.referenceReads(Prisma.join([...ids]));
    const answers = await Promise.all(reads.map(([, read]) => read));
    const totals = new Map<number, MutableUsage>(ids.map((id) => [id, { ...NO_TAX_USAGE }]));
    reads.forEach(([group], index) => {
      addCounts(totals, group, answers[index]);
    });
    return totals;
  }

  /** `tbloptions.value` of `default_tax` (D-21), `''` when the option is absent. Read only. */
  async defaultTaxSetting(): Promise<string> {
    const row = await this.prisma.client.tbloptions.findFirst({
      where: { name: DEFAULT_TAX_OPTION },
      select: { value: true },
    });
    return row === null ? '' : optionSchema.parse(row).value;
  }

  /**
   * Every tax, the rate ascending, then the id: the facade's `listAll`. Reads one row more than
   * `TAXES_FACADE_MAX_ROWS` and refuses loudly when it finds it, never answering a truncated list.
   */
  async listAll(): Promise<readonly TaxRow[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tbltaxes.findMany({
        orderBy: [{ taxrate: 'asc' }, { id: 'asc' }],
        take: TAXES_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > TAXES_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(TAXES_FACADE_MAX_ROWS)} taxes: the full list was refused, not truncated`,
      );
    }
    return rows;
  }

  /** The rows whose id is in `ids`, in no particular order (the service orders them). */
  async findByIds(ids: readonly number[]): Promise<readonly TaxRow[]> {
    if (ids.length === 0) return [];
    return rowsSchema.parse(
      await this.prisma.client.tbltaxes.findMany({
        where: { id: { in: [...ids] } },
        select: COLUMNS,
      }),
    );
  }

  /** The 20 statements of `TAX_REFERENCES`, each with the group it counts toward. */
  private referenceReads(ids: Prisma.Sql): readonly (readonly [UsageGroup, Promise<unknown>])[] {
    const raw = this.prisma.client;
    return [
      [
        'items',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblitems r ON r.tax = t.id OR r.tax2 = t.id WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'expenses',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblexpenses r ON r.tax = t.id OR r.tax2 = t.id WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'subscriptions',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblsubscriptions r ON r.tax_id = t.id OR r.tax_id_2 = t.id WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'vendorItems',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblitems_of_vendor r ON r.tax = t.id OR r.tax2 = t.id WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'purchaseLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblpur_order_detail r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'purchaseLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblpur_request_detail r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'purchaseLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblpur_estimate_detail r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'purchaseLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblpur_invoice_details r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'warehouseLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblgoods_receipt_detail r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'warehouseLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblgoods_delivery_detail r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax_id, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'warehouseLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblwh_order_return_details r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax_id, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'warehouseLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblwh_packing_list_details r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax_id, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'fixedEquipmentLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblfe_cart r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax_id, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'fixedEquipmentLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblfe_cart_detailt r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax, '[|]', ',')) > 0 OR FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax_id, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'fixedEquipmentLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblfe_goods_delivery_detail r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax_id, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'fixedEquipmentLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblfe_goods_receipt_detail r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'fixedEquipmentLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblfe_packing_list_details r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax_id, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'salesReturnLines',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblsales_return_items r ON FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax_id, '[|]', ',')) > 0 WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'accounting',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblacc_tax_mappings r ON r.tax_id = t.id WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
      [
        'accounting',
        raw.$queryRaw`SELECT t.id AS tax, COUNT(*) AS n FROM tbltaxes t JOIN tblacc_account_history r ON r.tax = t.id WHERE t.id IN (${ids}) GROUP BY t.id`,
      ],
    ];
  }
}
