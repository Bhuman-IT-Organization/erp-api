import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import type {
  KnowledgeBaseGroupListRequest,
  KnowledgeBaseGroupPage,
  KnowledgeBaseGroupPatch,
  KnowledgeBaseGroupRow,
  KnowledgeBaseGroupSortField,
  NewKnowledgeBaseGroup,
} from '../model/knowledge-base-groups.model.js';
import type { KnowledgeBaseGroupsRepository } from '../repository/knowledge-base-groups.repository.js';

export const SEED_KNOWLEDGE_BASE_GROUPS: readonly KnowledgeBaseGroupRow[] = [
  {
    groupid: 1,
    name: 'General',
    group_slug: 'general',
    description: 'General articles',
    group_order: 1,
    active: 1,
    color: '#03a9f4',
    totalArticles: 0,
  },
  {
    groupid: 2,
    name: 'Billing',
    group_slug: 'billing',
    description: 'Billing FAQs',
    group_order: 2,
    active: 0,
    color: null,
    totalArticles: 3,
  },
  {
    groupid: 3,
    name: 'Technical',
    group_slug: 'technical',
    description: 'Technical docs',
    group_order: 3,
    active: 1,
    color: '#28B8DA',
    totalArticles: 0,
  },
];

type Key = readonly [KeyValue, number];

function keyOf(row: KnowledgeBaseGroupRow, sortField: KnowledgeBaseGroupSortField): Key {
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
      return [row.group_order ?? 0, row.groupid];
  }
}

export class InMemoryKnowledgeBaseGroupsRepository implements Partial<KnowledgeBaseGroupsRepository> {
  readonly groups = new Map<number, KnowledgeBaseGroupRow>();
  readonly articleCounts = new Map<number, number>();
  private lastGroupId = 0;

  constructor() {
    this.seed(SEED_KNOWLEDGE_BASE_GROUPS);
  }

  seed(groups: readonly KnowledgeBaseGroupRow[]): void {
    this.groups.clear();
    for (const group of groups) {
      this.groups.set(group.groupid, group);
      this.lastGroupId = Math.max(this.lastGroupId, group.groupid);
      if (group.totalArticles !== undefined) {
        this.articleCounts.set(group.groupid, group.totalArticles);
      }
    }
  }

  private matching(request: KnowledgeBaseGroupListRequest): KnowledgeBaseGroupRow[] {
    const search = request.search?.toLowerCase() ?? null;
    return [...this.groups.values()]
      .filter((row) => {
        if (search === null) return true;
        if (row.name.toLowerCase().includes(search)) return true;
        if (String(row.groupid) === search) return true;
        return false;
      })
      .map((row) => ({
        ...row,
        totalArticles: this.articleCounts.get(row.groupid) ?? 0,
      }));
  }

  list(
    request: KnowledgeBaseGroupListRequest = {
      search: null,
      sortField: 'groupOrder',
      order: 'asc',
      cursor: null,
      limit: 50,
    },
  ): Promise<KnowledgeBaseGroupPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: KnowledgeBaseGroupRow): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));

    let items: KnowledgeBaseGroupRow[];
    if (cursor?.direction === 'before') {
      const earlier = sorted.filter((row) => compareKeys(key(row), cursor.key, order) < 0);
      items = earlier.slice(Math.max(0, earlier.length - limit));
    } else {
      items = sorted
        .filter((row) => cursor === null || compareKeys(key(row), cursor.key, order) > 0)
        .slice(0, limit);
    }

    const total = sorted.length;
    const first = items[0];
    const last = items.at(-1);

    if (first === undefined || last === undefined) {
      return Promise.resolve({ items, nextCursor: null, prevCursor: null, total, rangeStart: 0 });
    }

    const rangeStart =
      sorted.filter((row) => compareKeys(key(row), key(first), order) < 0).length + 1;

    return Promise.resolve({
      items,
      nextCursor:
        rangeStart - 1 + items.length < total ? encodeCursor(sortField, key(last), 'after') : null,
      prevCursor: rangeStart > 1 ? encodeCursor(sortField, key(first), 'before') : null,
      total,
      rangeStart,
    });
  }

  findById(groupId: number): Promise<KnowledgeBaseGroupRow | null> {
    const row = this.groups.get(groupId);
    if (!row) return Promise.resolve(null);
    return Promise.resolve({
      ...row,
      totalArticles: this.articleCounts.get(groupId) ?? 0,
    });
  }

  countArticles(groupId: number): Promise<number> {
    return Promise.resolve(this.articleCounts.get(groupId) ?? 0);
  }

  existsBySlug(slug: string, excludeGroupId?: number): Promise<boolean> {
    for (const group of this.groups.values()) {
      if (excludeGroupId !== undefined && group.groupid === excludeGroupId) continue;
      if (group.group_slug === slug) return Promise.resolve(true);
    }
    return Promise.resolve(false);
  }

  count(): Promise<number> {
    return Promise.resolve(this.groups.size);
  }

  countSlugsLike(slug: string, excludeGroupId?: number): Promise<number> {
    let count = 0;
    for (const group of this.groups.values()) {
      if (excludeGroupId !== undefined && group.groupid === excludeGroupId) continue;
      if (group.group_slug?.includes(slug)) count += 1;
    }
    return Promise.resolve(count);
  }

  create(data: NewKnowledgeBaseGroup): Promise<KnowledgeBaseGroupRow> {
    const groupid = ++this.lastGroupId;
    const row: KnowledgeBaseGroupRow = {
      groupid,
      name: data.name,
      group_slug: data.group_slug,
      description: data.description,
      active: data.active,
      color: data.color ?? '#28B8DA',
      group_order: data.group_order,
      totalArticles: 0,
    };
    this.groups.set(groupid, row);
    this.articleCounts.set(groupid, 0);
    return Promise.resolve(row);
  }

  update(groupId: number, patch: KnowledgeBaseGroupPatch): Promise<KnowledgeBaseGroupRow | null> {
    const existing = this.groups.get(groupId);
    if (!existing) return Promise.resolve(null);
    const updated: KnowledgeBaseGroupRow = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.group_slug !== undefined ? { group_slug: patch.group_slug } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.group_order !== undefined ? { group_order: patch.group_order } : {}),
    };
    this.groups.set(groupId, updated);
    return Promise.resolve({
      ...updated,
      totalArticles: this.articleCounts.get(groupId) ?? 0,
    });
  }

  remove(groupId: number): Promise<boolean> {
    if (!this.groups.has(groupId)) return Promise.resolve(false);
    this.groups.delete(groupId);
    this.articleCounts.delete(groupId);
    return Promise.resolve(true);
  }

  listAll(): Promise<readonly KnowledgeBaseGroupRow[]> {
    const rows = [...this.groups.values()].sort(
      (a, b) => (a.group_order ?? 0) - (b.group_order ?? 0) || a.groupid - b.groupid,
    );
    return Promise.resolve(
      rows.map((r) => ({ ...r, totalArticles: this.articleCounts.get(r.groupid) ?? 0 })),
    );
  }

  findByIds(ids: readonly number[]): Promise<readonly KnowledgeBaseGroupRow[]> {
    const result: KnowledgeBaseGroupRow[] = [];
    for (const id of ids) {
      const row = this.groups.get(id);
      if (row) result.push({ ...row, totalArticles: this.articleCounts.get(id) ?? 0 });
    }
    return Promise.resolve(result);
  }
}

export { InMemoryKnowledgeBaseGroupsRepository as InMemoryKnowledgeBaseRepository };
