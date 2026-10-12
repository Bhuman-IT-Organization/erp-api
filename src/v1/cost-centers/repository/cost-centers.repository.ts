/**
 * Repository: the module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Owner of the one table it writes (ADR-0029; `ownership.json` since plan 04.1-17, W2A-03):
 *   `tblcost_centers`     node: `name` (`VARCHAR(255)`); on create only, `created_by` (the signed-in
 *                         staff id) and `datecreated` (Perfex's wall clock, D-31); `id` is assigned
 *                         by the database. An update writes the name and nothing else. Every read
 *                         and write goes through the typed delegate, which the ownership guard
 *                         admits because the register names `node`.
 *
 * `COST_CENTER_REFERENCES`: what refers to a cost center, read for the delete refusal (D-07) and
 * each row's usage. A DECLARED candidate list (D-28), each entry a Perfex or Perfex-module column,
 * read only and never written:
 *
 *   group               owner             table.column                       match
 *   purchaseRequests    purchase          tblpur_request.cost_center         id
 *   purchaseOrders      purchase          tblpur_orders.cost_center          id
 *   purchaseQuotations  purchase          tblpur_estimates.cost_center       id
 *   shippingCharges     (unregistered)    tblinv_shipping_charges.cost_center id
 *   expenses            perfex-core       tblexpenses.cost_center            id
 *   assets              fixed_equipment   tblfe_asset_creation.cost_centre   name
 *
 * The runtime probe (D-28): before every usage read, ONE statement over `information_schema.COLUMNS`
 * (the candidate table and column names BOUND, never SQL text) answers which candidates exist in the
 * connected schema; only those run, and a missing one counts 0 and raises no error. It is never
 * cached: `tblexpenses.cost_center` and `tblinv_shipping_charges.cost_center` come from the client's
 * hand-run scripts and are absent from the local copy, and when the Expenses or shipping-charge slice
 * adds its column with Node's own DDL, this module counts it with no code change. This module never
 * adds a column to any table (the standing rule: never patch Perfex).
 *
 * Each present candidate is ONE tagged `$queryRaw` over all the ids at once, the table and column
 * names literal SQL text and the ids bound with `Prisma.join` (no unsafe or raw-text variant, and no
 * write keyword: the ownership guard reads one as a write):
 *   match id:    SELECT r.<c> AS id, COUNT(*) AS n FROM <table> r WHERE r.<c> IN (<ids>) GROUP BY r.<c>
 *   match name:  SELECT c.id AS id, COUNT(*) AS n FROM tblcost_centers c JOIN tblfe_asset_creation r
 *                  ON CAST(r.cost_centre AS BINARY) = CAST(c.name AS BINARY) WHERE c.id IN (<ids>)
 *                  GROUP BY c.id
 *   fixed_equipment stores the cost center's NAME as text (its asset form's options carry the name),
 *   so an asset counts when its text equals the name EXACTLY: byte for byte and case-sensitive, never
 *   under the columns' case-insensitive collation (lead 2026-10-03). A rename leaves the asset's text
 *   naming the old name, exactly as Perfex does (D-29).
 *
 * Fail closed: an error from the probe or from any statement is not caught, so `usageByCostCenter`
 * rejects. The list then answers its retryable error and a delete is refused, never allowed on a
 * count nobody could read (D-07). The service adds the other half: an answer without the id refuses.
 *
 * Every row is re-parsed through its zod schema, never trusted from the generic (BE-11).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { Prisma } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import {
  COST_CENTERS_FACADE_MAX_ROWS,
  type CostCenterRow,
  type CostCentersListRequest,
  type CostCentersPage,
  type CostCentersSortField,
  type CostCenterUsage,
  type NewCostCenter,
} from '../model/cost-centers.model.js';
import { NO_COST_CENTER_USAGE } from '../service/cost-centers.transformer.js';

/** Prisma's "record to update not found". */
const RECORD_NOT_FOUND = 'P2025';

/** The largest value of MySQL's `INT UNSIGNED` (the id column): a longer all-digit `q` is not an id. */
const MAX_UNSIGNED_INT_ID = 4_294_967_295;

/** The four columns of the table; nothing else is selected. */
const COLUMNS = { id: true, name: true, created_by: true, datecreated: true } as const;

const rowSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    created_by: z.number().int().nullable(),
    datecreated: z.date().nullable(),
  })
  .transform((row): CostCenterRow => ({
    id: row.id,
    name: row.name,
    createdBy: row.created_by,
    datecreated: row.datecreated,
  }));
const rowsSchema = z.array(rowSchema);

