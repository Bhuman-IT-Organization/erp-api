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

const FINISHED = { yes: true, no: false } as const;

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

/** Perfex's orders: the unfinished by `item_order`, the finished by `datefinished` descending. */
function orderOf(status: TodoStatus) {
  return status === 'finished'
    ? [{ datefinished: 'desc' as const }, { todoid: 'desc' as const }]
    : [{ item_order: 'asc' as const }, { todoid: 'asc' as const }];
}

@Injectable()
export class TodoRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One page of one panel and the panel's total. */
  async list(staffId: number, request: TodoListRequest): Promise<TodoPage> {
    const where = { staffid: staffId, finished: flagOf(request.status) };
    const [rows, total] = await Promise.all([
      this.prisma.client.tbltodos.findMany({
        where,
        orderBy: orderOf(request.status),
        skip: request.offset,
        take: request.limit,
        select: COLUMNS,
      }),
      this.prisma.client.tbltodos.count({ where }),
    ]);
    return { items: rowsSchema.parse(rows), total };
  }

  async findById(staffId: number, id: number): Promise<TodoRow | null> {
    const row = await this.prisma.client.tbltodos.findFirst({
      where: { todoid: id, staffid: staffId },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  /** Inserts an unfinished to do at the end of the caller's own order. */
  async create(input: NewTodo): Promise<TodoRow> {
    const last = await this.prisma.client.tbltodos.aggregate({
      where: { staffid: input.staffId },
      _max: { item_order: true },
    });
    const row = await this.prisma.client.tbltodos.create({
      data: {
        description: input.description,
        staffid: input.staffId,
        dateadded: input.dateAdded,
        finished: FINISHED.no,
        datefinished: null,
        item_order: (last._max.item_order ?? 0) + 1,
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
    const { count } = await this.prisma.client.tbltodos.updateMany({
      where: { todoid: id, staffid: staffId },
      data: { description },
    });
    return count === 0 ? null : this.findById(staffId, id);
  }

  /** Finishes (with the wall clock) or reopens (`datefinished` NULL); `null` when not found. */
  async setFinished(
    staffId: number,
    id: number,
    finished: boolean,
    dateFinished: Date | null,
  ): Promise<TodoRow | null> {
    const { count } = await this.prisma.client.tbltodos.updateMany({
      where: { todoid: id, staffid: staffId },
      data: { finished: finished ? FINISHED.yes : FINISHED.no, datefinished: dateFinished },
    });
    return count === 0 ? null : this.findById(staffId, id);
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
