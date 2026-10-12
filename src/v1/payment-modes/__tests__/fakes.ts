/**
 * The in-memory fake of the module's repository and the seed rows the service, facade and
 * controller specs share. `InMemoryPaymentModesRepository` answers the repository's public methods
 * structurally, with the same keyset order both ways (ties broken on the id; `false` before `true`
 * for the active sort), `total` and `rangeStart`, and the same `q` (the name or the description
 * contains it, case-insensitively as the columns' `_ci` collation compares; an all-digit `q` is
 * also the id).
 *
 * What it adds that the table cannot produce on demand: a payment mode that is in use (its `usage`
 * map answers `usageByPaymentMode` for the ids it holds; every other id answers zeros).
 */
import { AppError } from '../../../shared/errors/app-error.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import {
  PAYMENT_MODES_FACADE_MAX_ROWS,
  type NewPaymentMode,
  type PaymentModeRow,
  type PaymentModesListRequest,
  type PaymentModesPage,
  type PaymentModesSortField,
  type PaymentModeUsage,
} from '../model/payment-modes.model.js';
import {
  PAYMENT_MODE_REFERENCES,
  referenceKey,
  type PaymentModesRepository,
} from '../repository/payment-modes.repository.js';
import { NO_PAYMENT_MODE_USAGE } from '../service/payment-modes.transformer.js';

/**
 * Three rows in their stored form, ids 1 to 3: two share the name `Bank` (Perfex has no uniqueness
 * check), `Cash` is inactive with a NULL description, and the second `Bank` carries a two-line
 * description as Perfex's `nl2br` stored it. By the default name ascending they read 1, 3, 2.
 */
export const SEED_PAYMENT_MODES: readonly PaymentModeRow[] = [
  {
    id: 1,
    name: 'Bank',
    description: '',
    active: true,
    showOnPdf: 1,
    selectedByDefault: 1,
    invoicesOnly: 0,
    expensesOnly: 0,
  },
  {
    id: 2,
    name: 'Cash',
    description: null,
    active: false,
    showOnPdf: 0,
    selectedByDefault: 0,
    invoicesOnly: 0,
    expensesOnly: 1,
  },
  {
    id: 3,
    name: 'Bank',
    description: 'Line one<br />\nline two',
    active: true,
    showOnPdf: 0,
    selectedByDefault: 0,
    invoicesOnly: 1,
    expensesOnly: 0,
  },
];

/** Nothing refers to the payment mode. */
export const ZERO_USAGE: PaymentModeUsage = NO_PAYMENT_MODE_USAGE;

/** The repository's public surface, which the fake answers method for method. */
export type PaymentModesRepositoryPort = Pick<
  PaymentModesRepository,
  | 'list'
  | 'count'
  | 'findById'
  | 'create'
  | 'update'
  | 'setActive'
  | 'remove'
  | 'presentReferences'
  | 'usageByPaymentMode'
  | 'listAll'
  | 'findByIds'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: PaymentModeRow, sortField: PaymentModesSortField): Key {
  if (sortField === 'name') return [row.name, row.id];
  if (sortField === 'active') return [row.active, row.id];
  return [row.id, row.id];
}

/** The in-memory store, with a settable answer for `usageByPaymentMode`. */
export class InMemoryPaymentModesRepository implements PaymentModesRepositoryPort {
  /** What `usageByPaymentMode` answers for an id; any id not here answers `ZERO_USAGE`. */
  readonly usage = new Map<number, PaymentModeUsage>();
  private readonly rows = new Map<number, PaymentModeRow>();
  private lastId = 0;

  /** Puts rows in exactly as given (ids included), as Perfex's own rows already exist. */
  seed(rows: readonly PaymentModeRow[]): void {
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
  list(request: PaymentModesListRequest): Promise<PaymentModesPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: PaymentModeRow): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: PaymentModeRow[];
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

  count(request: PaymentModesListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<PaymentModeRow | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(input: NewPaymentMode): Promise<PaymentModeRow> {
    this.lastId += 1;
    const row: PaymentModeRow = { id: this.lastId, ...input };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  /** All seven columns rewritten, as Perfex's edit does. */
  update(id: number, patch: NewPaymentMode): Promise<PaymentModeRow | null> {
    if (!this.rows.has(id)) return Promise.resolve(null);
    const updated: PaymentModeRow = { id, ...patch };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  /** `active` only; `true` when the row exists, whether or not the flag changed. */
  setActive(id: number, active: boolean): Promise<boolean> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(false);
    this.rows.set(id, { ...row, active });
    return Promise.resolve(true);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  /** Every declared candidate: the fake has no schema to probe. */
  presentReferences(): Promise<ReadonlySet<string>> {
    return Promise.resolve(new Set(PAYMENT_MODE_REFERENCES.map(referenceKey)));
  }

  usageByPaymentMode(ids: readonly number[]): Promise<ReadonlyMap<number, PaymentModeUsage>> {
    return Promise.resolve(new Map(ids.map((id) => [id, this.usage.get(id) ?? ZERO_USAGE])));
  }

  listAll(): Promise<readonly PaymentModeRow[]> {
    const rows = [...this.rows.values()].sort((a, b) =>
      compareKeys(keyOf(a, 'name'), keyOf(b, 'name'), 'asc'),
    );
    if (rows.length > PAYMENT_MODES_FACADE_MAX_ROWS) {
      return Promise.reject(new AppError('ERP-INTERNAL-0001', 'too many payment modes'));
    }
    return Promise.resolve(rows);
  }

  findByIds(ids: readonly number[]): Promise<readonly PaymentModeRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => ids.includes(row.id)));
  }

  /** `?q=`: the name or the description contains it (case-insensitive), or the id equals it. */
  private matching(request: PaymentModesListRequest): PaymentModeRow[] {
    const search = request.search;
    if (search === null) return [...this.rows.values()];
    const needle = search.toLowerCase();
    const id = /^\d+$/.test(search) ? Number(search) : null;
    return [...this.rows.values()].filter(
      (row) =>
        row.name.toLowerCase().includes(needle) ||
        (row.description ?? '').toLowerCase().includes(needle) ||
        row.id === id,
    );
  }
}

/**
 * The fake where the module expects the repository: the service's constructor and Nest's
 * `overrideProvider(...).useValue(...)`. The real class has a private `prisma` field, so TypeScript
 * will not accept a structural twin without this one cast; `implements` above keeps the twin honest.
 */
export function asRepository(fake: InMemoryPaymentModesRepository): PaymentModesRepository {
  return fake as unknown as PaymentModesRepository;
}

/** A new `InMemoryPaymentModesRepository` seeded with `SEED_PAYMENT_MODES` (ids 1 to 3). */
export function seededStore(): InMemoryPaymentModesRepository {
  const repo = new InMemoryPaymentModesRepository();
  repo.seed(SEED_PAYMENT_MODES);
  return repo;
}
