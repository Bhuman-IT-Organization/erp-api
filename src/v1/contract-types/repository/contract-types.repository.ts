/**
 * Repository: the module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Owner of the one table it writes (ADR-0029):
 *   `tblcontracts_types`  node: `name` (`VARCHAR(255)`); on create only, `created_by` (the signed-in
 *                         staff id) and `datecreated` (Perfex's wall clock, D-31); `id` is assigned
 *                         by the database. An update writes the name and nothing else. Every read
 *                         and write goes through the typed delegate.
 *
 * `CONTRACT_TYPE_REFERENCES`: what refers to a contract type, read for the delete refusal (D-07) and
 * each row's usage. A DECLARED candidate list (D-28), each entry a Perfex or Perfex-module column,
 * read only and never written.
 *
 * The runtime probe (D-28): before every usage read, ONE statement over `information_schema.COLUMNS`
 * answers which candidates exist in the connected schema; only those run, and a missing one counts 0
 * and raises no error.
 *
 * Fail closed: an error from the probe or from any statement is not caught, so `usageByContractType`
 * rejects.
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { Prisma } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import {
  CONTRACT_TYPES_FACADE_MAX_ROWS,
  type ContractTypeRow,
  type ContractTypesListRequest,
  type ContractTypesPage,
  type ContractTypesSortField,
  type ContractTypeUsage,
  type NewContractType,
} from '../model/contract-types.model.js';
import { NO_CONTRACT_TYPE_USAGE } from '../service/contract-types.transformer.js';

/** Prisma's "record to update not found". */
const RECORD_NOT_FOUND = 'P2025';

/** The largest value of MySQL's `INT UNSIGNED` (the id column): a longer all-digit `q` is not an id. */
const MAX_UNSIGNED_INT_ID = 4_294_967_295;

/** The two columns of the table; nothing else is selected. */
const COLUMNS = { id: true, name: true } as const;

const rowSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
  })
  .transform((row): ContractTypeRow => ({
    id: row.id,
    name: row.name,
    createdBy: null,
    datecreated: null,
  }));
const rowsSchema = z.array(rowSchema);

/** `COUNT(*)` arrives from MySQL as a bigint; a driver may hand a number. */
const countSchema = z.union([z.bigint(), z.number().int()]).transform(Number);
const usageRowsSchema = z.array(z.object({ id: z.coerce.number().int(), n: countSchema }));
const presentColumnsSchema = z.array(z.object({ t: z.string(), c: z.string() }));

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];
type UsageGroup = keyof ContractTypeUsage;
type RawClient = PrismaService['client'];

/** One contract type's counts while the answers are summed into them. */
type MutableUsage = Record<UsageGroup, number>;

/** How a referencing column names a contract type: by its id, or by its name as text. */
export type ContractTypeMatch = 'id' | 'name';

/** One candidate of D-28: the group it counts toward, where it lives, how it matches, its statement. */
export interface ContractTypeReference {
  readonly group: UsageGroup;
  readonly table: string;
  readonly column: string;
  readonly match: ContractTypeMatch;
  /** The tagged statement over the bound ids: rows `{ id, n }`. */
  readonly count: (client: RawClient, ids: Prisma.Sql) => Promise<unknown>;
}

/**
 * The declared candidates of D-28. A column a later finding adds joins here in the same shape;
 * the probe decides at every read whether it runs.
 */
export const CONTRACT_TYPE_REFERENCES: readonly ContractTypeReference[] = Object.freeze([
  {
    group: 'purchaseRequests',
    table: 'tblpur_request',
    column: 'contract_type',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.contract_type AS id, COUNT(*) AS n FROM tblpur_request r WHERE r.contract_type IN (${ids}) GROUP BY r.contract_type`,
  },
  {
    group: 'purchaseOrders',
    table: 'tblpur_orders',
    column: 'contract_type',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.contract_type AS id, COUNT(*) AS n FROM tblpur_orders r WHERE r.contract_type IN (${ids}) GROUP BY r.contract_type`,
  },
  {
    group: 'purchaseQuotations',
    table: 'tblpur_estimates',
    column: 'contract_type',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.contract_type AS id, COUNT(*) AS n FROM tblpur_estimates r WHERE r.contract_type IN (${ids}) GROUP BY r.contract_type`,
  },
  {
    group: 'shippingCharges',
    table: 'tblinv_shipping_charges',
    column: 'contract_type',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.contract_type AS id, COUNT(*) AS n FROM tblinv_shipping_charges r WHERE r.contract_type IN (${ids}) GROUP BY r.contract_type`,
  },
  {
    group: 'expenses',
    table: 'tblexpenses',
    column: 'contract_type',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.contract_type AS id, COUNT(*) AS n FROM tblexpenses r WHERE r.contract_type IN (${ids}) GROUP BY r.contract_type`,
  },
  {
    group: 'assets',
    table: 'tblfe_asset_creation',
    column: 'contract_type',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.contract_type AS id, COUNT(*) AS n FROM tblfe_asset_creation r WHERE r.contract_type IN (${ids}) GROUP BY r.contract_type`,
  },
]);