/** `COUNT(*)` arrives from MySQL as a bigint; a driver may hand a number. */
const countSchema = z.union([z.bigint(), z.number().int()]).transform(Number);
const usageRowsSchema = z.array(z.object({ id: z.coerce.number().int(), n: countSchema }));
const presentColumnsSchema = z.array(z.object({ t: z.string(), c: z.string() }));

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];
type UsageGroup = keyof CostCenterUsage;
type RawClient = PrismaService['client'];

/** One cost center's counts while the answers are summed into them. */
type MutableUsage = Record<UsageGroup, number>;

/** How a referencing column names a cost center: by its id, or by its name as text. */
export type CostCenterMatch = 'id' | 'name';

/** One candidate of D-28: the group it counts toward, where it lives, how it matches, its statement. */
export interface CostCenterReference {
  readonly group: UsageGroup;
  readonly table: string;
  readonly column: string;
  readonly match: CostCenterMatch;
  /** The tagged statement over the bound ids: rows `{ id, n }`. */
  readonly count: (client: RawClient, ids: Prisma.Sql) => Promise<unknown>;
}

/**
 * The declared candidates of D-28 (plan 04.1-17's re-check: six columns, five by id and one by
 * name). A column a later finding adds joins here in the same shape; the probe decides at every read
 * whether it runs.
 */
