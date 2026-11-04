import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import { TICKET_STATUS_ID_MAX } from '../dto/ticket-statuses.dto.js';
import type {
  NewTicketStatus,
  TicketStatus,
  TicketStatusPatch,
  TicketStatusesListRequest,
  TicketStatusesPage,
  TicketStatusesSortField,
} from '../model/ticket-statuses.model.js';

const RECORD_NOT_FOUND = 'P2025';

const COLUMNS = {
  ticketstatusid: true,
  name: true,
  isdefault: true,
  statuscolor: true,
  statusorder: true,
} as const;

const rowSchema = z.object({
  ticketstatusid: z.number().int(),
  name: z.string(),
  isdefault: z.number().int(),
  statuscolor: z.string().nullable(),
  statusorder: z.number().int().nullable(),
});

const rowsSchema = z.array(rowSchema);

const DEFAULT_LIST_REQUEST: TicketStatusesListRequest = {
  search: null,
  sortField: 'id',
  order: 'desc',
  cursor: null,
  limit: LIST_QUERY_LIMITS.default,
};

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];

function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === RECORD_NOT_FOUND
  );
}

function matchOf(search: string | null): WhereValue {
  if (search === null) return {};

  const or: WhereValue[] = [{ name: { contains: search } }];

  if (/^\d+$/.test(search)) {
    const id = Number(search);
    if (Number.isSafeInteger(id) && id > 0 && id <= TICKET_STATUS_ID_MAX) {
      or.push({ ticketstatusid: id });
    }
  }

  return { OR: or };
}

function keyOf(row: TicketStatus, sortField: TicketStatusesSortField): Key {
  return sortField === 'name'
    ? [row.name, row.ticketstatusid]
    : [row.ticketstatusid, row.ticketstatusid];
}

function readDirection(request: TicketStatusesListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

function pageMeta(
  sortField: TicketStatusesSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<TicketStatusesPage, 'items'> {
  const first = keys[0];
  const last = keys.at(-1);

  if (first === undefined || last === undefined) {
    return {
      nextCursor: null,
      prevCursor: null,
      total,
      rangeStart: 0,
    };
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

@Injectable()
export class TicketStatusesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    request: TicketStatusesListRequest = DEFAULT_LIST_REQUEST,
  ): Promise<TicketStatusesPage> {
    const normalized: TicketStatusesListRequest = { ...DEFAULT_LIST_REQUEST, ...request };
    const { sortField, order, cursor, limit } = normalized;
    const match = matchOf(normalized.search);
    const read = readDirection(normalized);

    const rows = await this.prisma.client.tbltickets_status.findMany({
      where:
        cursor === null
          ? match
          : {
              AND: [
                match,
                keysetWhere(
                  sortField === 'id' ? 'ticketstatusid' : 'name',
                  'ticketstatusid',
                  cursor,
                  order,
                ),
              ],
            },
      orderBy: [
        { [sortField === 'id' ? 'ticketstatusid' : 'name']: read },
        { ticketstatusid: read },
      ],
      take: limit,
      select: COLUMNS,
    });

    const statuses = rowsSchema.parse(rows);
    const ids = statuses.map((status) => status.ticketstatusid);

    const counts = await this.prisma.client.tbltickets.groupBy({
      by: ['status'],
      where: { status: { in: ids } },
      _count: { _all: true },
    });

    const countByStatus = new Map(counts.map((row) => [row.status, row._count._all]));

    const items: TicketStatus[] = statuses.map((status) => ({
      ...status,
      ticket_count: countByStatus.get(status.ticketstatusid) ?? 0,
    }));

    if (read !== order) items.reverse();

    const keys = items.map((status) => keyOf(status, sortField));
    const first = keys[0];

    const [total, before] = await Promise.all([
      this.prisma.client.tbltickets_status.count({
        where: match,
      }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tbltickets_status.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  sortField === 'id' ? 'ticketstatusid' : 'name',
                  'ticketstatusid',
                  {
                    sort: sortField,
                    key: first,
                    direction: 'before',
                  },
                  order,
                ),
              ],
            },
          }),
    ]);

    return {
      items,
      ...pageMeta(sortField, keys, total, before),
    };
  }

  count(request: TicketStatusesListRequest): Promise<number> {
    return this.prisma.client.tbltickets_status.count({
      where: matchOf(request.search),
    });
  }

  /** Full list for internal consumers that still require every status. */
  async listAll(): Promise<readonly TicketStatus[]> {
    const statuses = rowsSchema.parse(
      await this.prisma.client.tbltickets_status.findMany({
        orderBy: [{ statusorder: 'asc' }, { ticketstatusid: 'asc' }],
        select: COLUMNS,
      }),
    );
    const ids = statuses.map((status) => status.ticketstatusid);

    const counts = await this.prisma.client.tbltickets.groupBy({
      by: ['status'],
      where: { status: { in: ids } },
      _count: { _all: true },
    });

    const countByStatus = new Map(counts.map((row) => [row.status, row._count._all]));

    return statuses.map((status) => ({
      ...status,
      ticket_count: countByStatus.get(status.ticketstatusid) ?? 0,
    }));
  }

  async findById(id: number): Promise<TicketStatus | null> {
    const row = await this.prisma.client.tbltickets_status.findFirst({
      where: { ticketstatusid: id },
      select: COLUMNS,
    });

    if (row === null) return null;

    const status = rowSchema.parse(row);
    const ticket_count = await this.prisma.client.tbltickets.count({
      where: { status: id },
    });

    return { ...status, ticket_count };
  }

  async create(input: NewTicketStatus): Promise<TicketStatus> {
    const row = await this.prisma.client.tbltickets_status.create({
      data: input,
      select: COLUMNS,
    });

    return { ...rowSchema.parse(row), ticket_count: 0 };
  }

  async update(id: number, patch: TicketStatusPatch): Promise<TicketStatus | null> {
    try {
      const row = await this.prisma.client.tbltickets_status.update({
        where: { ticketstatusid: id },
        data: patch,
        select: COLUMNS,
      });

      const status = rowSchema.parse(row);
      const ticket_count = await this.prisma.client.tbltickets.count({
        where: { status: id },
      });

      return { ...status, ticket_count };
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async hasTicketReferences(id: number): Promise<boolean> {
    return (
      (await this.prisma.client.tbltickets.count({
        where: { status: id },
      })) > 0
    );
  }

  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tbltickets_status.deleteMany({
      where: { ticketstatusid: id },
    });

    return count > 0;
  }
}
