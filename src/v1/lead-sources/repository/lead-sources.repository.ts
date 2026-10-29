/**
 * Repository: the module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Owner of the table it writes: `tblleads_sources` (node: `name` VARCHAR(150); `id` assigned by DB).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { Prisma } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import {
  LEAD_SOURCES_FACADE_MAX_ROWS,
  type LeadSourceRow,
  type LeadSourcesListRequest,
  type LeadSourcesPage,
  type LeadSourcesSortField,
  type LeadSourceUsage,
  type NewLeadSource,
} from '../model/lead-sources.model.js';
import { NO_LEAD_SOURCE_USAGE } from '../service/lead-sources.transformer.js';

/** Prisma's "record to update not found". */
const RECORD_NOT_FOUND = 'P2025';

/** The largest value of MySQL's `INT UNSIGNED` (the id column). */
const MAX_UNSIGNED_INT_ID = 4_294_967_295;

/** The columns of the table; nothing else is selected. */
const COLUMNS = { id: true, name: true } as const;

const rowSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
  })
  .transform((row): LeadSourceRow => ({
    id: row.id,
    name: row.name,
  }));
const rowsSchema = z.array(rowSchema);

/** `COUNT(*)` arrives from MySQL as a bigint; a driver may hand a number. */
const countSchema = z.union([z.bigint(), z.number().int()]).transform(Number);
const usageRowsSchema = z.array(z.object({ id: z.coerce.number().int(), n: countSchema }));
const presentColumnsSchema = z.array(z.object({ t: z.string(), c: z.string() }));

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];
type UsageGroup = keyof LeadSourceUsage;
type RawClient = PrismaService['client'];

/** One lead source's counts while the answers are summed into them. */
type MutableUsage = Record<UsageGroup, number>;

export type LeadSourceMatch = 'id';

export interface LeadSourceReference {
  readonly group: UsageGroup;
  readonly table: string;
  readonly column: string;
  readonly match: LeadSourceMatch;
  readonly count: (client: RawClient, ids: Prisma.Sql) => Promise<unknown>;
}

export const LEAD_SOURCE_REFERENCES: readonly LeadSourceReference[] = Object.freeze([
  {
    group: 'leads',
    table: 'tblleads',
    column: 'source',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.source AS id, COUNT(*) AS n FROM tblleads r WHERE r.source IN (${ids}) GROUP BY r.source`,
  },
  {
    group: 'emailIntegrations',
    table: 'tblleads_email_integration',
    column: 'lead_source',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.lead_source AS id, COUNT(*) AS n FROM tblleads_email_integration r WHERE r.lead_source IN (${ids}) GROUP BY r.lead_source`,
  },
  {
    group: 'webToLeadForms',
    table: 'tblweb_to_lead',
    column: 'lead_source',
    match: 'id',
    count: (client, ids) =>
      client.$queryRaw`SELECT r.lead_source AS id, COUNT(*) AS n FROM tblweb_to_lead r WHERE r.lead_source IN (${ids}) GROUP BY r.lead_source`,
  },
]);

export function referenceKey(reference: Pick<LeadSourceReference, 'table' | 'column'>): string {
  return `${reference.table}.${reference.column}`;
}

function matchOf(search: string | null): WhereValue {
  if (search === null) return {};
  const or: WhereValue[] = [{ name: { contains: search } }];
  if (/^\d+$/.test(search) && Number(search) <= MAX_UNSIGNED_INT_ID)
    or.push({ id: Number(search) });
  return { OR: or };
}

function keyOf(row: LeadSourceRow, sortField: LeadSourcesSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

function readDirection(request: LeadSourcesListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

function pageMeta(
  sortField: LeadSourcesSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<LeadSourcesPage, 'items'> {
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

function addCounts(totals: Map<number, MutableUsage>, group: UsageGroup, answer: unknown): void {
  for (const { id, n } of usageRowsSchema.parse(answer)) {
    const counts = totals.get(id);
    if (counts !== undefined) counts[group] += n;
  }
}

function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === RECORD_NOT_FOUND
  );
}

@Injectable()
export class LeadSourcesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(request: LeadSourcesListRequest): Promise<LeadSourcesPage> {
    const { sortField, order, cursor, limit } = request;
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.prisma.client.tblleads_sources.findMany({
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
      this.prisma.client.tblleads_sources.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblleads_sources.count({
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

  count(request: LeadSourcesListRequest): Promise<number> {
    return this.prisma.client.tblleads_sources.count({ where: matchOf(request.search) });
  }

  async findById(id: number): Promise<LeadSourceRow | null> {
    const row = await this.prisma.client.tblleads_sources.findFirst({
      where: { id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  async create(input: NewLeadSource): Promise<LeadSourceRow> {
    const row = await this.prisma.client.tblleads_sources.create({
      data: { name: input.name },
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  async update(id: number, patch: { readonly name: string }): Promise<LeadSourceRow | null> {
    try {
      const row = await this.prisma.client.tblleads_sources.update({
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
    const { count } = await this.prisma.client.tblleads_sources.deleteMany({ where: { id } });
    return count > 0;
  }

  async presentReferences(): Promise<ReadonlySet<string>> {
    const tables = [...new Set(LEAD_SOURCE_REFERENCES.map((reference) => reference.table))];
    const columns = [...new Set(LEAD_SOURCE_REFERENCES.map((reference) => reference.column))];
    const rows = presentColumnsSchema.parse(
      await this.prisma.client
        .$queryRaw`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${Prisma.join(tables)}) AND COLUMN_NAME IN (${Prisma.join(columns)})`,
    );
    const found = new Set(rows.map((row) => `${row.t}.${row.c}`.toLowerCase()));
    return new Set(
      LEAD_SOURCE_REFERENCES.map(referenceKey).filter((key) => found.has(key.toLowerCase())),
    );
  }

  async usageByLeadSource(ids: readonly number[]): Promise<ReadonlyMap<number, LeadSourceUsage>> {
    if (ids.length === 0) return new Map();
    const present = await this.presentReferences();
    const reads = LEAD_SOURCE_REFERENCES.filter((reference) =>
      present.has(referenceKey(reference)),
    );
    const bound = Prisma.join([...ids]);
    const answers = await Promise.all(
      reads.map((reference) => reference.count(this.prisma.client, bound)),
    );
    const totals = new Map<number, MutableUsage>(
      ids.map((id) => [id, { ...NO_LEAD_SOURCE_USAGE }]),
    );
    reads.forEach((reference, index) => {
      addCounts(totals, reference.group, answers[index]);
    });
    return totals;
  }

  async listAll(): Promise<readonly LeadSourceRow[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tblleads_sources.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: LEAD_SOURCES_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > LEAD_SOURCES_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(LEAD_SOURCES_FACADE_MAX_ROWS)} lead sources: the full list was refused, not truncated`,
      );
    }
    return rows;
  }

  async findByIds(ids: readonly number[]): Promise<readonly LeadSourceRow[]> {
    if (ids.length === 0) return [];
    return rowsSchema.parse(
      await this.prisma.client.tblleads_sources.findMany({
        where: { id: { in: [...ids] } },
        select: COLUMNS,
      }),
    );
  }
}
