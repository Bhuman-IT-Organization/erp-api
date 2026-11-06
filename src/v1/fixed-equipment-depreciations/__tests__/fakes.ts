/**
 * The in-memory fake of the module's repository and the seed rows the service, facade and
 * controller specs share. `InMemoryFixedEquipmentDepreciationsRepository` answers the repository's
 * public methods structurally, with the same keyset order both ways (ties broken on the id),
 * `total` and `rangeStart`, the same `q` (the name contains it, case-insensitively as the column's
 * `_ci` collation compares; an all-digit `q` is also the id) and the same row scope (`own` narrows
 * to the rows whose `creatorId` is the caller's staff id).
 */
import { AppError } from '../../../shared/errors/app-error.js';
import type { ReadScope } from '../../../shared/http/decorators/scope.decorator.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import { MAX_UNSIGNED_INT_ID } from '../dto/fixed-equipment-depreciations.dto.js';
import {
  FIXED_EQUIPMENT_DEPRECIATIONS_FACADE_MAX_ROWS,
  type FixedEquipmentDepreciationRow,
  type FixedEquipmentDepreciationPatch,
  type FixedEquipmentDepreciationsListRequest,
  type FixedEquipmentDepreciationsPage,
  type FixedEquipmentDepreciationsSortField,
  type NewFixedEquipmentDepreciation,
  type FixedEquipmentDepreciationUsage,
} from '../model/fixed-equipment-depreciations.model.js';
import type { FixedEquipmentDepreciationsRepository } from '../repository/fixed-equipment-depreciations.repository.js';

/**
 * Four rows, ids 1 to 4: Perfex's two sample depreciations (staff 1's), one created by staff 3 (the
 * view-own member in the test app) and one old Perfex row with no term and no creator. By the
 * default `-id` they read 4, 3, 2, 1; by name 1, 2, 4, 3.
 */
export const SEED_FIXED_EQUIPMENT_DEPRECIATIONS: readonly FixedEquipmentDepreciationRow[] = [
  { id: 1, name: 'Depreciation 1', term: 12, creatorId: 1 },
  { id: 2, name: 'Depreciation 2', term: 36, creatorId: 1 },
  { id: 3, name: 'Straight line', term: 60, creatorId: 3 },
  { id: 4, name: 'Legacy', term: null, creatorId: null },
];

/** Nothing refers to the depreciation. */
export const ZERO_USAGE: FixedEquipmentDepreciationUsage = { models: 0, assets: 0 };

/** The repository's public surface, which the fake answers method for method. */
export type FixedEquipmentDepreciationsRepositoryPort = Pick<
  FixedEquipmentDepreciationsRepository,
  'list' | 'count' | 'findById' | 'create' | 'update' | 'remove' | 'usage' | 'listAll'
>;

type Key = readonly [KeyValue, number];

function keyOf(
  row: FixedEquipmentDepreciationRow,
  sortField: FixedEquipmentDepreciationsSortField,
): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

export class InMemoryFixedEquipmentDepreciationsRepository implements FixedEquipmentDepreciationsRepositoryPort {
  private readonly rows = new Map<number, FixedEquipmentDepreciationRow>();
  private lastId = 0;
  /** What `usage` answers for an id; any id not here answers `ZERO_USAGE`. */
  readonly usageOf = new Map<number, FixedEquipmentDepreciationUsage>();
  /** When true, `usage` rejects, as a failed count would. */
  usageFails = false;
  /** Puts rows in exactly as given (ids included), as Perfex's own rows already exist. */
  seed(rows: readonly FixedEquipmentDepreciationRow[]): void {
    for (const row of rows) {
      this.rows.set(row.id, row);
      this.lastId = Math.max(this.lastId, row.id);
    }
  }

