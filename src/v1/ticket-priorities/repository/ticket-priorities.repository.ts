import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import {
  TICKET_PRIORITIES_FACADE_MAX_ROWS,
  type NewTicketPriority,
  type TicketPriority,
  type TicketPrioritiesListRequest,
  type TicketPrioritiesPage,
  type TicketPrioritiesSortField,
} from '../model/ticket-priority.model.js';

const RECORD_NOT_FOUND = 'P2025';
/** `tbltickets_priorities.priorityid` is a signed INT. */
const MAX_SIGNED_INT_ID = 2_147_483_647;

const COLUMNS = { priorityid: true, name: true } as const;

/** The Prisma column each API sort name reads. */
const COLUMN_OF = { id: 'priorityid', name: 'name' } as const satisfies Record<
  TicketPrioritiesSortField,
  string
>;

const rowSchema = z
  .object({ priorityid: z.number().int(), name: z.string() })
  .transform((row): TicketPriority => ({ id: row.priorityid, name: row.name }));
const rowsSchema = z.array(rowSchema);

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];

function matchOf(search: string | null): WhereValue {
  if (search === null) return {};
  const or: WhereValue[] = [{ name: { contains: search } }];
  if (/^\d+$/.test(search) && Number(search) <= MAX_SIGNED_INT_ID)
    or.push({ priorityid: Number(search) });
  return { OR: or };
}

function keyOf(row: TicketPriority, sortField: TicketPrioritiesSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

function readDirection(request: TicketPrioritiesListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

function pageMeta(
  sortField: TicketPrioritiesSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<TicketPrioritiesPage, 'items'> {
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

function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === RECORD_NOT_FOUND
  );
}

@Injectable()
export class TicketPrioritiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(request: TicketPrioritiesListRequest): Promise<TicketPrioritiesPage> {
    const { sortField, order, cursor, limit } = request;
    const column = COLUMN_OF[sortField];
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.prisma.client.tbltickets_priorities.findMany({
      where:
        cursor === null
          ? match
          : { AND: [match, keysetWhere(column, 'priorityid', cursor, order)] },
      orderBy: [{ [column]: read }, { priorityid: read }],
      take: limit,
      select: COLUMNS,
    });
    const items = rowsSchema.parse(rows);
    if (read !== order) items.reverse();
    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tbltickets_priorities.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tbltickets_priorities.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  column,
                  'priorityid',
                  { sort: sortField, key: first, direction: 'before' },
                  order,
                ),
              ],
            },
          }),
    ]);
    return { items, ...pageMeta(sortField, keys, total, before) };
  }

  count(request: TicketPrioritiesListRequest): Promise<number> {
    return this.prisma.client.tbltickets_priorities.count({ where: matchOf(request.search) });
  }

  async findById(id: number): Promise<TicketPriority | null> {
    const row = await this.prisma.client.tbltickets_priorities.findFirst({
      where: { priorityid: id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  async create(input: NewTicketPriority): Promise<TicketPriority> {
    const row = await this.prisma.client.tbltickets_priorities.create({
      data: { name: input.name },
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  async update(id: number, patch: { readonly name: string }): Promise<TicketPriority | null> {
    try {
      const row = await this.prisma.client.tbltickets_priorities.update({
        where: { priorityid: id },
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
    const { count } = await this.prisma.client.tbltickets_priorities.deleteMany({
      where: { priorityid: id },
    });
    return count > 0;
  }

  /** True while any ticket uses the priority (`tbltickets.priority`). */
  async isReferenced(id: number): Promise<boolean> {
    const count = await this.prisma.client.tbltickets.count({ where: { priority: id } });
    return count > 0;
  }

  async listAll(): Promise<readonly TicketPriority[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tbltickets_priorities.findMany({
        orderBy: [{ name: 'asc' }, { priorityid: 'asc' }],
        take: TICKET_PRIORITIES_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > TICKET_PRIORITIES_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(TICKET_PRIORITIES_FACADE_MAX_ROWS)} ticket priorities: the full list was refused, not truncated`,
      );
    }
    return rows;
  }
}
