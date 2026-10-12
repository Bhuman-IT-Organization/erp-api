/**
 * CostCentersRepository over a stub client: what it asks the database, not what the database
 * answers (the int spec proves that against the local mirror). The stub records every delegate call
 * and every tagged `$queryRaw` (its SQL text with `?` for each hole, and its bound values), and
 * answers the `information_schema` probe from a settable list of present columns, so these cases
 * prove the shapes the module depends on: D-28's runtime discovery (a missing candidate runs no
 * statement and counts 0, a present one is counted, with no code change between the two), the
 * probe's names and the ids only in the bound values, the asset match by the exact NAME, fail
 * closed, the facade's bounded `listAll`, an update that writes the name only, P2025 as `null`, and
 * the keyset list.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import {
  COST_CENTERS_FACADE_MAX_ROWS,
  type CostCentersListRequest,
  type CostCenterUsage,
} from '../model/cost-centers.model.js';
import {
  COST_CENTER_REFERENCES,
  CostCentersRepository,
} from '../repository/cost-centers.repository.js';
import { NO_COST_CENTER_USAGE } from '../service/cost-centers.transformer.js';

/** The repository's constructor parameter, named without importing the database layer. */
type ClientHolder = ConstructorParameters<typeof CostCentersRepository>[0];

interface RawCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface PresentColumn {
  readonly t: string;
  readonly c: string;
}

/** Every candidate of D-28, with its group, as the plan's interfaces declare them. */
const CANDIDATES: readonly (readonly [string, string, keyof CostCenterUsage])[] = [
  ['tblpur_request', 'cost_center', 'purchaseRequests'],
  ['tblpur_orders', 'cost_center', 'purchaseOrders'],
  ['tblpur_estimates', 'cost_center', 'purchaseQuotations'],
  ['tblinv_shipping_charges', 'cost_center', 'shippingCharges'],
  ['tblexpenses', 'cost_center', 'expenses'],
  ['tblfe_asset_creation', 'cost_centre', 'assets'],
];

const ALL_PRESENT: readonly PresentColumn[] = CANDIDATES.map(([t, c]) => ({ t, c }));

const PROBE = 'information_schema.COLUMNS';

/** The table a usage statement reads: the word after `JOIN` (the name match), else after `FROM`. */
function readTable(sql: string): string {
  return /JOIN (\w+) r /.exec(sql)?.[1] ?? /FROM (\w+) r /.exec(sql)?.[1] ?? '';
}

/** A bound `Prisma.join(...)` arrives as one value holding its own `values`. */
function isJoined(value: unknown): value is { values: unknown[] } {
  return (
    typeof value === 'object' && value !== null && 'values' in value && Array.isArray(value.values)
  );
}

function flatten(values: readonly unknown[]): unknown[] {
  return values.flatMap((value) => (isJoined(value) ? value.values : [value]));
}

interface StubOptions {
  /** What the probe answers (a live array: a case may push to it between two calls). */
  readonly columns?: PresentColumn[] | Error;
  /** What a usage statement answers per table; an `Error` rejects; absent answers `[]`. */
  readonly raw?: Readonly<Record<string, unknown>>;
  readonly rows?: readonly unknown[];
  readonly first?: unknown;
  readonly update?: () => Promise<unknown>;
  readonly deleted?: number;
  readonly counts?: readonly number[];
}

