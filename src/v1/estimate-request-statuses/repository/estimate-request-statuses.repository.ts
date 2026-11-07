import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '../../../shared/db/generated/client.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import {
  ESTIMATE_REQUEST_STATUS_ID_MAX,
  ESTIMATE_REQUEST_STATUSES_FACADE_MAX_ROWS,
} from '../model/estimate-request-statuses.model.js';
import type {
  EstimateRequestStatusPatch,
  EstimateRequestStatusRow,
  EstimateRequestStatusesListRequest,
  EstimateRequestStatusesPage,
  EstimateRequestStatusSortField,
  NewEstimateRequestStatus,
} from '../model/estimate-request-statuses.model.js';

const COLUMNS = { id: true, name: true, color: true, statusorder: true, flag: true } as const;
const rowSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  color: z.string().nullable(),
  statusorder: z.number().int().nullable(),
  flag: z.string().nullable(),
});
const rowsSchema = z.array(rowSchema);
const presentColumnsSchema = z.array(z.object({ t: z.string(), c: z.string() }));
const countRowsSchema = z.array(z.object({ n: z.union([z.bigint(), z.number().int()]) }));
const groupedCountsSchema = z.array(
  z.object({ status: z.number().int().nullable(), _count: z.object({ _all: z.number().int() }) }),
);
type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];

export const ESTIMATE_REQUEST_STATUS_REFERENCES = [
  {
    table: 'tblestimate_requests',
    column: 'status',
    count: (client: PrismaService['client'], id: number) =>
      client.$queryRaw`SELECT COUNT(*) AS n FROM tblestimate_requests WHERE status = ${id}`,
  },
  {
    table: 'tblestimate_request_forms',
    column: 'status',
    count: (client: PrismaService['client'], id: number) =>
      client.$queryRaw`SELECT COUNT(*) AS n FROM tblestimate_request_forms WHERE status = ${id}`,
  },
] as const;

function matchOf(search: string | null): WhereValue {
  if (search === null) return {};
  const or: WhereValue[] = [{ name: { contains: search } }];
  if (/^\d+$/.test(search)) {
    const id = Number(search);
    if (Number.isSafeInteger(id) && id > 0 && id <= ESTIMATE_REQUEST_STATUS_ID_MAX) {
      or.push({ id });
    }
  }
  return { OR: or };
}

function keyOf(row: EstimateRequestStatusRow, field: EstimateRequestStatusSortField): Key {
  return field === 'name' ? [row.name, row.id] : [row.id, row.id];
}

function pageMeta(
  field: EstimateRequestStatusSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<EstimateRequestStatusesPage, 'items'> {
  const first = keys[0];
  const last = keys.at(-1);
  if (first === undefined || last === undefined) {
    return { nextCursor: null, prevCursor: null, total, rangeStart: 0 };
  }
  const rangeStart = before + 1;
  return {
    nextCursor: rangeStart - 1 + keys.length < total ? encodeCursor(field, last, 'after') : null,
    prevCursor: rangeStart > 1 ? encodeCursor(field, first, 'before') : null,
    total,
    rangeStart,
  };
}

function isRecordNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025';
}

