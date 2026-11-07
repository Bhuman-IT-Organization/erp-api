import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import {
  encodeCursor,
  keysetWhere,
  type DecodedCursor,
  type KeyValue,
} from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import { KNOWLEDGE_BASE_GROUP_ID_MAX } from '../dto/knowledge-base-groups.dto.js';
import type {
  KnowledgeBaseGroupListRequest,
  KnowledgeBaseGroupPage,
  KnowledgeBaseGroupPatch,
  KnowledgeBaseGroupRow,
  KnowledgeBaseGroupSortField,
  NewKnowledgeBaseGroup,
} from '../model/knowledge-base-groups.model.js';

const RECORD_NOT_FOUND = 'P2025';

const COLUMNS = {
  groupid: true,
  name: true,
  group_slug: true,
  description: true,
  active: true,
  color: true,
  group_order: true,
} as const;

const rowSchema = z.object({
  groupid: z.number().int(),
  name: z.string(),
  group_slug: z.string().nullable(),
  description: z.string().nullable(),
  active: z.number().int(),
  color: z.string().nullable(),
  group_order: z.number().int().nullable(),
});

const rowsSchema = z.array(rowSchema);

const DEFAULT_LIST_REQUEST: KnowledgeBaseGroupListRequest = {
  search: null,
  sortField: 'groupOrder',
  order: 'asc',
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
    if (Number.isSafeInteger(id) && id > 0 && id <= KNOWLEDGE_BASE_GROUP_ID_MAX) {
      or.push({ groupid: id });
    }
  }

  return { OR: or };
}

function columnOf(sortField: KnowledgeBaseGroupSortField): string {
  switch (sortField) {
    case 'name':
      return 'name';
    case 'active':
      return 'active';
    case 'id':
      return 'groupid';
    case 'groupOrder':
    case 'group_order':
    default:
      return 'group_order';
  }
}

export const GROUP_ORDER_NULL_KEY = -2_147_483_649;

function keyOf(
  row: { groupid: number; name: string; active: number; group_order: number | null },
  sortField: KnowledgeBaseGroupSortField,
): Key {
  switch (sortField) {
    case 'name':
      return [row.name, row.groupid];
    case 'active':
      return [row.active, row.groupid];
    case 'id':
      return [row.groupid, row.groupid];
    case 'groupOrder':
    case 'group_order':
    default:
      return [row.group_order ?? GROUP_ORDER_NULL_KEY, row.groupid];
  }
}

function readDirection(request: KnowledgeBaseGroupListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

function keysetWhereGroupOrder(cursor: DecodedCursor<string>, order: 'asc' | 'desc'): WhereValue {
  const forward = (order === 'asc') === (cursor.direction === 'after');
  const [val, id] = cursor.key;
  const value = typeof val === 'number' ? val : GROUP_ORDER_NULL_KEY;

  if (value === GROUP_ORDER_NULL_KEY) {
    return forward
      ? { OR: [{ group_order: { not: null } }, { group_order: null, groupid: { gt: id } }] }
      : { group_order: null, groupid: { lt: id } };
  }

  return forward
    ? { OR: [{ group_order: { gt: value } }, { group_order: value, groupid: { gt: id } }] }
    : {
        OR: [
          { group_order: { lt: value } },
          { group_order: null },
          { group_order: value, groupid: { lt: id } },
        ],
      };
}

function cursorPredicate(
  column: string,
  sortField: KnowledgeBaseGroupSortField,
  cursor: DecodedCursor<KnowledgeBaseGroupSortField>,
  order: 'asc' | 'desc',
): WhereValue {
  if (sortField === 'groupOrder' || sortField === 'group_order') {
    return keysetWhereGroupOrder(cursor, order);
  }
  return keysetWhere(column, 'groupid', cursor, order);
}

function pageMeta(
  sortField: KnowledgeBaseGroupSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<KnowledgeBaseGroupPage, 'items'> {
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
export class KnowledgeBaseGroupsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    request: KnowledgeBaseGroupListRequest = DEFAULT_LIST_REQUEST,
  ): Promise<KnowledgeBaseGroupPage> {
    const normalized: KnowledgeBaseGroupListRequest = { ...DEFAULT_LIST_REQUEST, ...request };
    const { sortField, order, cursor, limit } = normalized;
    const match = matchOf(normalized.search);
    const read = readDirection(normalized);
    const column = columnOf(sortField);

    const rows = await this.prisma.client.tblknowledge_base_groups.findMany({
      where:
        cursor === null
          ? match
          : {
              AND: [match, cursorPredicate(column, sortField, cursor, order)],
            },
      orderBy: [{ [column]: read }, { groupid: read }],
      take: limit,
      select: COLUMNS,
    });

    const parsed = rowsSchema.parse(rows);
    const ids = parsed.map((g) => g.groupid);

    const counts =
      ids.length === 0
        ? []
        : await this.prisma.client.tblknowledge_base.groupBy({
            by: ['articlegroup'],
            where: { articlegroup: { in: ids } },
            _count: { _all: true },
          });

    const countByGroup = new Map(counts.map((row) => [row.articlegroup, row._count._all]));

    const items: KnowledgeBaseGroupRow[] = parsed.map((g) => ({
      ...g,
      group_order: g.group_order ?? 0,
      totalArticles: countByGroup.get(g.groupid) ?? 0,
    }));

    if (read !== order) items.reverse();

    const ordered = read === order ? parsed : [...parsed].reverse();
    const keys = ordered.map((g) => keyOf(g, sortField));
    const first = keys[0];

    const [total, before] = await Promise.all([
      this.prisma.client.tblknowledge_base_groups.count({
        where: match,
      }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblknowledge_base_groups.count({
            where: {
              AND: [
                match,
                cursorPredicate(
                  column,
                  sortField,
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

  async findById(groupId: number): Promise<KnowledgeBaseGroupRow | null> {
    const row = await this.prisma.client.tblknowledge_base_groups.findUnique({
      where: { groupid: groupId },
      select: COLUMNS,
    });
    if (row === null) return null;
    const totalArticles = await this.countArticles(groupId);
    return { ...row, group_order: row.group_order ?? 0, totalArticles };
  }

  async countArticles(groupId: number): Promise<number> {
    return this.prisma.client.tblknowledge_base.count({
      where: { articlegroup: groupId },
    });
  }

  async existsBySlug(slug: string, excludeGroupId?: number): Promise<boolean> {
    const count = await this.prisma.client.tblknowledge_base_groups.count({
      where: {
        group_slug: slug,
        ...(excludeGroupId !== undefined ? { groupid: { not: excludeGroupId } } : {}),
      },
    });
    return count > 0;
  }

  async count(): Promise<number> {
    return this.prisma.client.tblknowledge_base_groups.count();
  }

  async create(data: NewKnowledgeBaseGroup): Promise<KnowledgeBaseGroupRow> {
    const row = await this.prisma.client.tblknowledge_base_groups.create({
      data: {
        name: data.name,
        group_slug: data.group_slug,
        description: data.description,
        active: data.active,
        color: data.color ?? '#28B8DA',
        group_order: data.group_order,
      },
      select: COLUMNS,
    });
    return { ...row, group_order: row.group_order ?? 0, totalArticles: 0 };
  }

  async update(
    groupId: number,
    patch: KnowledgeBaseGroupPatch,
  ): Promise<KnowledgeBaseGroupRow | null> {
    try {
      const row = await this.prisma.client.tblknowledge_base_groups.update({
        where: { groupid: groupId },
        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.group_slug !== undefined ? { group_slug: patch.group_slug } : {}),
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.active !== undefined ? { active: patch.active } : {}),
          ...(patch.color !== undefined ? { color: patch.color } : {}),
          ...(patch.group_order !== undefined ? { group_order: patch.group_order } : {}),
        },
        select: COLUMNS,
      });
      const totalArticles = await this.countArticles(groupId);
      return { ...row, group_order: row.group_order ?? 0, totalArticles };
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async remove(groupId: number): Promise<boolean> {
    try {
      await this.prisma.client.tblknowledge_base_groups.delete({
        where: { groupid: groupId },
      });
      return true;
    } catch (error) {
      if (isRecordNotFound(error)) return false;
      throw error;
    }
  }

  async listAll(): Promise<readonly KnowledgeBaseGroupRow[]> {
    const rows = await this.prisma.client.tblknowledge_base_groups.findMany({
      orderBy: [{ group_order: 'asc' }, { groupid: 'asc' }],
      select: COLUMNS,
    });
    const parsed = rowsSchema.parse(rows);
    const ids = parsed.map((g) => g.groupid);
    const counts =
      ids.length === 0
        ? []
        : await this.prisma.client.tblknowledge_base.groupBy({
            by: ['articlegroup'],
            where: { articlegroup: { in: ids } },
            _count: { _all: true },
          });
    const countByGroup = new Map(counts.map((c) => [c.articlegroup, c._count._all]));
    return parsed.map((r) => ({
      ...r,
      group_order: r.group_order ?? 0,
      totalArticles: countByGroup.get(r.groupid) ?? 0,
    }));
  }

  async findByIds(ids: readonly number[]): Promise<readonly KnowledgeBaseGroupRow[]> {
    const uniqueIds = Array.from(new Set(ids));
    const rows = await this.prisma.client.tblknowledge_base_groups.findMany({
      where: { groupid: { in: uniqueIds } },
      select: COLUMNS,
    });
    const parsed = rowsSchema.parse(rows);
    const map = new Map(parsed.map((r) => [r.groupid, r]));
    const result: KnowledgeBaseGroupRow[] = [];
    for (const id of ids) {
      const found = map.get(id);
      if (found !== undefined) {
        result.push({ ...found, group_order: found.group_order ?? 0, totalArticles: 0 });
      }
    }
    return result;
  }
}
