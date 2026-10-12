/**
 * The in-memory fake of the module's repository and the seed rows the service, facade and
 * controller specs share. `InMemoryCostCentersRepository` answers the repository's public methods
 * structurally, with the same keyset order both ways (ties broken on the id), `total` and
 * `rangeStart`, and the same `q` (the name contains it, case-insensitively as the column's `_ci`
 * collation compares; an all-digit `q` is also the id).
 *
 * What it adds that the table cannot produce on demand: a cost center that is in use (its `usage`
 * map answers `usageByCostCenter` for the ids it holds; every other id answers zeros). An update
 * leaves `createdBy` and `datecreated` exactly as they were (D-31).
 */
import { AppError } from '../../../shared/errors/app-error.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import {
  COST_CENTERS_FACADE_MAX_ROWS,
  type CostCenterRow,
  type CostCentersListRequest,
  type CostCentersPage,
  type CostCentersSortField,
  type CostCenterUsage,
  type NewCostCenter,
} from '../model/cost-centers.model.js';
import {
  COST_CENTER_REFERENCES,
  referenceKey,
  type CostCentersRepository,
} from '../repository/cost-centers.repository.js';
import { NO_COST_CENTER_USAGE } from '../service/cost-centers.transformer.js';

/**
 * Three rows, ids 1 to 3: two share the name `Head Office` (Perfex has no uniqueness check), and
 * `Warehouse` has no `datecreated` (a row Perfex imported or created before the column was filled).
 * By the default `-id` they read 3, 2, 1; by name 1, 3, 2.
 */
export const SEED_COST_CENTERS: readonly CostCenterRow[] = [
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

/** Nothing refers to the cost center. */
export const ZERO_USAGE: CostCenterUsage = NO_COST_CENTER_USAGE;

/** The repository's public surface, which the fake answers method for method. */
export type CostCentersRepositoryPort = Pick<
  CostCentersRepository,
  | 'list'
  | 'count'
  | 'findById'
  | 'create'
  | 'update'
  | 'remove'
  | 'presentReferences'
  | 'usageByCostCenter'
  | 'listAll'
  | 'findByIds'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: CostCenterRow, sortField: CostCentersSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** The in-memory store, with a settable answer for `usageByCostCenter`. */
export class InMemoryCostCentersRepository implements CostCentersRepositoryPort {
  /** What `usageByCostCenter` answers for an id; any id not here answers `ZERO_USAGE`. */
  readonly usage = new Map<number, CostCenterUsage>();
  private readonly rows = new Map<number, CostCenterRow>();
  private lastId = 0;

  /** Puts rows in exactly as given (ids included), as Perfex's own rows already exist. */
  seed(rows: readonly CostCenterRow[]): void {
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
  list(request: CostCentersListRequest): Promise<CostCentersPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: CostCenterRow): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: CostCenterRow[];
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

  count(request: CostCentersListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<CostCenterRow | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(input: NewCostCenter): Promise<CostCenterRow> {
    this.lastId += 1;
    const row: CostCenterRow = {
      id: this.lastId,
      name: input.name,
      createdBy: input.createdBy,
      datecreated: input.datecreated,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  /** The name only: `createdBy` and `datecreated` stay as they were (D-31). */
  update(id: number, patch: { readonly name: string }): Promise<CostCenterRow | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated: CostCenterRow = { ...row, name: patch.name };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  /** Every declared candidate: the fake has no schema to probe. */
  presentReferences(): Promise<ReadonlySet<string>> {
    return Promise.resolve(new Set(COST_CENTER_REFERENCES.map(referenceKey)));
  }

  usageByCostCenter(ids: readonly number[]): Promise<ReadonlyMap<number, CostCenterUsage>> {
    return Promise.resolve(new Map(ids.map((id) => [id, this.usage.get(id) ?? ZERO_USAGE])));
  }

  listAll(): Promise<readonly CostCenterRow[]> {
    const rows = [...this.rows.values()].sort((a, b) =>
      compareKeys(keyOf(a, 'name'), keyOf(b, 'name'), 'asc'),
    );
    if (rows.length > COST_CENTERS_FACADE_MAX_ROWS) {
      return Promise.reject(new AppError('ERP-INTERNAL-0001', 'too many cost centers'));
    }
    return Promise.resolve(rows);
  }

  findByIds(ids: readonly number[]): Promise<readonly CostCenterRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => ids.includes(row.id)));
  }

  /** `?q=`: the name contains it (case-insensitive), or the id equals it. */
  private matching(request: CostCentersListRequest): CostCenterRow[] {
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
export function asRepository(fake: InMemoryCostCentersRepository): CostCentersRepository {
  return fake as unknown as CostCentersRepository;
}

/** A new `InMemoryCostCentersRepository` seeded with `SEED_COST_CENTERS` (ids 1 to 3). */
export function seededStore(): InMemoryCostCentersRepository {
  const repo = new InMemoryCostCentersRepository();
  repo.seed(SEED_COST_CENTERS);
  return repo;
}