export const COST_CENTER_REFERENCES: readonly CostCenterReference[] = Object.freeze([
  {
    group: 'purchaseRequests',
    table: 'tblpur_request',
    column: 'cost_center',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.cost_center AS id, COUNT(*) AS n FROM tblpur_request r WHERE r.cost_center IN (${ids}) GROUP BY r.cost_center`,
  },
  {
    group: 'purchaseOrders',
    table: 'tblpur_orders',
    column: 'cost_center',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.cost_center AS id, COUNT(*) AS n FROM tblpur_orders r WHERE r.cost_center IN (${ids}) GROUP BY r.cost_center`,
  },
  {
    group: 'purchaseQuotations',
    table: 'tblpur_estimates',
    column: 'cost_center',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.cost_center AS id, COUNT(*) AS n FROM tblpur_estimates r WHERE r.cost_center IN (${ids}) GROUP BY r.cost_center`,
  },
  {
    group: 'shippingCharges',
    table: 'tblinv_shipping_charges',
    column: 'cost_center',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.cost_center AS id, COUNT(*) AS n FROM tblinv_shipping_charges r WHERE r.cost_center IN (${ids}) GROUP BY r.cost_center`,
  },
  {
    group: 'expenses',
    table: 'tblexpenses',
    column: 'cost_center',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.cost_center AS id, COUNT(*) AS n FROM tblexpenses r WHERE r.cost_center IN (${ids}) GROUP BY r.cost_center`,
  },
  {
    group: 'assets',
    table: 'tblfe_asset_creation',
    column: 'cost_centre',
    match: 'name',
    count: (client, ids) =>
      client.$queryRaw`SELECT c.id AS id, COUNT(*) AS n FROM tblcost_centers c JOIN tblfe_asset_creation r ON CAST(r.cost_centre AS BINARY) = CAST(c.name AS BINARY) WHERE c.id IN (${ids}) GROUP BY c.id`,
  },
]);

/** The key a candidate answers by: `table.column`, as declared. */
export function referenceKey(reference: Pick<CostCenterReference, 'table' | 'column'>): string {
  return `${reference.table}.${reference.column}`;
}

/** `?q=`: the name contains it; an all-digit `q` that fits the id column also matches the id. */
function matchOf(search: string | null): WhereValue {
  if (search === null) return {};
  const or: WhereValue[] = [{ name: { contains: search } }];
  if (/^\d+$/.test(search) && Number(search) <= MAX_UNSIGNED_INT_ID)
    or.push({ id: Number(search) });
  return { OR: or };
}

function keyOf(row: CostCenterRow, sortField: CostCentersSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** A `before` cursor reads the rows just before it in the reversed order, then reverses them back. */
function readDirection(request: CostCentersListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

/** Next exists while rows remain after the page, Previous while rows exist before it. */
function pageMeta(
  sortField: CostCentersSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<CostCentersPage, 'items'> {
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

/**
 * Adds one statement's `{ id, n }` rows to the group's count of each cost center it names.
 *
 * @complexity O(n) over the answer's rows
 */
function addCounts(totals: Map<number, MutableUsage>, group: UsageGroup, answer: unknown): void {
  for (const { id, n } of usageRowsSchema.parse(answer)) {
    const counts = totals.get(id);
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
export class CostCentersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One keyset page ordered by `(sort column, id)`, then `total` (the match without the cursor)
   * and the rank of the first row, both through `count`, exactly as the taxes list.
   */
  async list(request: CostCentersListRequest): Promise<CostCentersPage> {
    const { sortField, order, cursor, limit } = request;
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.prisma.client.tblcost_centers.findMany({
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
      this.prisma.client.tblcost_centers.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblcost_centers.count({
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
  count(request: CostCentersListRequest): Promise<number> {
    return this.prisma.client.tblcost_centers.count({ where: matchOf(request.search) });
  }

  /** One row in its stored form, or `null` when the id is missing. */
  async findById(id: number): Promise<CostCenterRow | null> {
    const row = await this.prisma.client.tblcost_centers.findFirst({
      where: { id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  /** Inserts a row with Perfex's two create columns (D-31); the database assigns the id. */
  async create(input: NewCostCenter): Promise<CostCenterRow> {
    const row = await this.prisma.client.tblcost_centers.create({
      data: { name: input.name, created_by: input.createdBy, datecreated: input.datecreated },
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  /** Changes the name and NOTHING else (D-31); `null` when the id is missing (Prisma P2025). */
  async update(id: number, patch: { readonly name: string }): Promise<CostCenterRow | null> {
    try {
      const row = await this.prisma.client.tblcost_centers.update({
        where: { id },
        data: { name: patch.name },
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
    const { count } = await this.prisma.client.tblcost_centers.deleteMany({ where: { id } });
    return count > 0;
  }

  /**
   * The candidates of `COST_CENTER_REFERENCES` the connected schema has right now, as `table.column`
   * keys: ONE `information_schema.COLUMNS` read with every name bound, matched exactly (letter case
   * folded on both sides, as MySQL may answer a name in another case). An absent table or column is
   * simply not in the set. Never cached (D-28).
   *
   * @complexity O(r + c) over the answer's rows and the candidates
   */
  async presentReferences(): Promise<ReadonlySet<string>> {
    const tables = [...new Set(COST_CENTER_REFERENCES.map((reference) => reference.table))];
    const columns = [...new Set(COST_CENTER_REFERENCES.map((reference) => reference.column))];
    const rows = presentColumnsSchema.parse(
      await this.prisma.client
        .$queryRaw`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${Prisma.join(tables)}) AND COLUMN_NAME IN (${Prisma.join(columns)})`,
    );
    const found = new Set(rows.map((row) => `${row.t}.${row.c}`.toLowerCase()));
    return new Set(
      COST_CENTER_REFERENCES.map(referenceKey).filter((key) => found.has(key.toLowerCase())),
    );
  }

  /**
   * What refers to each cost center: the probe first, then one statement per PRESENT candidate in
   * one `Promise.all`, then one `CostCenterUsage` per id (zeros where nothing refers to it, and for
   * every missing candidate). No ids, no query. An error from the probe or any statement rejects the
   * whole answer (fail closed).
   *
   * @complexity O(c + r) over the candidates and the answers' rows
   */
  async usageByCostCenter(ids: readonly number[]): Promise<ReadonlyMap<number, CostCenterUsage>> {
    if (ids.length === 0) return new Map();
    const present = await this.presentReferences();
    const reads = COST_CENTER_REFERENCES.filter((reference) =>
      present.has(referenceKey(reference)),
    );
    const bound = Prisma.join([...ids]);
    const answers = await Promise.all(
      reads.map((reference) => reference.count(this.prisma.client, bound)),
    );
    const totals = new Map<number, MutableUsage>(
      ids.map((id) => [id, { ...NO_COST_CENTER_USAGE }]),
    );
    reads.forEach((reference, index) => {
      addCounts(totals, reference.group, answers[index]);
    });
    return totals;
  }

  /**
   * Every cost center, the name ascending, then the id (the order Perfex's pickers read): the
   * facade's `listAll`. Reads one row more than `COST_CENTERS_FACADE_MAX_ROWS` and refuses loudly
   * when it finds it, never answering a truncated list.
   */
  async listAll(): Promise<readonly CostCenterRow[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tblcost_centers.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: COST_CENTERS_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > COST_CENTERS_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(COST_CENTERS_FACADE_MAX_ROWS)} cost centers: the full list was refused, not truncated`,
      );
    }
    return rows;
  }

  /** The rows whose id is in `ids`, in no particular order (the service orders them). */
  async findByIds(ids: readonly number[]): Promise<readonly CostCenterRow[]> {
    if (ids.length === 0) return [];
    return rowsSchema.parse(
      await this.prisma.client.tblcost_centers.findMany({
        where: { id: { in: [...ids] } },
        select: COLUMNS,
      }),
    );
  }
}
