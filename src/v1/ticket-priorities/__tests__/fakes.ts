/**
 * The in-memory fake of the module's repository and the seed rows the service, facade and
 * controller specs share. `InMemoryTicketPrioritiesRepository` answers the repository's public
 * methods structurally, with the same keyset order both ways (ties broken on the id), `total` and
 * `rangeStart`, and the same `q` (the name contains it, case-insensitively as the column's `_ci`
 * collation compares; an all-digit `q` is also the id).
 *
 * What it adds that the table cannot produce on demand: a priority a ticket uses (the ids in
 * `referenced`), and a ticket count that fails (`isReferencedFails`).
 */
import { AppError } from '../../../shared/errors/app-error.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import {
  TICKET_PRIORITIES_FACADE_MAX_ROWS,
  type NewTicketPriority,
  type TicketPrioritiesListRequest,
  type TicketPrioritiesPage,
  type TicketPrioritiesSortField,
  type TicketPriority,
} from '../model/ticket-priority.model.js';
import type { TicketPrioritiesRepository } from '../repository/ticket-priorities.repository.js';

/**
 * Perfex's four default priorities, ids 1 to 4. By the default `-id` they read 4, 3, 2, 1; by
 * name 3 (High), 1 (Low), 2 (Medium), 4 (Urgent).
 */
export const SEED_TICKET_PRIORITIES: readonly TicketPriority[] = [
  { id: 1, name: 'Low' },
  { id: 2, name: 'Medium' },
  { id: 3, name: 'High' },
  { id: 4, name: 'Urgent' },
];

/** The repository's public surface, which the fake answers method for method. */
export type TicketPrioritiesRepositoryPort = Pick<
  TicketPrioritiesRepository,
  'list' | 'count' | 'findById' | 'create' | 'update' | 'remove' | 'isReferenced' | 'listAll'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: TicketPriority, sortField: TicketPrioritiesSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** The in-memory store, with a settable answer for `isReferenced`. */
export class InMemoryTicketPrioritiesRepository implements TicketPrioritiesRepositoryPort {
  /** The ids a ticket uses: `isReferenced` answers true for these, false for every other id. */
  readonly referenced = new Set<number>();
  /** When true, `isReferenced` rejects, as a failed ticket count would. */
  isReferencedFails = false;
  private readonly rows = new Map<number, TicketPriority>();
  private lastId = 0;

  /** Puts rows in exactly as given (ids included), as Perfex's own rows already exist. */
  seed(rows: readonly TicketPriority[]): void {
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
  list(request: TicketPrioritiesListRequest): Promise<TicketPrioritiesPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: TicketPriority): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: TicketPriority[];
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

  count(request: TicketPrioritiesListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<TicketPriority | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(input: NewTicketPriority): Promise<TicketPriority> {
    this.lastId += 1;
    const row: TicketPriority = { id: this.lastId, name: input.name };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  update(id: number, patch: { readonly name: string }): Promise<TicketPriority | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated: TicketPriority = { ...row, name: patch.name };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  isReferenced(id: number): Promise<boolean> {
    if (this.isReferencedFails) {
      return Promise.reject(new Error('the ticket count failed'));
    }
    return Promise.resolve(this.referenced.has(id));
  }

  listAll(): Promise<readonly TicketPriority[]> {
    const rows = [...this.rows.values()].sort((a, b) =>
      compareKeys(keyOf(a, 'name'), keyOf(b, 'name'), 'asc'),
    );
    if (rows.length > TICKET_PRIORITIES_FACADE_MAX_ROWS) {
      return Promise.reject(new AppError('ERP-INTERNAL-0001', 'too many ticket priorities'));
    }
    return Promise.resolve(rows);
  }

  /** `?q=`: the name contains it (case-insensitive), or the id equals it. */
  private matching(request: TicketPrioritiesListRequest): TicketPriority[] {
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
export function asRepository(fake: InMemoryTicketPrioritiesRepository): TicketPrioritiesRepository {
  return fake as unknown as TicketPrioritiesRepository;
}

/** A new `InMemoryTicketPrioritiesRepository` seeded with `SEED_TICKET_PRIORITIES` (ids 1 to 4). */
export function seededStore(): InMemoryTicketPrioritiesRepository {
  const repo = new InMemoryTicketPrioritiesRepository();
  repo.seed(SEED_TICKET_PRIORITIES);
  return repo;
}
