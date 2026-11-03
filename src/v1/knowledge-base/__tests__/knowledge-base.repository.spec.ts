/**
 * KnowledgeBaseRepository over a stub client: what it asks the database, not what the database
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
  KNOWLEDGE_BASE_FACADE_MAX_ROWS,
  type KnowledgeBaseListRequest,
  type KnowledgeBaseUsage,
} from '../model/knowledge-base.model.js';
import {
  KNOWLEDGE_BASE_REFERENCES,
  KnowledgeBaseRepository,
} from '../repository/knowledge-base.repository.js';
import { NO_KNOWLEDGE_BASE_USAGE } from '../service/knowledge-base.transformer.js';

/** The repository's constructor parameter, named without importing the database layer. */
type ClientHolder = ConstructorParameters<typeof KnowledgeBaseRepository>[0];

interface RawCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface PresentColumn {
  readonly t: string;
  readonly c: string;
}

/** Every candidate of D-28, with its group, as the plan's interfaces declare them. */
const CANDIDATES: readonly (readonly [string, string, keyof KnowledgeBaseUsage])[] = [
  ['tblpur_request', 'knowledge_base', 'purchaseRequests'],
  ['tblpur_orders', 'knowledge_base', 'purchaseOrders'],
  ['tblpur_estimates', 'knowledge_base', 'purchaseQuotations'],
  ['tblinv_shipping_charges', 'knowledge_base', 'shippingCharges'],
  ['tblexpenses', 'knowledge_base', 'expenses'],
  ['tblfe_asset_creation', 'knowledge_centre', 'assets'],
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
  return values.flatMap((v) => (isJoined(v) ? v.values : [v]));
}

