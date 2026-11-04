/**
 * The in-memory fake of the module's repository and the seed rows the service, facade and
 * controller specs share. `InMemoryServicesRepository` answers the repository's public methods
 * structurally, with the same keyset order both ways (ties broken on the id), `total` and
 * `rangeStart`, and the same `q` (the name contains it, case-insensitively as the column's `_ci`
 * collation compares; an all-digit `q` is also the id).
 *
 * What it adds that the table cannot produce on demand: a service that a ticket uses (its
 * `tickets` map answers `countTickets` for the ids it holds; every other id answers zero).
 */
import { AppError } from '../../../shared/errors/app-error.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import {
  SERVICES_FACADE_MAX_ROWS,
  type NewService,
  type ServiceRow,
  type ServicesListRequest,
  type ServicesPage,
  type ServicesSortField,
} from '../model/services.model.js';
import type { ServicesRepository } from '../repository/services.repository.js';

/**
 * Three rows, ids 1 to 3: two share the name `Gold Support` (Perfex has no uniqueness check). By the
 * default `-id` they read 3, 2, 1; by name 2, 1, 3.
 */
export const SEED_SERVICES: readonly ServiceRow[] = [
  { id: 1, name: 'Gold Support' },
  { id: 2, name: 'Billing' },
  { id: 3, name: 'Gold Support' },
];

/** The repository's public surface, which the fake answers method for method. */
export type ServicesRepositoryPort = Pick<
  ServicesRepository,
  | 'list'
  | 'count'
  | 'findById'
  | 'create'
  | 'update'
  | 'remove'
  | 'countTickets'
  | 'listAll'
  | 'findByIds'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: ServiceRow, sortField: ServicesSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** The in-memory store, with a settable answer for `countTickets`. */
export class InMemoryServicesRepository implements ServicesRepositoryPort {
  /** What `countTickets` answers for an id; any id not here answers 0. */
  readonly tickets = new Map<number, number>();
  private readonly rows = new Map<number, ServiceRow>();
  private lastId = 0;

  /** Puts rows in exactly as given (ids included), as Perfex's own rows already exist. */
  seed(rows: readonly ServiceRow[]): void {
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
  list(request: ServicesListRequest): Promise<ServicesPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: ServiceRow): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: ServiceRow[];
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

  count(request: ServicesListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<ServiceRow | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(input: NewService): Promise<ServiceRow> {
    this.lastId += 1;
    const row: ServiceRow = { id: this.lastId, name: input.name };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  update(id: number, patch: { readonly name: string }): Promise<ServiceRow | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated: ServiceRow = { ...row, name: patch.name };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  countTickets(id: number): Promise<number> {
    return Promise.resolve(this.tickets.get(id) ?? 0);
  }

  listAll(): Promise<readonly ServiceRow[]> {
    const rows = [...this.rows.values()].sort((a, b) =>
      compareKeys(keyOf(a, 'name'), keyOf(b, 'name'), 'asc'),
    );
    if (rows.length > SERVICES_FACADE_MAX_ROWS) {
      return Promise.reject(new AppError('ERP-INTERNAL-0001', 'too many services'));
    }
    return Promise.resolve(rows);
  }

  findByIds(ids: readonly number[]): Promise<readonly ServiceRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => ids.includes(row.id)));
  }

  /** `?q=`: the name contains it (case-insensitive), or the id equals it. */
  private matching(request: ServicesListRequest): ServiceRow[] {
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
export function asRepository(fake: InMemoryServicesRepository): ServicesRepository {
  return fake as unknown as ServicesRepository;
}

/** A new `InMemoryServicesRepository` seeded with `SEED_SERVICES` (ids 1 to 3). */
export function seededStore(): InMemoryServicesRepository {
  const repo = new InMemoryServicesRepository();
  repo.seed(SEED_SERVICES);
  return repo;
}
