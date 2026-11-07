import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import type {
  NewTodo,
  TodoListRequest,
  TodoPage,
  TodoRow,
  TodoStatus,
} from '../model/todo.model.js';
import { todoCursorWhere } from './todo.cursor.js';
const FINISHED = { yes: true, no: false } as const;
const RECORD_NOT_FOUND = 'P2025';
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === RECORD_NOT_FOUND
  );
}
const COLUMNS = {
  todoid: true,
  description: true,
  staffid: true,
  dateadded: true,
  finished: true,
  datefinished: true,
  item_order: true,
} as const;

const rowSchema = z
  .object({
    todoid: z.number().int(),
    description: z.string(),
    staffid: z.number().int(),
    dateadded: z.date(),
    finished: z.union([z.boolean(), z.number()]),
    datefinished: z.date().nullable(),
    item_order: z.number().int().nullable(),
  })
  .transform((row): TodoRow => ({
    id: row.todoid,
    description: row.description,
    staffId: row.staffid,
    dateAdded: row.dateadded,
    finished: row.finished === true || row.finished === 1,
    dateFinished: row.datefinished,
    itemOrder: row.item_order,
  }));

const rowsSchema = z.array(rowSchema);

const flagOf = (status: TodoStatus): boolean =>
  status === 'finished' ? FINISHED.yes : FINISHED.no;

/** Perfex sorts both panels by `item_order` ascending, then `todoid` ascending. */
function orderOf() {
  return [{ item_order: 'asc' as const }, { todoid: 'asc' as const }];
}

@Injectable()
export class TodoRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One keyset page of one panel and the panel's total. */
  async list(staffId: number, request: TodoListRequest): Promise<TodoPage> {
    const baseWhere = {
      staffid: staffId,
      finished: flagOf(request.status),
    };

    const where = {
      ...baseWhere,
      ...(request.cursor === null ? {} : todoCursorWhere(request.cursor)),
    };

    const [rows, total] = await Promise.all([
      this.prisma.client.tbltodos.findMany({
        where,
        orderBy: orderOf(),
        take: request.limit + 1,
        select: COLUMNS,
      }),
      this.prisma.client.tbltodos.count({ where: baseWhere }),
    ]);

    const parsedRows = rowsSchema.parse(rows);
    const hasMore = parsedRows.length > request.limit;

    return {
      items: parsedRows.slice(0, request.limit),
      total,
      hasMore,
    };
  }

  async findById(staffId: number, id: number): Promise<TodoRow | null> {
    const row = await this.prisma.client.tbltodos.findFirst({
      where: { todoid: id, staffid: staffId },
      select: COLUMNS,
    });

    return row === null ? null : rowSchema.parse(row);
  }

  /** Inserts an unfinished to do with an empty order, placing it first like Perfex. */
  async create(input: NewTodo): Promise<TodoRow> {
    const row = await this.prisma.client.tbltodos.create({
      data: {
        description: input.description,
        staffid: input.staffId,
        dateadded: input.dateAdded,
        finished: FINISHED.no,
        datefinished: null,
        item_order: null,
      },
      select: COLUMNS,
    });

    return rowSchema.parse(row);
  }

  /** The description only; `null` when the to do is not the caller's or is gone. */
  async updateDescription(
    staffId: number,
    id: number,
    description: string,
  ): Promise<TodoRow | null> {
    try {
      const row = await this.prisma.client.tbltodos.update({
        where: { todoid: id, staffid: staffId },
        data: { description },
        select: COLUMNS,
      });
      return rowSchema.parse(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async setFinished(
    staffId: number,
    id: number,
    finished: boolean,
    dateFinished: Date | null,
  ): Promise<TodoRow | null> {
    try {
      const row = await this.prisma.client.tbltodos.update({
        where: { todoid: id, staffid: staffId },
        data: {
          finished: finished ? FINISHED.yes : FINISHED.no,
          datefinished: dateFinished,
        },
        select: COLUMNS,
      });
      return rowSchema.parse(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Saves the requested order atomically. A missing or foreign id changes nothing.
   * @complexity O(n) over the ordered ids
   */
  async reorder(staffId: number, finished: boolean, items: readonly number[]): Promise<boolean> {
    return this.prisma.client.$transaction(async (tx) => {
      const rows = await tx.tbltodos.findMany({
        where: {
          staffid: staffId,
          finished,
          todoid: { in: [...items] },
        },
        select: { todoid: true },
      });

      if (rows.length !== items.length) return false;

      await Promise.all(
        items.map((id, itemOrder) =>
          tx.tbltodos.updateMany({
            where: { todoid: id, staffid: staffId },
            data: {
              item_order: itemOrder,
              finished,
            },
          }),
        ),
      );

      return true;
    });
  }

  /** `false` when nothing was deleted (not the caller's, or gone). */
  async remove(staffId: number, id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tbltodos.deleteMany({
      where: { todoid: id, staffid: staffId },
    });

    return count > 0;
  }

  countUnfinished(staffId: number): Promise<number> {
    return this.prisma.client.tbltodos.count({
      where: { staffid: staffId, finished: FINISHED.no },
    });
  }
}