function stub(options: StubOptions = {}) {
  const raw: RawCall[] = [];
  const calls: { method: string; args: unknown }[] = [];
  const counts = [...(options.counts ?? [])];
  const record =
    <T>(method: string, answer: () => Promise<T>) =>
    (args: unknown): Promise<T> => {
      calls.push({ method, args });
      return answer();
    };
  const client = {
    tblcost_centers: {
      findMany: record('findMany', () => Promise.resolve(options.rows ?? [])),
      count: record('count', () => Promise.resolve(counts.shift() ?? 0)),
      findFirst: record('findFirst', () => Promise.resolve(options.first ?? null)),
      create: record('create', () =>
        Promise.resolve({
          id: 9,
          name: 'Head Office',
          created_by: 4,
          datecreated: new Date('2026-10-03T00:30:15.000Z'),
        }),
      ),
      update: record('update', options.update ?? (() => Promise.resolve(null))),
      deleteMany: record('deleteMany', () => Promise.resolve({ count: options.deleted ?? 1 })),
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
      const sql = strings.join('?');
      raw.push({ sql, values: flatten(values) });
      if (sql.includes(PROBE)) {
        const columns = options.columns ?? ALL_PRESENT;
        return columns instanceof Error ? Promise.reject(columns) : Promise.resolve(columns);
      }
      const answer = options.raw?.[readTable(sql)] ?? [];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  const repository = new CostCentersRepository({ client } as unknown as ClientHolder);
  return { repository, raw, calls };
}

function request(overrides: Partial<CostCentersListRequest> = {}): CostCentersListRequest {
  return { search: null, sortField: 'id', order: 'desc', cursor: null, limit: 25, ...overrides };
}

const usageStatements = (raw: readonly RawCall[]): RawCall[] =>
  raw.filter((call) => !call.sql.includes(PROBE));

describe('CostCentersRepository: the referencing columns discovered at runtime (D-28)', () => {
  it('D-28: a missing column counts 0 and raises no error; a present column is counted', async () => {
    const columns: PresentColumn[] = [{ t: 'tblpur_orders', c: 'cost_center' }];
    const { repository, raw } = stub({
      columns,
      raw: { tblpur_orders: [{ id: 7, n: 2n }], tblexpenses: [{ id: 7, n: 3n }] },
    });

    const before = await repository.usageByCostCenter([7, 9]);
    expect(raw).toHaveLength(2);
    expect(raw[0]?.sql).toContain(PROBE);
    expect(readTable(raw[1]?.sql ?? '')).toBe('tblpur_orders');
    for (const call of raw) {
      expect(call.sql).not.toContain('tblexpenses');
      expect(call.sql).not.toContain('tblinv_shipping_charges');
    }
    expect(before.get(7)).toEqual({ ...NO_COST_CENTER_USAGE, purchaseOrders: 2 });
    expect(before.get(9)).toEqual(NO_COST_CENTER_USAGE);

    // The Expenses slice adds tblexpenses.cost_center with its own DDL: no code change here.
    columns.push({ t: 'tblexpenses', c: 'cost_center' });
    raw.length = 0;
    const after = await repository.usageByCostCenter([7, 9]);
    expect(usageStatements(raw).map((call) => readTable(call.sql))).toEqual([
      'tblpur_orders',
      'tblexpenses',
    ]);
    expect(after.get(7)).toEqual({ ...NO_COST_CENTER_USAGE, purchaseOrders: 2, expenses: 3 });
    expect(after.get(9)).toEqual(NO_COST_CENTER_USAGE);
  });

  it('assets: an asset whose cost_centre equals the name exactly is counted; a case variant is not; an absent column counts 0', async () => {
    // Unit form: tblfe_asset_creation is fixed_equipment-owned, so the ownership guard refuses
    // seeding it from the int spec. The statement compares the bytes, so
    // the database counts an exact name only; the int spec checks that comparison on real columns.
    const present = stub({ raw: { tblfe_asset_creation: [{ id: 7, n: 1n }] } });
    const usage = await present.repository.usageByCostCenter([7]);
    const assets = usageStatements(present.raw).find(
      (call) => readTable(call.sql) === 'tblfe_asset_creation',
    );
    expect(assets?.sql).toContain(
      'FROM tblcost_centers c JOIN tblfe_asset_creation r ON CAST(r.cost_centre AS BINARY) = CAST(c.name AS BINARY) WHERE c.id IN (?) GROUP BY c.id',
    );
    expect(assets?.sql).not.toMatch(/r\.cost_centre\s*=\s*c\.name/);
    expect(assets?.sql).not.toMatch(/COLLATE|LOWER\(|UPPER\(/);
    expect(assets?.values).toEqual([7]);
    expect(usage.get(7)?.assets).toBe(1);

    const absent = stub({
      columns: ALL_PRESENT.filter((column) => column.t !== 'tblfe_asset_creation'),
      raw: { tblfe_asset_creation: new Error('Unknown column cost_centre') },
    });
    const without = await absent.repository.usageByCostCenter([7]);
    expect(absent.raw.some((call) => readTable(call.sql) === 'tblfe_asset_creation')).toBe(false);
    expect(without.get(7)?.assets).toBe(0);
  });

  it('an empty id list issues nothing: no probe, no statement', async () => {
    const { repository, raw, calls } = stub();
    expect((await repository.usageByCostCenter([])).size).toBe(0);
    expect(raw).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('the probe binds every candidate table and column name: none is SQL text', async () => {
    const { repository, raw } = stub();
    expect([...(await repository.presentReferences())].sort()).toEqual(
      CANDIDATES.map(([t, c]) => `${t}.${c}`).sort(),
    );
    expect(raw).toHaveLength(1);
    const [probe] = raw;
    expect(probe?.sql).toBe(
      'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) AND COLUMN_NAME IN (?)',
    );
    for (const [table, column] of CANDIDATES) {
      expect(probe?.values).toContain(table);
      expect(probe?.values).toContain(column);
      expect(probe?.sql).not.toContain(table);
    }
  });

  it('the probe matches a candidate exactly, in any letter case, and only a declared pair', async () => {
    const { repository } = stub({
      columns: [
        { t: 'TBLPUR_REQUEST', c: 'COST_CENTER' },
        { t: 'tblpur_request', c: 'cost_centre' },
        { t: 'tblfe_asset_creation', c: 'cost_center' },
      ],
    });
    expect([...(await repository.presentReferences())]).toEqual(['tblpur_request.cost_center']);
  });

  it('with every candidate present: one statement per candidate, the table in the text, the ids only in the values', async () => {
    const { repository, raw } = stub();
    await repository.usageByCostCenter([7, 9]);
    const statements = usageStatements(raw);
    expect(statements.map((call) => readTable(call.sql)).sort()).toEqual(
      CANDIDATES.map(([table]) => table).sort(),
    );
    for (const call of statements) {
      expect(call.values).toEqual([7, 9]);
      expect(call.sql).toMatch(/^SELECT (r\.cost_center|c\.id) AS id, COUNT\(\*\) AS n FROM /);
      expect(call.sql).not.toMatch(/[79]/);
    }
    const byId = statements.find((call) => readTable(call.sql) === 'tblpur_request');
    expect(byId?.sql).toBe(
      'SELECT r.cost_center AS id, COUNT(*) AS n FROM tblpur_request r WHERE r.cost_center IN (?) GROUP BY r.cost_center',
    );
  });

  it.each(CANDIDATES)('a count on %s.%s lands in the %s group', async (table, _column, group) => {
    const { repository } = stub({ raw: { [table]: [{ id: '3', n: 1n }] } });
    const usage = await repository.usageByCostCenter([3]);
    expect(usage.get(3)).toEqual({ ...NO_COST_CENTER_USAGE, [group]: 1 });
  });

  it('declares exactly the six candidates of plan 04.1-17, frozen, five by id and one by name', () => {
    expect(Object.isFrozen(COST_CENTER_REFERENCES)).toBe(true);
    expect(
      COST_CENTER_REFERENCES.map((reference) => [
        reference.table,
        reference.column,
        reference.group,
        reference.match,
      ]),
    ).toEqual(
      CANDIDATES.map(([table, column, group]) => [
        table,
        column,
        group,
        table === 'tblfe_asset_creation' ? 'name' : 'id',
      ]),
    );
  });

  it('fails closed: a rejecting probe rejects the call', async () => {
    const { repository } = stub({ columns: new Error('information_schema unavailable') });
    await expect(repository.usageByCostCenter([7])).rejects.toThrow(
      'information_schema unavailable',
    );
  });

  it('fails closed: a rejecting statement rejects the call', async () => {
    const { repository } = stub({ raw: { tblpur_estimates: new Error('lock wait timeout') } });
    await expect(repository.usageByCostCenter([7])).rejects.toThrow('lock wait timeout');
  });

  it('a malformed answer row or probe row is refused, never read as zero', async () => {
    const row = stub({ raw: { tblpur_orders: [{ id: 7 }] } });
    await expect(row.repository.usageByCostCenter([7])).rejects.toThrow();
    const probe = stub({ columns: [{ t: 'tblpur_orders' } as unknown as PresentColumn] });
    await expect(probe.repository.presentReferences()).rejects.toThrow();
  });
});

describe('CostCentersRepository: the table delegate', () => {
  const COLUMNS = { id: true, name: true, created_by: true, datecreated: true };

  it('create writes the name, created_by and datecreated, and maps the stored row', async () => {
    const { repository, calls } = stub();
    const datecreated = new Date('2026-10-03T00:30:15.000Z');
    expect(await repository.create({ name: 'Head Office', createdBy: 4, datecreated })).toEqual({
      id: 9,
      name: 'Head Office',
      createdBy: 4,
      datecreated,
    });
    expect(calls[0]).toEqual({
      method: 'create',
      args: { data: { name: 'Head Office', created_by: 4, datecreated }, select: COLUMNS },
    });
  });

  it('update sends only the name and answers null on a Prisma P2025; anything else rethrows', async () => {
    const missing = stub({
      update: () => Promise.reject(Object.assign(new Error('not found'), { code: 'P2025' })),
    });
    expect(await missing.repository.update(404, { name: 'Nobody' })).toBeNull();
    expect(missing.calls).toEqual([
      {
        method: 'update',
        args: { where: { id: 404 }, data: { name: 'Nobody' }, select: COLUMNS },
      },
    ]);
    const extra = { name: 'Renamed', created_by: 99, datecreated: new Date(0) };
    const written = stub({
      update: () => Promise.resolve({ id: 3, name: 'Renamed', created_by: 4, datecreated: null }),
    });
    expect(await written.repository.update(3, extra)).toEqual({
      id: 3,
      name: 'Renamed',
      createdBy: 4,
      datecreated: null,
    });
    expect(written.calls[0]?.args).toMatchObject({ data: { name: 'Renamed' } });
    expect(Object.keys((written.calls[0]?.args as { data: object }).data)).toEqual(['name']);
    const broken = stub({
      update: () => Promise.reject(Object.assign(new Error('deadlock'), { code: 'P2034' })),
    });
    await expect(broken.repository.update(1, { name: 'X' })).rejects.toThrow('deadlock');
  });

  it('findById reads the four columns; remove answers from deleteMany', async () => {
    const { repository, calls } = stub({
      first: { id: 2, name: 'Warehouse', created_by: null, datecreated: null },
    });
    expect(await repository.findById(2)).toEqual({
      id: 2,
      name: 'Warehouse',
      createdBy: null,
      datecreated: null,
    });
    expect(calls[0]?.args).toEqual({ where: { id: 2 }, select: COLUMNS });
    expect(await stub().repository.findById(3)).toBeNull();
    expect(await stub({ deleted: 0 }).repository.remove(404)).toBe(false);
    expect(await stub({ deleted: 1 }).repository.remove(2)).toBe(true);
  });

  it('listAll reads the name ascending then the id, at most MAX + 1 rows', async () => {
    const { repository, calls } = stub({
      rows: [{ id: 1, name: 'A', created_by: null, datecreated: null }],
    });
    expect(await repository.listAll()).toHaveLength(1);
    expect(calls).toEqual([
      {
        method: 'findMany',
        args: {
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: COST_CENTERS_FACADE_MAX_ROWS + 1,
          select: COLUMNS,
        },
      },
    ]);
  });

  it('listAll refuses MAX + 1 rows loudly (ERP-INTERNAL-0001), never truncating', async () => {
    const rows = Array.from({ length: COST_CENTERS_FACADE_MAX_ROWS + 1 }, (_, index) => ({
      id: index + 1,
      name: `C${String(index)}`,
      created_by: null,
      datecreated: null,
    }));
    const error = await stub({ rows })
      .repository.listAll()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ code: 'ERP-INTERNAL-0001' });
  });

  it('findByIds is one findMany with id in the ids; no ids, no query', async () => {
    const empty = stub();
    expect(await empty.repository.findByIds([])).toEqual([]);
    expect(empty.calls).toEqual([]);
    const { repository, calls } = stub({
      rows: [{ id: 9, name: 'Ops', created_by: 1, datecreated: null }],
    });
    expect((await repository.findByIds([9, 7])).map((row) => row.id)).toEqual([9]);
    expect(calls[0]?.args).toEqual({ where: { id: { in: [9, 7] } }, select: COLUMNS });
  });

  it('list pages on (id, id) descending by default; q matches the name and an all-digit id', async () => {
    const { repository, calls } = stub({
      rows: [
        { id: 5, name: 'Five', created_by: null, datecreated: null },
        { id: 4, name: 'Four', created_by: null, datecreated: null },
      ],
      counts: [5, 2],
    });
    const cursor = { sort: 'id' as const, key: [6, 6] as const, direction: 'after' as const };
    const page = await repository.list(request({ search: '5', cursor, limit: 2 }));
    const match = { OR: [{ name: { contains: '5' } }, { id: 5 }] };
    expect(calls[0]).toEqual({
      method: 'findMany',
      args: {
        where: { AND: [match, { OR: [{ id: { lt: 6 } }, { id: { lt: 6 } }] }] },
        orderBy: [{ id: 'desc' }, { id: 'desc' }],
        take: 2,
        select: COLUMNS,
      },
    });
    expect(page.rangeStart).toBe(3);
    expect(page.nextCursor).not.toBeNull();
    expect(page.prevCursor).not.toBeNull();
  });

  it('q that is no number matches the name only; an id beyond INT UNSIGNED is not an id', async () => {
    const { repository, calls } = stub();
    await repository.count(request({ search: 'office' }));
    expect(calls[0]?.args).toEqual({ where: { OR: [{ name: { contains: 'office' } }] } });
    const fits = stub();
    await fits.repository.count(request({ search: '4294967295' }));
    expect(fits.calls[0]?.args).toEqual({
      where: { OR: [{ name: { contains: '4294967295' } }, { id: 4_294_967_295 }] },
    });
    const long = stub();
    await long.repository.count(request({ search: '4294967296' }));
    expect(long.calls[0]?.args).toEqual({ where: { OR: [{ name: { contains: '4294967296' } }] } });
  });

  it('a before cursor reads reversed and answers in order; an empty page has no cursors', async () => {
    const { repository, calls } = stub({
      rows: [
        { id: 3, name: 'A', created_by: null, datecreated: null },
        { id: 5, name: 'B', created_by: null, datecreated: null },
      ],
      counts: [4, 1],
    });
    const page = await repository.list(
      request({
        sortField: 'name',
        order: 'desc',
        cursor: { sort: 'name', key: ['C', 2], direction: 'before' },
      }),
    );
    expect(calls[0]?.args).toMatchObject({ orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    expect(page.items.map((row) => row.id)).toEqual([5, 3]);
    const empty = await stub().repository.list(request());
    expect(empty).toEqual({
      items: [],
      nextCursor: null,
      prevCursor: null,
      total: 0,
      rangeStart: 0,
    });
  });
});