/** The key a candidate answers by: `table.column`, as declared. */
export function referenceKey(reference: Pick<ContractTypeReference, 'table' | 'column'>): string {
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

function keyOf(row: ContractTypeRow, sortField: ContractTypesSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** A `before` cursor reads the rows just before it in the reversed order, then reverses them back. */
function readDirection(request: ContractTypesListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

/** Next exists while rows remain after the page, Previous while rows exist before it. */
function pageMeta(
  sortField: ContractTypesSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<ContractTypesPage, 'items'> {
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
 * Adds one statement's `{ id, n }` rows to the group's count of each contract type it names.
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
export class ContractTypesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(request: ContractTypesListRequest): Promise<ContractTypesPage> {
    const { sortField, order, cursor, limit } = request;
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.prisma.client.tblcontracts_types.findMany({
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
      this.prisma.client.tblcontracts_types.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblcontracts_types.count({
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

  count(request: ContractTypesListRequest): Promise<number> {
    return this.prisma.client.tblcontracts_types.count({ where: matchOf(request.search) });
  }

  async findById(id: number): Promise<ContractTypeRow | null> {
    const row = await this.prisma.client.tblcontracts_types.findFirst({
      where: { id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  async create(input: NewContractType): Promise<ContractTypeRow> {
    const row = await this.prisma.client.tblcontracts_types.create({
      data: { name: input.name },
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  async update(id: number, patch: { readonly name: string }): Promise<ContractTypeRow | null> {
    try {
      const row = await this.prisma.client.tblcontracts_types.update({
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

  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tblcontracts_types.deleteMany({ where: { id } });
    return count > 0;
  }

  async presentReferences(): Promise<ReadonlySet<string>> {
    const tables = [...new Set(CONTRACT_TYPE_REFERENCES.map((reference) => reference.table))];
    const columns = [...new Set(CONTRACT_TYPE_REFERENCES.map((reference) => reference.column))];
    const rows = presentColumnsSchema.parse(
      await this.prisma.client
        .$queryRaw`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${Prisma.join(tables)}) AND COLUMN_NAME IN (${Prisma.join(columns)})`,
    );
    const found = new Set(rows.map((row) => `${row.t}.${row.c}`.toLowerCase()));
    return new Set(
      CONTRACT_TYPE_REFERENCES.map(referenceKey).filter((key) => found.has(key.toLowerCase())),
    );
  }

  async usageByContractType(
    ids: readonly number[],
  ): Promise<ReadonlyMap<number, ContractTypeUsage>> {
    if (ids.length === 0) return new Map();
    const present = await this.presentReferences();
    const reads = CONTRACT_TYPE_REFERENCES.filter((reference) =>
      present.has(referenceKey(reference)),
    );
    const bound = Prisma.join([...ids]);
    const answers = await Promise.all(
      reads.map((reference) => reference.count(this.prisma.client, bound)),
    );
    const totals = new Map<number, MutableUsage>(
      ids.map((id) => [id, { ...NO_CONTRACT_TYPE_USAGE }]),
    );
    reads.forEach((reference, index) => {
      addCounts(totals, reference.group, answers[index]);
    });
    return totals;
  }

  async listAll(): Promise<readonly ContractTypeRow[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tblcontracts_types.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: CONTRACT_TYPES_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > CONTRACT_TYPES_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(CONTRACT_TYPES_FACADE_MAX_ROWS)} contract types: the full list was refused, not truncated`,
      );
    }
    return rows;
  }

  async findByIds(ids: readonly number[]): Promise<readonly ContractTypeRow[]> {
    if (ids.length === 0) return [];
    return rowsSchema.parse(
      await this.prisma.client.tblcontracts_types.findMany({
        where: { id: { in: [...ids] } },
        select: COLUMNS,
      }),
    );
  }
}