  /**
   * One keyset page: ordered by `(sort key, id)`, `after` the cursor row (or from the first row),
   * or the `limit` rows just `before` it; `total` counts every matching row, `rangeStart` is the
   * first row's 1-based rank (`0` on an empty page).
   */
  list(
    request: FixedEquipmentDepreciationsListRequest,
    scope: ReadScope,
    staffId: number,
  ): Promise<FixedEquipmentDepreciationsPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: FixedEquipmentDepreciationRow): Key => keyOf(row, sortField);
    const sorted = this.matching(request, scope, staffId).sort((a, b) =>
      compareKeys(key(a), key(b), order),
    );
    let items: FixedEquipmentDepreciationRow[];
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

  count(
    request: FixedEquipmentDepreciationsListRequest,
    scope: ReadScope,
    staffId: number,
  ): Promise<number> {
    return Promise.resolve(this.matching(request, scope, staffId).length);
  }

  /** `null` when missing OR another member's under `own` (the same answer). */
  findById(
    id: number,
    scope: ReadScope,
    staffId: number,
  ): Promise<FixedEquipmentDepreciationRow | null> {
    const row = this.rows.get(id);
    if (row === undefined || !visible(row, scope, staffId)) return Promise.resolve(null);
    return Promise.resolve(row);
  }

  create(input: NewFixedEquipmentDepreciation): Promise<FixedEquipmentDepreciationRow> {
    this.lastId += 1;
    const row: FixedEquipmentDepreciationRow = {
      id: this.lastId,
      name: input.name,
      term: input.term,
      creatorId: input.creatorId,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  /** The name and the term only: the creator stays as it was. */
  update(
    id: number,
    patch: FixedEquipmentDepreciationPatch,
  ): Promise<FixedEquipmentDepreciationRow | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated: FixedEquipmentDepreciationRow = { ...row, name: patch.name, term: patch.term };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  usage(id: number): Promise<FixedEquipmentDepreciationUsage> {
    if (this.usageFails) return Promise.reject(new Error('the count failed'));
    return Promise.resolve(this.usageOf.get(id) ?? ZERO_USAGE);
  }

  listAll(): Promise<readonly FixedEquipmentDepreciationRow[]> {
    const rows = [...this.rows.values()].sort((a, b) =>
      compareKeys(keyOf(a, 'name'), keyOf(b, 'name'), 'asc'),
    );
    if (rows.length > FIXED_EQUIPMENT_DEPRECIATIONS_FACADE_MAX_ROWS) {
      return Promise.reject(new AppError('ERP-INTERNAL-0001', 'too many depreciations'));
    }
    return Promise.resolve(rows);
  }

  /** The row scope, then `?q=`: the name contains it (case-insensitive), or the id equals it. */
  private matching(
    request: FixedEquipmentDepreciationsListRequest,
    scope: ReadScope,
    staffId: number,
  ): FixedEquipmentDepreciationRow[] {
    const scoped = [...this.rows.values()].filter((row) => visible(row, scope, staffId));
    const search = request.search;
    if (search === null) return scoped;
    const needle = search.toLowerCase();
    const id =
      /^\d+$/.test(search) && Number(search) <= MAX_UNSIGNED_INT_ID ? Number(search) : null;
    return scoped.filter((row) => row.name.toLowerCase().includes(needle) || row.id === id);
  }
}

/** `own` narrows to the caller's rows and never widens. */
function visible(row: FixedEquipmentDepreciationRow, scope: ReadScope, staffId: number): boolean {
  return scope === 'all' || row.creatorId === staffId;
}

/**
 * The fake where the module expects the repository: the service's constructor and Nest's
 * `overrideProvider(...).useValue(...)`. The real class has a private `prisma` field, so TypeScript
 * will not accept a structural twin without this one cast; `implements` above keeps the twin honest.
 */
export function asRepository(
  fake: InMemoryFixedEquipmentDepreciationsRepository,
): FixedEquipmentDepreciationsRepository {
  return fake as unknown as FixedEquipmentDepreciationsRepository;
}

/** A new fake seeded with `SEED_FIXED_EQUIPMENT_DEPRECIATIONS` (ids 1 to 4). */
export function seededStore(): InMemoryFixedEquipmentDepreciationsRepository {
  const repo = new InMemoryFixedEquipmentDepreciationsRepository();
  repo.seed(SEED_FIXED_EQUIPMENT_DEPRECIATIONS);
  return repo;
}
