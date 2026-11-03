/**
 * The in-memory fake of the module's repository and the seed rows the service, facade and
 * controller specs share. `InMemoryKnowledgeBaseRepository` answers the repository's public methods
 * structurally, with the same keyset order both ways (ties broken on the id), `total` and
 * `rangeStart`, and the same `q` (the name contains it, case-insensitively as the column's `_ci`
 * collation compares; an all-digit `q` is also the id).
 *
 * What it adds that the table cannot produce on demand: a knowledge base that is in use (its `usage`
 * map answers `usageByKnowledgeBase` for the ids it holds; every other id answers zeros). An update
 * leaves `createdBy` and `datecreated` exactly as they were (D-31).
 */
import { AppError } from '../../../shared/errors/app-error.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import {
  KNOWLEDGE_BASE_FACADE_MAX_ROWS,
  type KnowledgeBaseRow,
  type KnowledgeBaseGroupRow,
  type KnowledgeBaseListRequest,
  type KnowledgeBasePage,
  type KnowledgeBaseSortField,
  type KnowledgeBaseUsage,
  type NewKnowledgeBase,
  type NewKnowledgeBaseGroup,
} from '../model/knowledge-base.model.js';
import {
  KNOWLEDGE_BASE_REFERENCES,
  referenceKey,
  type KnowledgeBaseRepository,
} from '../repository/knowledge-base.repository.js';
import { NO_KNOWLEDGE_BASE_USAGE } from '../service/knowledge-base.transformer.js';

/**
 * Three rows, ids 1 to 3: two share the name `Head Office` (Perfex has no uniqueness check), and
 * `Warehouse` has no `datecreated` (a row Perfex imported or created before the column was filled).
 * By the default `-id` they read 3, 2, 1; by name 1, 3, 2.
 */
export const SEED_KNOWLEDGE_BASE: readonly KnowledgeBaseRow[] = [
  {
    id: 1,
    name: 'Head Office',
    createdBy: 1,
    datecreated: new Date(Date.UTC(2026, 0, 5, 9, 0, 0)),
  },
  { id: 2, name: 'Warehouse', createdBy: 1, datecreated: null },
  {
    id: 3,
    name: 'Head Office',
    createdBy: 4,
    datecreated: new Date(Date.UTC(2026, 1, 10, 14, 30, 0)),
  },
];

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
];

/** Nothing refers to the knowledge base. */
export const ZERO_USAGE: KnowledgeBaseUsage = NO_KNOWLEDGE_BASE_USAGE;

/** The repository's public surface, which the fake answers method for method. */
export type KnowledgeBaseRepositoryPort = Pick<
  KnowledgeBaseRepository,
  | 'list'
  | 'count'
  | 'findById'
  | 'create'
  | 'update'
  | 'remove'
  | 'presentReferences'
  | 'usageByKnowledgeBase'
  | 'listAll'
  | 'findByIds'
  | 'listGroups'
  | 'findGroupById'
  | 'createGroup'
  | 'updateGroup'
  | 'removeGroup'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: KnowledgeBaseRow, sortField: KnowledgeBaseSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** The in-memory store, with a settable answer for `usageByKnowledgeBase`. */
export class InMemoryKnowledgeBaseRepository implements KnowledgeBaseRepositoryPort {
  /** What `usageByKnowledgeBase` answers for an id; any id not here answers `ZERO_USAGE`. */
  readonly usage = new Map<number, KnowledgeBaseUsage>();
  private readonly rows = new Map<number, KnowledgeBaseRow>();
  private lastId = 0;

  readonly groups = new Map<number, KnowledgeBaseGroupRow>();
  private lastGroupId = 0;

  /** Puts rows in exactly as given (ids included), as Perfex's own rows already exist. */
  seed(rows: readonly KnowledgeBaseRow[]): void {
    for (const row of rows) {
      this.rows.set(row.id, row);
      this.lastId = Math.max(this.lastId, row.id);
    }
  }

  seedGroups(groups: readonly KnowledgeBaseGroupRow[]): void {
    this.groups.clear();
    for (const group of groups) {
      this.groups.set(group.groupid, group);
      this.lastGroupId = Math.max(this.lastGroupId, group.groupid);
    }
  }