interface StubOptions {
  readonly rows?: readonly unknown[];
  readonly counts?: readonly number[];
  readonly first?: unknown;
  readonly deleted?: number;
  readonly update?: () => Promise<unknown>;
  readonly columns?: readonly PresentColumn[] | Error;
  readonly raw?: Readonly<Record<string, unknown[] | Error>>;
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
    tblknowledge_base: {
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
  const repository = new KnowledgeBaseRepository({ client } as unknown as ClientHolder);
  return { repository, raw, calls };
}

function request(overrides: Partial<KnowledgeBaseListRequest> = {}): KnowledgeBaseListRequest {
  return { search: null, sortField: 'id', order: 'desc', cursor: null, limit: 25, ...overrides };
}

const usageStatements = (raw: readonly RawCall[]): RawCall[] =>
  raw.filter((call) => !call.sql.includes(PROBE));

describe('KnowledgeBaseRepository: the referencing columns discovered at runtime (D-28)', () => {
  it('D-28: a missing column counts 0 and raises no error; a present column is counted', async () => {
    const columns: PresentColumn[] = [{ t: 'tblpur_orders', c: 'knowledge_base' }];
    const { repository, raw } = stub({
      columns,
      raw: { tblpur_orders: [{ id: 7, n: 2n }], tblexpenses: [{ id: 7, n: 3n }] },
    });

    const before = await repository.usageByKnowledgeBase([7, 9]);
    expect(raw).toHaveLength(2);
    expect(raw[0]?.sql).toContain(PROBE);
    expect(readTable(raw[1]?.sql ?? '')).toBe('tblpur_orders');
    for (const call of raw) {
      expect(call.sql).not.toContain('tblexpenses');
    }
    expect(before.get(7)).toEqual({ ...NO_KNOWLEDGE_BASE_USAGE, purchaseOrders: 2 });
    expect(before.get(9)).toEqual(NO_KNOWLEDGE_BASE_USAGE);

    const afterColumns: PresentColumn[] = [
      { t: 'tblpur_orders', c: 'knowledge_base' },
      { t: 'tblexpenses', c: 'knowledge_base' },
    ];
    const { repository: repoAfter } = stub({
      columns: afterColumns,
      raw: { tblpur_orders: [{ id: 7, n: 2n }], tblexpenses: [{ id: 7, n: 3n }] },
    });
    const after = await repoAfter.usageByKnowledgeBase([7]);
    expect(after.get(7)).toEqual({
      ...NO_KNOWLEDGE_BASE_USAGE,
      purchaseOrders: 2,
      expenses: 3,
    });
  });

  it('the probe asks the connected schema for candidate tables and columns, and ignores the letter case of the answer', async () => {
    const { repository, raw } = stub({
      columns: [{ t: 'TBLPUR_ORDERS', c: 'KNOWLEDGE_BASE' }],
    });
    const found = await repository.presentReferences();

    expect(raw).toHaveLength(1);
    expect(raw[0]?.sql).toContain(PROBE);
    expect(found).toEqual(new Set(['tblpur_orders.knowledge_base']));
  });

  it('runs the probe once, then runs only the present statements in one Promise.all; no ids, no query', async () => {
    const { repository, raw } = stub({
      columns: [
        { t: 'tblpur_orders', c: 'knowledge_base' },
        { t: 'tblfe_asset_creation', c: 'knowledge_centre' },
      ],
      raw: { tblpur_orders: [], tblfe_asset_creation: [] },
    });

    expect(await repository.usageByKnowledgeBase([])).toEqual(new Map());
    expect(raw).toHaveLength(0);

    const usage = await repository.usageByKnowledgeBase([7, 9]);
    expect(raw).toHaveLength(3);
    expect(raw[0]?.sql).toContain(PROBE);
    expect(readTable(raw[1]?.sql ?? '')).toBe('tblpur_orders');
    expect(readTable(raw[2]?.sql ?? '')).toBe('tblfe_asset_creation');
    expect(usage.get(7)).toEqual(NO_KNOWLEDGE_BASE_USAGE);
    expect(usage.get(9)).toEqual(NO_KNOWLEDGE_BASE_USAGE);
  });

  it('assets matches by the exact NAME: binary cast on both sides, table literal text and ids bound', async () => {
    const { repository, raw } = stub({
      columns: [{ t: 'tblfe_asset_creation', c: 'knowledge_centre' }],
      raw: { tblfe_asset_creation: [{ id: 4, n: 3 }] },
    });
    const usage = await repository.usageByKnowledgeBase([4]);

    expect(raw).toHaveLength(2);
    const statement = usageStatements(raw)[0];
    expect(statement?.sql).toContain('FROM tblknowledge_base c JOIN tblfe_asset_creation r');
    expect(statement?.sql).toContain(
      'ON CAST(r.knowledge_centre AS BINARY) = CAST(c.name AS BINARY)',
    );
    expect(statement?.sql).toContain('WHERE c.id IN (?)');
    expect(statement?.values).toEqual([4]);
    expect(usage.get(4)).toEqual({ ...NO_KNOWLEDGE_BASE_USAGE, assets: 3 });
  });

  it('binds candidate names into the probe, and ids into each statement through Prisma.join (never literal text in the SQL)', async () => {
    const { repository, raw } = stub({ raw: { tblpur_request: [{ id: 7, n: 1 }] } });
    await repository.usageByKnowledgeBase([7, 9]);

    const probe = raw[0];
    expect(probe?.sql).toContain(PROBE);
    expect(probe?.values).toContain('tblpur_request');
    expect(probe?.values).toContain('knowledge_base');

    const statements = usageStatements(raw);
    expect(statements).toHaveLength(CANDIDATES.length);
    for (const call of statements) {
      expect(call.values).toEqual([7, 9]);
      expect(call.sql).not.toMatch(/[79]/);
    }
    const byId = statements.find((call) => readTable(call.sql) === 'tblpur_request');
    expect(byId?.sql).toBe(
      'SELECT r.knowledge_base AS id, COUNT(*) AS n FROM tblpur_request r WHERE r.knowledge_base IN (?) GROUP BY r.knowledge_base',
    );
  });

  it.each(CANDIDATES)('a count on %s.%s lands in the %s group', async (table, _column, group) => {
    const { repository } = stub({ raw: { [table]: [{ id: '3', n: 1n }] } });
    const usage = await repository.usageByKnowledgeBase([3]);
    expect(usage.get(3)).toEqual({ ...NO_KNOWLEDGE_BASE_USAGE, [group]: 1 });
  });

  it('declares exactly the six candidates, frozen, five by id and one by name', () => {
    expect(Object.isFrozen(KNOWLEDGE_BASE_REFERENCES)).toBe(true);
    expect(
      KNOWLEDGE_BASE_REFERENCES.map((reference) => [
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
    await expect(repository.usageByKnowledgeBase([7])).rejects.toThrow(
      'information_schema unavailable',
    );
  });

  it('fails closed: a rejecting statement rejects the call', async () => {
    const { repository } = stub({ raw: { tblpur_estimates: new Error('lock wait timeout') } });
    await expect(repository.usageByKnowledgeBase([7])).rejects.toThrow('lock wait timeout');
  });

  it('a malformed answer row or probe row is refused, never read as zero', async () => {
    const row = stub({ raw: { tblpur_orders: [{ id: 7 }] } });
    await expect(row.repository.usageByKnowledgeBase([7])).rejects.toThrow();
    const probe = stub({ columns: [{ t: 'tblpur_orders' } as unknown as PresentColumn] });
    await expect(probe.repository.presentReferences()).rejects.toThrow();
  });
});

describe('KnowledgeBaseRepository: the table delegate', () => {
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
          take: KNOWLEDGE_BASE_FACADE_MAX_ROWS + 1,
          select: COLUMNS,
        },
      },
    ]);
  });

  it('listAll refuses MAX + 1 rows loudly (ERP-INTERNAL-0001), never truncating', async () => {
    const rows = Array.from({ length: KNOWLEDGE_BASE_FACADE_MAX_ROWS + 1 }, (_, index) => ({
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
