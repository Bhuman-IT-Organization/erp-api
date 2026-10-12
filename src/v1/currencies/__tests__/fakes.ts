/**
 * The in-memory fakes of the module and the seed rows the service, facade and controller specs
 * share, plus what other modules' test apps need:
 *
 * - `InMemoryCurrenciesRepository` answers the repository's public methods structurally, with the
 *   same keyset order both ways (ties broken on the id), `total` and `rangeStart`, and the same `q`
 *   (the code or the symbol contains it, case-insensitively as the columns' `_ci` collation compares;
 *   an all-digit `q` is also the id). What it adds that the table cannot produce on demand: settable
 *   register counts (`counts`, zeros for any other id) and a settable failure (`usageError`), and it
 *   records every method call in `calls`, so a spec can prove a refused caller caused no read.
 * - `FakeCurrenciesFacade` (settable `base` and `list`; `registerUsage` goes through a real
 *   `CurrencyUsageRegistry`, so a malformed or duplicate counter throws as in production, and every
 *   call is recorded) and `stubCurrenciesModule(fake)`, the `stubSettingsModule` shape, for
 *   branding's test app: `.overrideModule(CurrenciesModule).useModule(...)`.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import type { DbTransaction } from '../../../shared/db/transaction.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import { CurrenciesFacade } from '../facade/currencies.facade.js';
import {
  CURRENCIES_FACADE_MAX_ROWS,
  type CurrenciesListRequest,
  type CurrenciesPage,
  type CurrenciesSortField,
  type Currency,
  type CurrencyReferenceCounts,
  type CurrencyRow,
  type NewCurrency,
} from '../model/currencies.model.js';
import {
  CURRENCY_REFERENCES,
  referenceKey,
  type CurrenciesRepository,
} from '../repository/currencies.repository.js';
import { NO_CURRENCY_REFERENCES, toCurrency } from '../service/currencies.transformer.js';
import {
  CurrencyUsageRegistry,
  type CurrencyUsageCounter,
} from '../service/currency-usage.registry.js';

/**
 * Four rows in their stored form, ids 1 to 4: `USD` is the base; ids 2 and 3 share the code `EUR`
 * (Perfex has no uniqueness check); `AED` has NULL separators and placement. By the default code
 * descending (ties on the id descending) they read 1, 3, 2, 4.
 */
export const SEED_CURRENCIES: readonly CurrencyRow[] = [
  {
    id: 1,
    name: 'USD',
    symbol: '$',
    decimalSeparator: '.',
    thousandSeparator: ',',
    placement: 'before',
    isBase: true,
  },
  {
    id: 2,
    name: 'EUR',
    symbol: 'EUR',
    decimalSeparator: ',',
    thousandSeparator: '.',
    placement: 'after',
    isBase: false,
  },
  {
    id: 3,
    name: 'EUR',
    symbol: 'E',
    decimalSeparator: '.',
    thousandSeparator: ' ',
    placement: 'before',
    isBase: false,
  },
  {
    id: 4,
    name: 'AED',
    symbol: 'AED',
    decimalSeparator: null,
    thousandSeparator: null,
    placement: null,
    isBase: false,
  },
];

/** The repository's public surface, which the fake answers method for method. */
export type CurrenciesRepositoryPort = Pick<
  CurrenciesRepository,
  | 'list'
  | 'count'
  | 'findById'
  | 'findBase'
  | 'create'
  | 'update'
  | 'setBase'
  | 'setBaseIn'
  | 'remove'
  | 'presentReferences'
  | 'usageByCurrency'
  | 'listAll'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: CurrencyRow, sortField: CurrenciesSortField): Key {
  if (sortField === 'name') return [row.name, row.id];
  if (sortField === 'symbol') return [row.symbol, row.id];
  return [row.id, row.id];
}

/** The in-memory store, with settable register counts and a settable usage failure. */
export class InMemoryCurrenciesRepository implements CurrenciesRepositoryPort {
  /** What `usageByCurrency` answers for an id; any id not here answers zeros. */
  readonly counts = new Map<number, CurrencyReferenceCounts>();
  /** Every method called, in order: a refused caller must leave this empty. */
  readonly calls: string[] = [];
  /** When set, `usageByCurrency` rejects with it (a probe or a statement failed). */
  usageError: Error | null = null;
  private readonly rows = new Map<number, CurrencyRow>();
  private lastId = 0;

  /** Puts rows in exactly as given (ids included), as Perfex's own rows already exist. */
  seed(rows: readonly CurrencyRow[]): void {
    for (const row of rows) {
      this.rows.set(row.id, row);
      this.lastId = Math.max(this.lastId, row.id);
    }
  }

  /** Every stored row, id ascending (a spec's view of the table). */
  all(): readonly CurrencyRow[] {
    return [...this.rows.values()].sort((a, b) => a.id - b.id);
  }

