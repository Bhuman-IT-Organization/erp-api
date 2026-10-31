/**
 * The in-memory fake of the module's repository and the seed rows the service, facade and
 * controller specs share. `InMemoryCustomerGroupsRepository` answers the repository's public
 * methods structurally, with the same keyset order both ways (ties broken on the id), `total` and
 * `rangeStart`, and the same `q` (the name contains it, case-insensitively as the column's `_ci`
 * collation compares; an all-digit `q` is also the id).
 * What it adds that the table cannot produce on demand: the customer links (`tblcustomer_groups`
 * rows, Perfex's table) held in `links`, so `countCustomers` can answer and a spec can prove that
 * `remove` never touches them.
 * else's, exactly as the real transaction does.
 */
import { AppError } from '../../../shared/errors/app-error.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import {
  CUSTOMER_GROUPS_FACADE_MAX_ROWS,
  type CustomerGroupRow,
  type CustomerGroupsListRequest,
  type CustomerGroupsPage,
  type CustomerGroupsSortField,
  type NewCustomerGroup,
} from '../model/customer-groups.model.js';
import type { CustomerGroupsRepository } from '../repository/customer-groups.repository.js';

/** One `tblcustomer_groups` row: which customer is in which group. */
export interface CustomerGroupLink {
  readonly groupid: number;
  readonly customerId: number;
}

/**
 * Three rows, ids 1 to 3: two share the name `Gold` (Perfex has no uniqueness check). By the
 * default `-name` they read Silver (2), Gold (3), Gold (1); by `name` ascending, Gold (1), Gold (3), Silver (2).
 */
export const SEED_CUSTOMER_GROUPS: readonly CustomerGroupRow[] = [
  { id: 1, name: 'Gold' },
  { id: 2, name: 'Silver' },
  { id: 3, name: 'Gold' },
];

/** Customers 10 and 11 are in group 1; customer 10 is also in group 2; group 3 has no customer. */
export const SEED_CUSTOMER_LINKS: readonly CustomerGroupLink[] = [
  { groupid: 1, customerId: 10 },
  { groupid: 1, customerId: 11 },
  { groupid: 2, customerId: 10 },
];

/** The repository's public surface, which the fake answers method for method. */
export type CustomerGroupsRepositoryPort = Pick<
  CustomerGroupsRepository,
  | 'list'
  | 'count'
  | 'findById'
  | 'create'
  | 'update'
  | 'remove'
  | 'countCustomers'
  | 'listAll'
  | 'findByIds'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: CustomerGroupRow, sortField: CustomerGroupsSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** The in-memory store, with the customer links a delete must remove. */
export class InMemoryCustomerGroupsRepository implements CustomerGroupsRepositoryPort {
  /** The `tblcustomer_groups` rows; `remove` deletes the removed group's. */
  links: CustomerGroupLink[] = [];
  private readonly rows = new Map<number, CustomerGroupRow>();
  private lastId = 0;

  /** Puts rows in exactly as given (ids included), as Perfex's own rows already exist. */
  seed(rows: readonly CustomerGroupRow[], links: readonly CustomerGroupLink[] = []): void {
    for (const row of rows) {
      this.rows.set(row.id, row);
      this.lastId = Math.max(this.lastId, row.id);
    }
    this.links = [...links];
  }

  /**
   * One keyset page: ordered by `(sort key, id)`, `after` the cursor row (or from the first row),
   * or the `limit` rows just `before` it; `total` counts every matching row, `rangeStart` is the
   * first row's 1-based rank (`0` on an empty page).
   */
  list(request: CustomerGroupsListRequest): Promise<CustomerGroupsPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: CustomerGroupRow): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: CustomerGroupRow[];
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
  /** The number of groups the list's `q` matches (no cursor): what the export counts first. */
  count(request: CustomerGroupsListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<CustomerGroupRow | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(input: NewCustomerGroup): Promise<CustomerGroupRow> {
    this.lastId += 1;
    const row: CustomerGroupRow = { id: this.lastId, name: input.name };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  /** The name only. */
  update(id: number, patch: { readonly name: string }): Promise<CustomerGroupRow | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated: CustomerGroupRow = { ...row, name: patch.name };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  /** The number of links of the group (read only), as the real `count` on `tblcustomer_groups`. */
  countCustomers(groupId: number): Promise<number> {
    return Promise.resolve(this.links.filter((link) => link.groupid === groupId).length);
  }

  /** The group only; `false` when it was missing. The links are never touched. */
  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  listAll(): Promise<readonly CustomerGroupRow[]> {
    const rows = [...this.rows.values()].sort((a, b) =>
      compareKeys(keyOf(a, 'name'), keyOf(b, 'name'), 'asc'),
    );
    if (rows.length > CUSTOMER_GROUPS_FACADE_MAX_ROWS) {
      return Promise.reject(new AppError('ERP-INTERNAL-0001', 'too many customer groups'));
    }
    return Promise.resolve(rows);
  }

  findByIds(ids: readonly number[]): Promise<readonly CustomerGroupRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => ids.includes(row.id)));
  }

  /** `?q=`: the name contains it (case-insensitive), or the id equals it. */
  private matching(request: CustomerGroupsListRequest): CustomerGroupRow[] {
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
export function asRepository(fake: InMemoryCustomerGroupsRepository): CustomerGroupsRepository {
  return fake as unknown as CustomerGroupsRepository;
}

/** A new `InMemoryCustomerGroupsRepository` seeded with the three groups and their links. */
export function seededStore(): InMemoryCustomerGroupsRepository {
  const repo = new InMemoryCustomerGroupsRepository();
  repo.seed(SEED_CUSTOMER_GROUPS, SEED_CUSTOMER_LINKS);
  return repo;
}
