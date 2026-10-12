/**
 * The in-memory fakes of the module and the seed rows the service, facade and controller specs
 * share, plus what other modules' test apps need:
 *
 * - `InMemoryDepartmentsRepository` answers the repository's public methods structurally, with the
 *   same keyset order both ways (ties broken on the id; a NULL calendar id first ascending, as
 *   MySQL orders it), `total` and `rangeStart`, and the same `q` (the name or the calendar id
 *   contains it, case-insensitively as the columns' `_ci` collation compares; an all-digit `q` is
 *   also the id). It has no write method, as the repository has none: rows arrive through `seed`
 *   and `reset`, as Perfex's own rows do. What it adds that the table cannot produce on demand:
 *   settable register counts (`usage`, zeros for any other id) and a settable failure
 *   (`usageError`), and it records every method call in `calls`, so a spec can prove a refused
 *   caller caused no read.
 * - `FakeDepartmentsFacade` (a settable picker `list`; `registerUsage` and
 *   `registerStaffDirectory` go through a real `DepartmentLinksRegistry`, so a malformed or
 *   duplicate registration throws as in production, and every call is recorded) and
 *   `stubDepartmentsModule(fake)`, the `stubCurrenciesModule` shape, for identity's test app:
 *   `.overrideModule(DepartmentsModule).useModule(...)`.
 */
import { Module, type DynamicModule } from '@nestjs/common';
import { AppError } from '../../../shared/errors/app-error.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import { DepartmentsFacade } from '../facade/departments.facade.js';
import {
  DEPARTMENTS_FACADE_MAX_ROWS,
  type DepartmentName,
  type DepartmentRow,
  type DepartmentsListRequest,
  type DepartmentsPage,
  type DepartmentsSortField,
  type DepartmentUsage,
} from '../model/departments.model.js';
import {
  DEPARTMENT_REFERENCES,
  referenceKey,
  type DepartmentsRepository,
} from '../repository/departments.repository.js';
import {
  DepartmentLinksRegistry,
  type DepartmentStaffDirectory,
  type DepartmentUsageCounter,
} from '../service/department-links.registry.js';
import { NO_DEPARTMENT_USAGE } from '../service/departments.transformer.js';

/**
 * Four rows in their stored form, ids 1 to 4: ids 2 and 3 share the name `Support` (Perfex has no
 * uniqueness check); id 3 is a child of id 2; id 4 has a NULL calendar id; ids 1 and 4 have a
 * manager (staff 11 and 12). By the default name ascending (ties on the id) they read 4, 1, 2, 3.
 */
export const SEED_DEPARTMENTS: readonly DepartmentRow[] = [
  {
    id: 1,
    name: 'Sales',
    hideFromClient: false,
    calendarId: 'cal-sales',
    managerId: 11,
    parentId: null,
  },
  {
    id: 2,
    name: 'Support',
    hideFromClient: true,
    calendarId: '',
    managerId: null,
    parentId: null,
  },
  {
    id: 3,
    name: 'Support',
    hideFromClient: false,
    calendarId: 'cal-3',
    managerId: null,
    parentId: 2,
  },
  {
    id: 4,
    name: 'Accounts',
    hideFromClient: false,
    calendarId: null,
    managerId: 12,
    parentId: null,
  },
];

/** The repository's public surface, which the fake answers method for method. */
export type DepartmentsRepositoryPort = Pick<
  DepartmentsRepository,
  | 'list'
  | 'count'
  | 'findById'
  | 'findAll'
  | 'findByIds'
  | 'presentReferences'
  | 'usageByDepartment'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: DepartmentRow, sortField: DepartmentsSortField): Key {
  if (sortField === 'name') return [row.name, row.id];
  if (sortField === 'calendarId') return [row.calendarId ?? false, row.id];
  return [row.id, row.id];
}

/** `?q=` over rows: the name or the calendar id contains it (case-insensitive), or the id equals it. */
function searched(rows: readonly DepartmentRow[], search: string | null): DepartmentRow[] {
  if (search === null) return [...rows];
  const needle = search.toLowerCase();
  const id = /^\d+$/.test(search) ? Number(search) : null;
  return rows.filter(
    (row) =>
      row.name.toLowerCase().includes(needle) ||
      (row.calendarId ?? '').toLowerCase().includes(needle) ||
      row.id === id,
  );
}

/** Name then id, as `findAll` and the picker order. */
function byNameThenId(a: DepartmentRow, b: DepartmentRow): number {
  return compareKeys([a.name, a.id], [b.name, b.id], 'asc');
}

/** The in-memory store, with settable register counts and a settable usage failure. */
export class InMemoryDepartmentsRepository implements DepartmentsRepositoryPort {
  /** What `usageByDepartment` answers for an id; any id not here answers zeros. */
  readonly usage = new Map<number, DepartmentUsage>();
  /** Every method called, in order: a refused caller must leave this empty. */
  readonly calls: string[] = [];
  /** When set, `usageByDepartment` rejects with it (a probe or a statement failed). */
  usageError: Error | null = null;
  private readonly rows = new Map<number, DepartmentRow>();

  /** Puts rows in exactly as given (ids included), as Perfex's own rows already exist. */
  seed(rows: readonly DepartmentRow[]): void {
    for (const row of rows) {
      this.rows.set(row.id, row);
    }
  }

  /** The store back to exactly `rows`: every other row dropped (a spec's reset between cases). */
  reset(rows: readonly DepartmentRow[]): void {
    this.rows.clear();
    this.seed(rows);
  }

