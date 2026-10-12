/**
 * The in-memory fake of the module's repository and the seed rows the service, facade and
 * controller specs share. `InMemoryExpenseCategoriesRepository` is the bounded store that stood
 * behind the repository seam until plan 04.1-04 swapped in `tblexpenses_categories`; its behaviour
 * is unchanged (the keyset order both ways with ties broken on the id, `total` and `rangeStart`,
 * `q` over the name or the description, the bound), and it answers the repository's public methods
 * structurally. One thing it adds that the table cannot produce on demand: a category that is in
 * use. Its `usage` map answers `usageByCategory` for the ids it holds, and every other id answers
 * zeros.
 *
 * The rows are in their STORED form: `Second` carries a two-line description as Perfex's `nl2br`
 * writes it, so a spec can see the read form on the wire.
 */
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import type {
  ExpenseCategoriesListRequest,
  ExpenseCategoriesPage,
  ExpenseCategoriesSortField,
  ExpenseCategory,
  ExpenseCategoryUsage,
  NewExpenseCategory,
} from '../model/expense-categories.model.js';
import type { ExpenseCategoriesRepository } from '../repository/expense-categories.repository.js';

/** Three rows, ids 1 to 3 in this order; sorted by name they keep that order. */
export const SEED_ITEMS: readonly NewExpenseCategory[] = [
  { name: 'First', description: '' },
  { name: 'Second', description: 'Line one<br />\nline two' },
  { name: 'Third', description: 'Fuel only' },
];

/** No expense, mapping or advance refers to the category. */
export const ZERO_USAGE: ExpenseCategoryUsage = {
  expenses: 0,
  accountingMappings: 0,
  pettyCashAdvances: 0,
};

/**
 * The most rows the fake holds; past it the oldest row is evicted. Above `EXPORT_MAX_ROWS`
 * (10,000), so the export's cap stays reachable.
 */
export const EXPENSE_CATEGORIES_MEMORY_MAX_ROWS = 20_000;

/** The repository's public surface, which the fake answers method for method. */
export type ExpenseCategoriesRepositoryPort = Pick<
  ExpenseCategoriesRepository,
  'list' | 'count' | 'findById' | 'create' | 'update' | 'remove' | 'usageByCategory'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: ExpenseCategory, sortField: ExpenseCategoriesSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** The bounded in-memory store, with a settable answer for `usageByCategory`. */
export class InMemoryExpenseCategoriesRepository implements ExpenseCategoriesRepositoryPort {
  /** What `usageByCategory` answers for an id; any id not here answers `ZERO_USAGE`. */
  readonly usage = new Map<number, ExpenseCategoryUsage>();
  /** Insertion order is id order, so the first key is always the oldest row. */
  private readonly rows = new Map<number, ExpenseCategory>();
  private lastId = 0;

  /**
   * One keyset page: ordered by `(sortField, id)`, `after` the cursor row (or from the first row),
   * or the `limit` rows just `before` it; `total` counts every matching row, `rangeStart` is the
   * first row's 1-based rank (`0` on an empty page).
   */
  list(request: ExpenseCategoriesListRequest): Promise<ExpenseCategoriesPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: ExpenseCategory): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: ExpenseCategory[];
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

  count(request: ExpenseCategoriesListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<ExpenseCategory | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(input: NewExpenseCategory): Promise<ExpenseCategory> {
    this.lastId += 1;
    const row: ExpenseCategory = {
      id: this.lastId,
      name: input.name,
      description: input.description,
    };
    this.rows.set(row.id, row);
    if (this.rows.size > EXPENSE_CATEGORIES_MEMORY_MAX_ROWS) {
      const oldest = this.rows.keys().next();
      if (oldest.done !== true) this.rows.delete(oldest.value);
    }
    return Promise.resolve(row);
  }

  update(id: number, patch: Partial<NewExpenseCategory>): Promise<ExpenseCategory | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated: ExpenseCategory = {
      id,
      name: patch.name ?? row.name,
      description: patch.description ?? row.description,
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  usageByCategory(ids: readonly number[]): Promise<ReadonlyMap<number, ExpenseCategoryUsage>> {
    return Promise.resolve(new Map(ids.map((id) => [id, this.usage.get(id) ?? ZERO_USAGE])));
  }

  /** `?q=` over the name or the description (case-insensitive `contains`). */
  private matching(request: ExpenseCategoriesListRequest): ExpenseCategory[] {
    const needle = request.search?.toLowerCase() ?? null;
    return [...this.rows.values()].filter(
      (row) =>
        needle === null ||
        row.name.toLowerCase().includes(needle) ||
        (row.description ?? '').toLowerCase().includes(needle),
    );
  }
}

/**
 * The fake where the module expects the repository: the service's constructor and Nest's
 * `overrideProvider(...).useValue(...)`. The real class has a private `prisma` field, so TypeScript
 * will not accept a structural twin without this one cast; `implements` above keeps the twin honest.
 */
export function asRepository(
  fake: InMemoryExpenseCategoriesRepository,
): ExpenseCategoriesRepository {
  return fake as unknown as ExpenseCategoriesRepository;
}

/** Creates `items` in order through the fake's own `create`; answers the stored rows. */
export async function seedRepository(
  repo: ExpenseCategoriesRepositoryPort,
  items: readonly NewExpenseCategory[] = SEED_ITEMS,
): Promise<ExpenseCategory[]> {
  const stored: ExpenseCategory[] = [];
  for (const item of items) stored.push(await repo.create(item));
  return stored;
}

/** A new `InMemoryExpenseCategoriesRepository` seeded with `SEED_ITEMS` (ids 1 to 3). */
export async function seededStore(): Promise<InMemoryExpenseCategoriesRepository> {
  const repo = new InMemoryExpenseCategoriesRepository();
  await seedRepository(repo);
  return repo;
}
