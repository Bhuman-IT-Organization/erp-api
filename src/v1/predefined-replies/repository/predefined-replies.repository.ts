import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import type {
  NewPredefinedReply,
  PredefinedReply,
  PredefinedRepliesListRequest,
  PredefinedRepliesPage,
  PredefinedRepliesSortField,
} from '../model/predefined-replies.model.js';

const predefinedReplyRowSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  message: z.string(),
});

const rowsSchema = z.array(predefinedReplyRowSchema);

export type PredefinedReplyRow = z.infer<typeof predefinedReplyRowSchema>;

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];

function matchOf(search: string | null): WhereValue {
  return search === null
    ? {}
    : {
        OR: [{ name: { contains: search } }, { message: { contains: search } }],
      };
}

function keyOf(row: PredefinedReply, sortField: PredefinedRepliesSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

function readDirection(request: PredefinedRepliesListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

function pageMeta(
  sortField: PredefinedRepliesSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<PredefinedRepliesPage, 'items'> {
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

@Injectable()
export class PredefinedRepliesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(request: PredefinedRepliesListRequest): Promise<PredefinedRepliesPage> {
    const { sortField, order, cursor, limit } = request;
    const match = matchOf(request.search);
    const read = readDirection(request);

    const rows = await this.prisma.client.tbltickets_predefined_replies.findMany({
      where:
        cursor === null
          ? match
          : {
              AND: [match, keysetWhere(sortField, 'id', cursor, order)],
            },
      orderBy: [{ [sortField]: read }, { id: read }],
      take: limit,
      select: { id: true, name: true, message: true },
    });

    const items = rowsSchema.parse(rows);
    if (read !== order) items.reverse();

    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];

    const [total, before] = await Promise.all([
      this.prisma.client.tbltickets_predefined_replies.count({
        where: match,
      }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tbltickets_predefined_replies.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  sortField,
                  'id',
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

    return { items, ...pageMeta(sortField, keys, total, before) };
  }

  async findById(id: number): Promise<PredefinedReplyRow | null> {
    const row = await this.prisma.client.tbltickets_predefined_replies.findUnique({
      where: { id },
      select: { id: true, name: true, message: true },
    });

    return row === null ? null : predefinedReplyRowSchema.parse(row);
  }

  async create(input: NewPredefinedReply): Promise<PredefinedReplyRow> {
    const row = await this.prisma.client.tbltickets_predefined_replies.create({
      data: input,
      select: { id: true, name: true, message: true },
    });

    return predefinedReplyRowSchema.parse(row);
  }

  async update(id: number, input: NewPredefinedReply): Promise<PredefinedReplyRow | null> {
    const existing = await this.findById(id);
    if (existing === null) return null;

    const row = await this.prisma.client.tbltickets_predefined_replies.update({
      where: { id },
      data: input,
      select: { id: true, name: true, message: true },
    });

    return predefinedReplyRowSchema.parse(row);
  }

  async remove(id: number): Promise<boolean> {
    const result = await this.prisma.client.tbltickets_predefined_replies.deleteMany({
      where: { id },
    });

    return result.count > 0;
  }
}