@Injectable()
export class EstimateRequestStatusesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(request: EstimateRequestStatusesListRequest): Promise<EstimateRequestStatusesPage> {
    const { search, sortField, order, cursor, limit } = request;
    const match = matchOf(search);
    let read = order;
    if (cursor?.direction === 'before') read = order === 'asc' ? 'desc' : 'asc';
    const rows = rowsSchema.parse(
      await this.prisma.client.tblestimate_request_status.findMany({
        where:
          cursor === null
            ? match
            : {
                AND: [match, keysetWhere(sortField, 'id', cursor, order)],
              },
        orderBy: [{ [sortField]: read }, { id: read }],
        take: limit,
        select: COLUMNS,
      }),
    );
    const ids = rows.map((row) => row.id);
    const counts =
      ids.length === 0
        ? []
        : groupedCountsSchema.parse(
            await this.prisma.client.tblestimate_requests.groupBy({
              by: ['status'],
              where: { status: { in: ids } },
              _count: { _all: true },
            }),
          );
    const countById = new Map(
      counts.flatMap(({ status, _count }) => (status === null ? [] : [[status, _count._all]])),
    );
    const items: EstimateRequestStatusRow[] = rows.map((row) => ({
      ...row,
      total_request: countById.get(row.id) ?? 0,
    }));
    if (read !== order) items.reverse();
    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tblestimate_request_status.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblestimate_request_status.count({
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

  count(request: EstimateRequestStatusesListRequest): Promise<number> {
    return this.prisma.client.tblestimate_request_status.count({
      where: matchOf(request.search),
    });
  }

  async findById(id: number): Promise<EstimateRequestStatusRow | null> {
    const row = await this.prisma.client.tblestimate_request_status.findFirst({
      where: { id },
      select: COLUMNS,
    });
    if (row === null) return null;
    const parsed = rowSchema.parse(row);
    const total_request = await this.prisma.client.tblestimate_requests.count({
      where: { status: id },
    });
    return { ...parsed, total_request };
  }

  async create(input: NewEstimateRequestStatus): Promise<EstimateRequestStatusRow> {
    const row = await this.prisma.client.tblestimate_request_status.create({
      data: input,
      select: COLUMNS,
    });
    return { ...rowSchema.parse(row), total_request: 0 };
  }

  async update(
    id: number,
    patch: EstimateRequestStatusPatch,
  ): Promise<EstimateRequestStatusRow | null> {
    try {
      const row = await this.prisma.client.tblestimate_request_status.update({
        where: { id },
        data: patch,
        select: COLUMNS,
      });
      const total_request = await this.prisma.client.tblestimate_requests.count({
        where: { status: id },
      });
      return { ...rowSchema.parse(row), total_request };
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async deleteReferenceCount(id: number): Promise<{
    readonly requestCount: number;
    readonly formCount: number;
  }> {
    const tables = ESTIMATE_REQUEST_STATUS_REFERENCES.map(({ table }) => table);
    const columns = ESTIMATE_REQUEST_STATUS_REFERENCES.map(({ column }) => column);
    const present = presentColumnsSchema.parse(
      await this.prisma.client
        .$queryRaw`SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${Prisma.join(tables)}) AND COLUMN_NAME IN (${Prisma.join(columns)})`,
    );
    const existing = new Set(present.map(({ t, c }) => `${t}.${c}`.toLowerCase()));
    const reads = ESTIMATE_REQUEST_STATUS_REFERENCES.filter(({ table, column }) =>
      existing.has(`${table}.${column}`.toLowerCase()),
    );
    const counts = await Promise.all(reads.map(({ count }) => count(this.prisma.client, id)));
    const values = counts.map((result) => {
      const [row] = countRowsSchema.parse(result);
      return Number(row?.n ?? 0);
    });
    return {
      requestCount: values[reads.findIndex(({ table }) => table === 'tblestimate_requests')] ?? 0,
      formCount: values[reads.findIndex(({ table }) => table === 'tblestimate_request_forms')] ?? 0,
    };
  }

  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tblestimate_request_status.deleteMany({
      where: { id },
    });
    return count > 0;
  }

  async listAll(): Promise<readonly EstimateRequestStatusRow[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tblestimate_request_status.findMany({
        orderBy: [{ statusorder: 'asc' }, { id: 'asc' }],
        take: ESTIMATE_REQUEST_STATUSES_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > ESTIMATE_REQUEST_STATUSES_FACADE_MAX_ROWS) {
      throw new AppError('ERP-INTERNAL-0001', 'too many estimate request statuses');
    }
    if (rows.length === 0) return [];
    const ids = rows.map(({ id }) => id);
    const counts = groupedCountsSchema.parse(
      await this.prisma.client.tblestimate_requests.groupBy({
        by: ['status'],
        where: { status: { in: ids } },
        _count: { _all: true },
      }),
    );
    const countById = new Map(
      counts.flatMap(({ status, _count }) => (status === null ? [] : [[status, _count._all]])),
    );
    return rows.map((row) => ({ ...row, total_request: countById.get(row.id) ?? 0 }));
  }
}