  /** Every stored row, id ascending (a spec's view of the table). */
  all(): readonly DepartmentRow[] {
    return [...this.rows.values()].sort((a, b) => a.id - b.id);
  }

  list(request: DepartmentsListRequest): Promise<DepartmentsPage> {
    this.calls.push('list');
    const { sortField, order, cursor, limit } = request;
    const key = (row: DepartmentRow): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: DepartmentRow[];
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

  count(request: DepartmentsListRequest): Promise<number> {
    this.calls.push('count');
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<DepartmentRow | null> {
    this.calls.push('findById');
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  findAll(): Promise<readonly DepartmentRow[]> {
    this.calls.push('findAll');
    const rows = [...this.rows.values()].sort(byNameThenId);
    if (rows.length > DEPARTMENTS_FACADE_MAX_ROWS) {
      return Promise.reject(new AppError('ERP-INTERNAL-0001', 'too many departments'));
    }
    return Promise.resolve(rows);
  }

  findByIds(ids: readonly number[]): Promise<readonly DepartmentRow[]> {
    this.calls.push('findByIds');
    return Promise.resolve(this.all().filter((row) => ids.includes(row.id)));
  }

  /** Every register line, an integer line as `int` and a list line as `text`: the fake has no schema to probe. */
  presentReferences(): Promise<ReadonlyMap<string, string>> {
    this.calls.push('presentReferences');
    return Promise.resolve(
      new Map(
        DEPARTMENT_REFERENCES.map((reference) => [
          referenceKey(reference),
          reference.match === 'integerId' ? 'int' : 'text',
        ]),
      ),
    );
  }

  usageByDepartment(ids: readonly number[]): Promise<ReadonlyMap<number, DepartmentUsage>> {
    this.calls.push('usageByDepartment');
    if (this.usageError !== null) return Promise.reject(this.usageError);
    return Promise.resolve(
      new Map(ids.map((id) => [id, this.usage.get(id) ?? NO_DEPARTMENT_USAGE])),
    );
  }

  /** `?q=`: the name or the calendar id contains it (case-insensitive), or the id equals it. */
  private matching(request: DepartmentsListRequest): DepartmentRow[] {
    return searched([...this.rows.values()], request.search);
  }
}

/**
 * The fake where the module expects the repository: the service's constructor and Nest's
 * `overrideProvider(...).useValue(...)`. The real class has a private `prisma` field, so TypeScript
 * will not accept a structural twin without this one cast; `implements` above keeps the twin honest.
 */
export function asRepository(fake: InMemoryDepartmentsRepository): DepartmentsRepository {
  return fake as unknown as DepartmentsRepository;
}

/** A new `InMemoryDepartmentsRepository` seeded with `SEED_DEPARTMENTS` (ids 1 to 4). */
export function seededStore(): InMemoryDepartmentsRepository {
  const repo = new InMemoryDepartmentsRepository();
  repo.seed(SEED_DEPARTMENTS);
  return repo;
}

/** The picker shape of the seed rows, by name then id: 4, 1, 2, 3. */
export const SEED_PICKER: readonly DepartmentName[] = [...SEED_DEPARTMENTS]
  .sort(byNameThenId)
  .map((row) => ({ departmentId: row.id, name: row.name }));

/**
 * The facade other modules' test apps get: the picker `list` settable (the seed by default),
 * `existingIds` answering from it, every registration recorded and checked by a real
 * `DepartmentLinksRegistry`, and every `existingIds` question recorded.
 */
export class FakeDepartmentsFacade {
  /** The counters registered, in call order. */
  readonly registered: DepartmentUsageCounter[] = [];
  /** The directories registered, in call order (a second throws before it is recorded). */
  readonly directories: DepartmentStaffDirectory[] = [];
  /** The ids each `existingIds` call asked about, in call order. */
  readonly asked: (readonly number[])[] = [];
  /** The registry the registrations go through: a malformed or duplicate one throws. */
  readonly registry = new DepartmentLinksRegistry();
  /** What `listForPicker()` answers and `existingIds` reads. */
  list: readonly DepartmentName[];
  /** How many times `listForPicker()` was called. */
  pickerCalls = 0;

  constructor(list: readonly DepartmentName[] = SEED_PICKER) {
    this.list = list;
  }

  describe(): { readonly module: 'departments'; readonly version: 1 } {
    return { module: 'departments', version: 1 };
  }

  registerUsage(counter: DepartmentUsageCounter): void {
    this.registry.register(counter);
    this.registered.push(counter);
  }

  registerStaffDirectory(directory: DepartmentStaffDirectory): void {
    this.registry.setStaffDirectory(directory);
    this.directories.push(directory);
  }

  listForPicker(): Promise<readonly DepartmentName[]> {
    this.pickerCalls += 1;
    return Promise.resolve(this.list);
  }

  existingIds(ids: readonly number[]): Promise<ReadonlySet<number>> {
    this.asked.push([...ids]);
    const known = new Set(this.list.map((entry) => entry.departmentId));
    return Promise.resolve(new Set(ids.filter((id) => known.has(id))));
  }
}

/** A module providing `DepartmentsFacade` as the fake, for `.overrideModule(DepartmentsModule).useModule(...)`. */
export function stubDepartmentsModule(fake: FakeDepartmentsFacade): DynamicModule {
  @Module({
    providers: [{ provide: DepartmentsFacade, useValue: fake }],
    exports: [DepartmentsFacade],
  })
  class StubDepartmentsModule {}
  return { module: StubDepartmentsModule };
}