  listGroups(search?: string | null): Promise<KnowledgeBaseGroupRow[]> {
    let result = [...this.groups.values()];
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (g) =>
          g.name.toLowerCase().includes(q) || Boolean(g.description?.toLowerCase().includes(q)),
      );
    }
    result.sort(
      (a, b) => (a.group_order ?? 0) - (b.group_order ?? 0) || a.name.localeCompare(b.name),
    );
    return Promise.resolve(result);
  }

  findGroupById(id: number): Promise<KnowledgeBaseGroupRow | null> {
    return Promise.resolve(this.groups.get(id) ?? null);
  }

  createGroup(data: NewKnowledgeBaseGroup): Promise<KnowledgeBaseGroupRow> {
    const groupid = ++this.lastGroupId;
    const row: KnowledgeBaseGroupRow = {
      groupid,
      name: data.name,
      group_slug: data.group_slug,
      description: data.description,
      group_order: data.group_order,
      active: data.active,
      color: data.color,
      totalArticles: 0,
    };
    this.groups.set(groupid, row);
    return Promise.resolve(row);
  }

  updateGroup(
    id: number,
    data: Partial<NewKnowledgeBaseGroup>,
  ): Promise<KnowledgeBaseGroupRow | null> {
    const existing = this.groups.get(id);
    if (!existing) return Promise.resolve(null);
    const updated: KnowledgeBaseGroupRow = {
      ...existing,
      ...(data.name !== undefined ? { name: data.name } : {}),
      ...(data.group_slug !== undefined ? { group_slug: data.group_slug } : {}),
      ...(data.description !== undefined ? { description: data.description } : {}),
      ...(data.group_order !== undefined ? { group_order: data.group_order } : {}),
      ...(data.active !== undefined ? { active: data.active } : {}),
      ...(data.color !== undefined ? { color: data.color } : {}),
    };
    this.groups.set(id, updated);
    return Promise.resolve(updated);
  }

  removeGroup(id: number): Promise<{ deleted: boolean; inUse: boolean }> {
    const existing = this.groups.get(id);
    if (!existing) return Promise.resolve({ deleted: false, inUse: false });
    if ((existing.totalArticles ?? 0) > 0) {
      return Promise.resolve({ deleted: false, inUse: true });
    }
    this.groups.delete(id);
    return Promise.resolve({ deleted: true, inUse: false });
  }

  /**
   * One keyset page: ordered by `(sort key, id)`, `after` the cursor row (or from the first row),
   * or the `limit` rows just `before` it; `total` counts every matching row, `rangeStart` is the
   * first row's 1-based rank (`0` on an empty page).
   */
  list(request: KnowledgeBaseListRequest): Promise<KnowledgeBasePage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: KnowledgeBaseRow): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: KnowledgeBaseRow[];
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

  count(request: KnowledgeBaseListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<KnowledgeBaseRow | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(input: NewKnowledgeBase): Promise<KnowledgeBaseRow> {
    this.lastId += 1;
    const row: KnowledgeBaseRow = {
      id: this.lastId,
      name: input.name,
      createdBy: input.createdBy,
      datecreated: input.datecreated,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  /** The name only: `createdBy` and `datecreated` stay as they were (D-31). */
  update(id: number, patch: { readonly name: string }): Promise<KnowledgeBaseRow | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated: KnowledgeBaseRow = { ...row, name: patch.name };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  /** Every declared candidate: the fake has no schema to probe. */
  presentReferences(): Promise<ReadonlySet<string>> {
    return Promise.resolve(new Set(KNOWLEDGE_BASE_REFERENCES.map(referenceKey)));
  }

  usageByKnowledgeBase(ids: readonly number[]): Promise<ReadonlyMap<number, KnowledgeBaseUsage>> {
    return Promise.resolve(new Map(ids.map((id) => [id, this.usage.get(id) ?? ZERO_USAGE])));
  }

  listAll(): Promise<readonly KnowledgeBaseRow[]> {
    const rows = [...this.rows.values()].sort((a, b) =>
      compareKeys(keyOf(a, 'name'), keyOf(b, 'name'), 'asc'),
    );
    if (rows.length > KNOWLEDGE_BASE_FACADE_MAX_ROWS) {
      return Promise.reject(new AppError('ERP-INTERNAL-0001', 'too many knowledge base'));
    }
    return Promise.resolve(rows);
  }

  findByIds(ids: readonly number[]): Promise<readonly KnowledgeBaseRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => ids.includes(row.id)));
  }

  /** `?q=`: the name contains it (case-insensitive), or the id equals it. */
  private matching(request: KnowledgeBaseListRequest): KnowledgeBaseRow[] {
    const search = request.search;
    if (search === null) return [...this.rows.values()];
    const needle = search.toLowerCase();
    const id = /^\d+$/.test(search) ? Number(search) : null;
    return [...this.rows.values()].filter(
      (row) => row.name.toLowerCase().includes(needle) || row.id === id,
    );
  }
}

/**
 * The fake where the module expects the repository: the service's constructor and Nest's
 * `overrideProvider(...).useValue(...)`. The real class has a private `prisma` field, so TypeScript
 * will not accept a structural twin without this one cast; `implements` above keeps the twin honest.
 */
export function asRepository(fake: InMemoryKnowledgeBaseRepository): KnowledgeBaseRepository {
  return fake as unknown as KnowledgeBaseRepository;
}

/** A new `InMemoryKnowledgeBaseRepository` seeded with `SEED_KNOWLEDGE_BASE` (ids 1 to 3). */
export function seededStore(): InMemoryKnowledgeBaseRepository {
  const repo = new InMemoryKnowledgeBaseRepository();
  repo.seed(SEED_KNOWLEDGE_BASE);
  repo.seedGroups(SEED_KNOWLEDGE_BASE_GROUPS);
  return repo;
}
