/**
 * The in-memory fake of the module's repository and the seed rows the service, facade and
 * controller specs share. `InMemoryTaxesRepository` answers the repository's public methods
 * structurally, with the same keyset order both ways (ties broken on the id, the rate compared as a
 * NUMBER, so `5.00` sorts before `10.00` and `100.00`), `total` and `rangeStart`, and the same `q`
 * (the name contains it, an all-digit `q` is also the id, a rate is also the rate rounded).
 *
 * Two things it adds that the table cannot produce on demand: a tax that is in use (its `usage` map
 * answers `usageByTax` for the ids it holds; every other id answers zeros) and Perfex's default
 * taxes (its `defaultTax` string answers `defaultTaxSetting`).
 *
 * `findOtherByName` compares names case-insensitively: the documented assumption that `tbltaxes.name`
 * has a `_ci` collation, which `taxes.repository.int.spec.ts` checks against the real column.
 */
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import { AppError } from '../../../shared/errors/app-error.js';
import {
  TAXES_FACADE_MAX_ROWS,
  type NewTax,
  type TaxesListRequest,
  type TaxesPage,
  type TaxesSortField,
  type TaxRow,
  type TaxUsage,
} from '../model/taxes.model.js';
import type { TaxesRepository } from '../repository/taxes.repository.js';
import { NO_TAX_USAGE, roundRate } from '../service/taxes.transformer.js';

/**
 * Three rows, ids 1 to 3 in this order. By rate they read 2, 1, 3 (5.00, 10.00, 100.00: numeric,
 * where text order would put 100.00 before 5.00); by name 3, 2, 1. `VAT` is the name a case-variant
 * duplicate (`vat`) is tested against.
 */
export const SEED_TAXES: readonly NewTax[] = [
  { name: 'VAT', taxrate: '10.00' },
  { name: 'Reduced', taxrate: '5.00' },
  { name: 'Luxury', taxrate: '100.00' },
];

/** Nothing refers to the tax. */
export const ZERO_USAGE: TaxUsage = NO_TAX_USAGE;

/** The repository's public surface, which the fake answers method for method. */
export type TaxesRepositoryPort = Pick<
  TaxesRepository,
  | 'list'
  | 'count'
  | 'findById'
  | 'findOtherByName'
  | 'create'
  | 'update'
  | 'remove'
  | 'usageByTax'
  | 'defaultTaxSetting'
  | 'listAll'
  | 'findByIds'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: TaxRow, sortField: TaxesSortField): Key {
  if (sortField === 'rate') return [Number(row.taxrate), row.id];
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** The in-memory store, with settable answers for `usageByTax` and `defaultTaxSetting`. */
export class InMemoryTaxesRepository implements TaxesRepositoryPort {
  /** What `usageByTax` answers for an id; any id not here answers `ZERO_USAGE`. */
  readonly usage = new Map<number, TaxUsage>();
  /** What `defaultTaxSetting` answers: Perfex's `default_tax` option text. */
  defaultTax = '';
  private readonly rows = new Map<number, TaxRow>();
  private lastId = 0;

  /**
   * One keyset page: ordered by `(sort key, id)`, `after` the cursor row (or from the first row),
   * or the `limit` rows just `before` it; `total` counts every matching row, `rangeStart` is the
   * first row's 1-based rank (`0` on an empty page).
   */
  list(request: TaxesListRequest): Promise<TaxesPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: TaxRow): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: TaxRow[];
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

  count(request: TaxesListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<TaxRow | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  /** Case-insensitive, as a `_ci` collation compares (the int spec checks the real column). */
  findOtherByName(name: string, exceptId?: number): Promise<number | null> {
    const wanted = name.toLowerCase();
    const other = [...this.rows.values()].find(
      (row) => row.id !== exceptId && row.name.toLowerCase() === wanted,
    );
    return Promise.resolve(other?.id ?? null);
  }

  create(input: NewTax): Promise<TaxRow> {
    this.lastId += 1;
    const row: TaxRow = { id: this.lastId, name: input.name, taxrate: input.taxrate };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  update(id: number, patch: Partial<NewTax>): Promise<TaxRow | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated: TaxRow = {
      id,
      name: patch.name ?? row.name,
      taxrate: patch.taxrate ?? row.taxrate,
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  usageByTax(ids: readonly number[]): Promise<ReadonlyMap<number, TaxUsage>> {
    return Promise.resolve(new Map(ids.map((id) => [id, this.usage.get(id) ?? ZERO_USAGE])));
  }

  defaultTaxSetting(): Promise<string> {
    return Promise.resolve(this.defaultTax);
  }

  listAll(): Promise<readonly TaxRow[]> {
    const rows = [...this.rows.values()].sort((a, b) =>
      compareKeys(keyOf(a, 'rate'), keyOf(b, 'rate'), 'asc'),
    );
    if (rows.length > TAXES_FACADE_MAX_ROWS) {
      return Promise.reject(new AppError('ERP-INTERNAL-0001', 'too many taxes'));
    }
    return Promise.resolve(rows);
  }

  findByIds(ids: readonly number[]): Promise<readonly TaxRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => ids.includes(row.id)));
  }

  /** `?q=`: the name contains it (case-insensitive), or the id equals it, or the rounded rate does. */
  private matching(request: TaxesListRequest): TaxRow[] {
    const search = request.search;
    if (search === null) return [...this.rows.values()];
    const needle = search.toLowerCase();
    const id = /^\d+$/.test(search) ? Number(search) : null;
    const rate = roundRate(search);
    return [...this.rows.values()].filter(
      (row) => row.name.toLowerCase().includes(needle) || row.id === id || row.taxrate === rate,
    );
  }
}

/**
 * The fake where the module expects the repository: the service's constructor and Nest's
 * `overrideProvider(...).useValue(...)`. The real class has a private `prisma` field, so TypeScript
 * will not accept a structural twin without this one cast; `implements` above keeps the twin honest.
 */
export function asRepository(fake: InMemoryTaxesRepository): TaxesRepository {
  return fake as unknown as TaxesRepository;
}

/** Creates `items` in order through the fake's own `create`; answers the stored rows. */
export async function seedRepository(
  repo: TaxesRepositoryPort,
  items: readonly NewTax[] = SEED_TAXES,
): Promise<TaxRow[]> {
  const stored: TaxRow[] = [];
  for (const item of items) stored.push(await repo.create(item));
  return stored;
}

/** A new `InMemoryTaxesRepository` seeded with `SEED_TAXES` (ids 1 to 3). */
export async function seededStore(): Promise<InMemoryTaxesRepository> {
  const repo = new InMemoryTaxesRepository();
  await seedRepository(repo);
  return repo;
}