  list(request: CurrenciesListRequest): Promise<CurrenciesPage> {
    this.calls.push('list');
    const { sortField, order, cursor, limit } = request;
    const key = (row: CurrencyRow): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: CurrencyRow[];
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

  count(request: CurrenciesListRequest): Promise<number> {
    this.calls.push('count');
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<CurrencyRow | null> {
    this.calls.push('findById');
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  findBase(): Promise<CurrencyRow | null> {
    this.calls.push('findBase');
    return Promise.resolve(this.all().find((row) => row.isBase) ?? null);
  }

  create(input: NewCurrency): Promise<CurrencyRow> {
    this.calls.push('create');
    this.lastId += 1;
    const row: CurrencyRow = { id: this.lastId, ...input, isBase: false };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  /** All five columns rewritten, as Perfex's edit does; the base flag kept. */
  update(id: number, input: NewCurrency): Promise<CurrencyRow | null> {
    this.calls.push('update');
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated: CurrencyRow = { ...row, ...input };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  setBase(id: number): Promise<boolean> {
    this.calls.push('setBase');
    return Promise.resolve(this.switchBase(id));
  }

  /** The fake has no transaction: the switch runs on the store. */
  setBaseIn(_tx: DbTransaction, id: number): Promise<boolean> {
    this.calls.push('setBaseIn');
    return Promise.resolve(this.switchBase(id));
  }

  remove(id: number): Promise<boolean> {
    this.calls.push('remove');
    return Promise.resolve(this.rows.delete(id));
  }

  /** Every register line, an integer line as `int` and a text line as `varchar`: the fake has no schema to probe. */
  presentReferences(): Promise<ReadonlyMap<string, string>> {
    this.calls.push('presentReferences');
    return Promise.resolve(
      new Map(
        CURRENCY_REFERENCES.map((reference) => [
          referenceKey(reference),
          reference.match === 'integerId' ? 'int' : 'varchar',
        ]),
      ),
    );
  }

  usageByCurrency(
    rows: readonly Pick<CurrencyRow, 'id' | 'name'>[],
  ): Promise<ReadonlyMap<number, CurrencyReferenceCounts>> {
    this.calls.push('usageByCurrency');
    if (this.usageError !== null) return Promise.reject(this.usageError);
    return Promise.resolve(
      new Map(rows.map((row) => [row.id, this.counts.get(row.id) ?? NO_CURRENCY_REFERENCES])),
    );
  }

  listAll(): Promise<readonly CurrencyRow[]> {
    this.calls.push('listAll');
    const rows = this.all();
    if (rows.length > CURRENCIES_FACADE_MAX_ROWS) {
      return Promise.reject(new AppError('ERP-INTERNAL-0001', 'too many currencies'));
    }
    return Promise.resolve(rows);
  }

  /** Perfex's switch: the id the base, every other row cleared; `false` for a missing id. */
  private switchBase(id: number): boolean {
    if (!this.rows.has(id)) return false;
    for (const row of this.rows.values()) this.rows.set(row.id, { ...row, isBase: row.id === id });
    return true;
  }

  /** `?q=`: the code or the symbol contains it (case-insensitive), or the id equals it. */
  private matching(request: CurrenciesListRequest): CurrencyRow[] {
    const search = request.search;
    if (search === null) return [...this.rows.values()];
    const needle = search.toLowerCase();
    const id = /^\d+$/.test(search) ? Number(search) : null;
    return [...this.rows.values()].filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        row.symbol.toLowerCase().includes(needle) ||
        row.id === id,
    );
  }
}

/**
 * The fake where the module expects the repository: the service's constructor and Nest's
 * `overrideProvider(...).useValue(...)`. The real class has a private `prisma` field, so TypeScript
 * will not accept a structural twin without this one cast; `implements` above keeps the twin honest.
 */
export function asRepository(fake: InMemoryCurrenciesRepository): CurrenciesRepository {
  return fake as unknown as CurrenciesRepository;
}

/** A new `InMemoryCurrenciesRepository` seeded with `SEED_CURRENCIES` (ids 1 to 4). */
export function seededStore(): InMemoryCurrenciesRepository {
  const repo = new InMemoryCurrenciesRepository();
  repo.seed(SEED_CURRENCIES);
  return repo;
}

/**
 * The facade other modules' test apps get: `base` and `list` settable (the seed by default), every
 * `registerUsage` recorded and checked by a real `CurrencyUsageRegistry`.
 */
export class FakeCurrenciesFacade {
  /** The counters registered, in call order. */
  readonly registered: CurrencyUsageCounter[] = [];
  /** The registry the calls go through: a malformed or duplicate counter throws. */
  readonly registry = new CurrencyUsageRegistry();
  /** What `baseCurrency()` answers. */
  base: Currency | null;
  /** What `listAll()` answers. */
  list: readonly Currency[];

  constructor(rows: readonly CurrencyRow[] = SEED_CURRENCIES) {
    this.list = rows.map(toCurrency);
    this.base = this.list.find((currency) => currency.isBase) ?? null;
  }

  describe(): { readonly module: 'currencies'; readonly version: 1 } {
    return { module: 'currencies', version: 1 };
  }

  registerUsage(counter: CurrencyUsageCounter): void {
    this.registry.register(counter);
    this.registered.push(counter);
  }

  listAll(): Promise<readonly Currency[]> {
    return Promise.resolve(this.list);
  }

  baseCurrency(): Promise<Currency | null> {
    return Promise.resolve(this.base);
  }
}

/** A module providing `CurrenciesFacade` as the fake, for `.overrideModule(CurrenciesModule).useModule(...)`. */
export function stubCurrenciesModule(fake: FakeCurrenciesFacade): DynamicModule {
  @Module({
    providers: [{ provide: CurrenciesFacade, useValue: fake }],
    exports: [CurrenciesFacade],
  })
  class StubCurrenciesModule {}
  return { module: StubCurrenciesModule };
}
