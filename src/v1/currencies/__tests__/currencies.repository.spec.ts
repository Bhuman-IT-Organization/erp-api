/**
 * CurrenciesRepository over a stub client: what it asks the database, not what the database answers
 * (the int spec proves that against the local mirror). The stub records every delegate call and
 * every tagged `$queryRaw` (its SQL text with `?` for each hole, and its bound values), and answers
 * the `information_schema` probe from a settable list of present columns with their `DATA_TYPE`, so
 * these cases prove the shapes the module depends on: D-40's runtime discovery (a missing line runs
 * no statement and counts 0, a present one is counted, with no code change between the two), exact
 * matching (integers as numbers, ids as their decimal text, codes as the stored bytes), the exchange
 * rates never in a delete count, the probe's names only in the bound values, fail closed, the bounded
 * `listAll`, an update that writes the five columns, the base switch's two updates, P2025 as `null`,
 * and the keyset list.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import type { DbTransaction } from '../../../shared/db/transaction.js';
import {
  CURRENCIES_FACADE_MAX_ROWS,
  type CurrenciesListRequest,
  type NewCurrency,
} from '../model/currencies.model.js';
import {
  CURRENCY_REFERENCES,
  CurrenciesRepository,
  referenceKey,
} from '../repository/currencies.repository.js';
import {
  NO_CURRENCY_LOCK_USAGE,
  NO_CURRENCY_REFERENCES,
  NO_CURRENCY_USAGE,
} from '../service/currencies.transformer.js';

/** The repository's constructor parameter, named without importing the database layer. */
type ClientHolder = ConstructorParameters<typeof CurrenciesRepository>[0];

interface RawCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface PresentColumn {
  readonly t: string;
  readonly c: string;
  readonly d: string;
}

const PROBE = 'information_schema.COLUMNS';

/** Every register line present, an integer line as `int` and a text line as `varchar`. */
const ALL_PRESENT: readonly PresentColumn[] = CURRENCY_REFERENCES.map((reference) => ({
  t: reference.table,
  c: reference.column,
  d: reference.match === 'integerId' ? 'int' : 'varchar',
}));

/** The `table.column` a usage statement reads. */
function readKey(sql: string): string {
  const match = /^SELECT r\.(\w+) AS id, COUNT\(\*\) AS n FROM (\w+) r /.exec(sql);
  return match === null ? '' : `${match[2] ?? ''}.${match[1] ?? ''}`;
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

/** One stored row as the delegate answers it. */
function stored(id: number, name: string, isdefault = false) {
  return {
    id,
    name,
    symbol: '$',
    decimal_separator: '.',
    thousand_separator: ',',
    placement: 'before',
    isdefault,
  };
}

interface StubOptions {
  /** What the probe answers (a live array: a case may push to it between two calls). */
  readonly columns?: PresentColumn[] | Error;
  /** What a usage statement answers per `table.column`; an `Error` rejects; absent answers `[]`. */
  readonly raw?: Readonly<Record<string, unknown>>;
  readonly rows?: readonly unknown[];
  readonly first?: unknown;
  readonly update?: () => Promise<unknown>;
  /** What each `updateMany` answers, in order (default count 1). */
  readonly updated?: readonly number[];
  readonly deleted?: number;
  readonly counts?: readonly number[];
}

function stub(options: StubOptions = {}) {
  const raw: RawCall[] = [];
  const calls: { method: string; args: unknown }[] = [];
  const counts = [...(options.counts ?? [])];
  const updated = [...(options.updated ?? [])];
  const record =
    <T>(method: string, answer: () => Promise<T>) =>
    (args: unknown): Promise<T> => {
      calls.push({ method, args });
      return answer();
    };
  const delegate = {
    findMany: record('findMany', () => Promise.resolve(options.rows ?? [])),
    count: record('count', () => Promise.resolve(counts.shift() ?? 0)),
    findFirst: record('findFirst', () => Promise.resolve(options.first ?? null)),
    create: record('create', () => Promise.resolve(stored(9, 'GBP'))),
    update: record('update', options.update ?? (() => Promise.resolve(stored(2, 'EUR')))),
    updateMany: record('updateMany', () => Promise.resolve({ count: updated.shift() ?? 1 })),
    deleteMany: record('deleteMany', () => Promise.resolve({ count: options.deleted ?? 1 })),
  };
  const client = {
    tblcurrencies: delegate,
    $transaction: <T>(work: (tx: unknown) => Promise<T>): Promise<T> => {
      calls.push({ method: '$transaction', args: null });
      return work({ tblcurrencies: delegate });
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
      const sql = strings.join('?');
      raw.push({ sql, values: flatten(values) });
      if (sql.includes(PROBE)) {
        const columns = options.columns ?? ALL_PRESENT;
        return columns instanceof Error ? Promise.reject(columns) : Promise.resolve(columns);
      }
      const answer = options.raw?.[readKey(sql)] ?? [];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  const repository = new CurrenciesRepository({ client } as unknown as ClientHolder);
  return { repository, raw, calls, delegate };
}

function request(overrides: Partial<CurrenciesListRequest> = {}): CurrenciesListRequest {
  return { search: null, sortField: 'name', order: 'desc', cursor: null, limit: 25, ...overrides };
}

const usageStatements = (raw: readonly RawCall[]): RawCall[] =>
  raw.filter((call) => !call.sql.includes(PROBE));

/** The page the usage cases read: two currencies, ids 7 and 9, codes `USD` and `EUR`. */
const PAGE = [
  { id: 7, name: 'USD' },
  { id: 9, name: 'EUR' },
];

const NEW: NewCurrency = {
  name: 'GBP',
  symbol: 'GBP',
  decimalSeparator: '.',
  thousandSeparator: ',',
  placement: 'after',
};

describe('CurrenciesRepository: the register (D-40, discovered at runtime as D-28)', () => {
  it('usageByCurrency([]) issues nothing: no probe, no statement', async () => {
    const { repository, raw, calls } = stub();
    expect((await repository.usageByCurrency([])).size).toBe(0);
    expect(raw).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('D-40: a missing column counts 0 and raises no error; a present column is counted', async () => {
    const columns: PresentColumn[] = [{ t: 'tblpur_orders', c: 'currency', d: 'int' }];
    const { repository, raw } = stub({
      columns,
      raw: {
        'tblpur_orders.currency': [{ id: 7, n: 2n }],
        'tblinvoices.currency': [{ id: 7, n: 3n }],
      },
    });

    const before = await repository.usageByCurrency(PAGE);
    expect(raw).toHaveLength(2);
    expect(raw[0]?.sql).toContain(PROBE);
    expect(readKey(raw[1]?.sql ?? '')).toBe('tblpur_orders.currency');
    expect(before.get(7)).toEqual({
      usage: { ...NO_CURRENCY_USAGE, purchaseOrders: 2 },
      lockUsage: NO_CURRENCY_LOCK_USAGE,
    });
    expect(before.get(9)).toEqual(NO_CURRENCY_REFERENCES);

    // tblinvoices.currency appears: no code change here.
    columns.push({ t: 'tblinvoices', c: 'currency', d: 'int' });
    raw.length = 0;
    const after = await repository.usageByCurrency(PAGE);
    expect(usageStatements(raw).map((call) => readKey(call.sql))).toEqual([
      'tblinvoices.currency',
      'tblpur_orders.currency',
    ]);
    expect(after.get(7)?.usage).toEqual({ ...NO_CURRENCY_USAGE, invoices: 3, purchaseOrders: 2 });
    expect(after.get(9)).toEqual(NO_CURRENCY_REFERENCES);
  });

  it('D-40: matched exactly', async () => {
    const { repository, raw } = stub({
      columns: [
        { t: 'tblinvoices', c: 'currency', d: 'int' },
        { t: 'tblexpenses', c: 'currency', d: 'varchar' },
        { t: 'tblfe_locations', c: 'location_currency', d: 'varchar' },
      ],
      raw: {
        'tblinvoices.currency': [
          { id: 7, n: 2n },
          { id: 0, n: 5n },
          { id: 8, n: 5n },
          { id: 9n, n: 1 },
        ],
        'tblexpenses.currency': [
          { id: '7', n: 3n },
          { id: '07', n: 5n },
          { id: '7 ', n: 5n },
          { id: '8', n: 5n },
        ],
        'tblfe_locations.location_currency': [
          { id: '9', n: 4n },
          { id: ' 9', n: 5n },
          { id: 'EUR', n: 5n },
        ],
      },
    });
    const usage = await repository.usageByCurrency(PAGE);
    const statements = usageStatements(raw);
    const byKey = new Map(statements.map((call) => [readKey(call.sql), call]));

    expect(byKey.get('tblinvoices.currency')?.sql).toBe(
      'SELECT r.currency AS id, COUNT(*) AS n FROM tblinvoices r WHERE r.currency IN (?) GROUP BY r.currency',
    );
    expect(byKey.get('tblinvoices.currency')?.values).toEqual([7, 9]);

    expect(byKey.get('tblexpenses.currency')?.sql).toBe(
      'SELECT r.currency AS id, COUNT(*) AS n FROM tblexpenses r WHERE CAST(r.currency AS BINARY) IN (?) GROUP BY r.currency',
    );
    expect(byKey.get('tblexpenses.currency')?.values).toEqual(['7', '9']);

    expect(byKey.get('tblfe_locations.location_currency')?.sql).toContain(
      'WHERE CAST(r.location_currency AS BINARY) IN (?)',
    );
    expect(byKey.get('tblfe_locations.location_currency')?.values).toEqual(['7', '9']);

    expect(usage.get(7)?.usage).toEqual({ ...NO_CURRENCY_USAGE, invoices: 2, expenses: 3 });
    expect(usage.get(9)?.usage).toEqual({
      ...NO_CURRENCY_USAGE,
      invoices: 1,
      fixedEquipmentLocations: 4,
    });
    expect([...usage.keys()]).toEqual([7, 9]);
  });

  it('D-40: exchange rates are never counted for a delete', async () => {
    const { repository } = stub({
      raw: {
        'tblcurrency_rates.from_currency_id': [{ id: 7, n: 2n }],
        'tblcurrency_rates.to_currency_name': [{ id: 'USD', n: 1n }],
        'tblcurrency_rate_logs.to_currency_id': [{ id: 7, n: 4n }],
        'tblcurrency_rate_logs.from_currency_name': [{ id: 'USD', n: 3n }],
        'tblhrp_payslips.to_currency_name': [{ id: 'USD', n: 5n }],
      },
    });
    const counts = (await repository.usageByCurrency(PAGE)).get(7);
    expect(counts?.usage).toEqual(NO_CURRENCY_USAGE);
    expect(counts?.lockUsage).toEqual({ exchangeRates: 3, exchangeRateLogs: 7, payslipCodes: 5 });
  });

  it('D-42: codes are compared as exact text', async () => {
    const { repository, raw } = stub({
      raw: {
        'tblcurrency_rates.from_currency_name': [
          { id: 'USD', n: 2n },
          { id: 'usd', n: 5n },
          { id: 'USD ', n: 5n },
          { id: '7', n: 5n },
        ],
      },
    });
    const counts = await repository.usageByCurrency(PAGE);
    const call = usageStatements(raw).find(
      (statement) => readKey(statement.sql) === 'tblcurrency_rates.from_currency_name',
    );
    expect(call?.sql).toBe(
      'SELECT r.from_currency_name AS id, COUNT(*) AS n FROM tblcurrency_rates r WHERE CAST(r.from_currency_name AS BINARY) IN (?) GROUP BY r.from_currency_name',
    );
    expect(call?.values).toEqual(['USD', 'EUR']);
    expect(counts.get(7)?.lockUsage).toEqual({ ...NO_CURRENCY_LOCK_USAGE, exchangeRates: 2 });
    expect(counts.get(9)?.lockUsage).toEqual(NO_CURRENCY_LOCK_USAGE);
  });

  it('a code two page rows share counts for both', async () => {
    const { repository, raw } = stub({
      raw: { 'tblhrp_payslips.from_currency_name': [{ id: 'EUR', n: 2n }] },
    });
    const counts = await repository.usageByCurrency([
      { id: 2, name: 'EUR' },
      { id: 3, name: 'EUR' },
    ]);
    const call = usageStatements(raw).find(
      (statement) => readKey(statement.sql) === 'tblhrp_payslips.from_currency_name',
    );
    expect(call?.values).toEqual(['EUR']);
    expect(counts.get(2)?.lockUsage.payslipCodes).toBe(2);
    expect(counts.get(3)?.lockUsage.payslipCodes).toBe(2);
  });

  it.each(CURRENCY_REFERENCES.filter((reference) => reference.match !== 'codeAsText'))(
    'a count on $table.$column lands in the $group group',
    async (reference) => {
      const answer = reference.match === 'integerId' ? [{ id: 3, n: 1n }] : [{ id: '3', n: 1n }];
      const { repository } = stub({ raw: { [referenceKey(reference)]: answer } });
      const counts = (await repository.usageByCurrency([{ id: 3, name: 'AED' }])).get(3);
      const half = reference.countsForDelete ? counts?.usage : counts?.lockUsage;
      expect(half).toMatchObject({ [reference.group]: 1 });
    },
  );

  it('one statement per present line, every one in the same read', async () => {
    const { repository, raw } = stub();
    await repository.usageByCurrency(PAGE);
    expect(raw).toHaveLength(1 + CURRENCY_REFERENCES.length);
    expect(usageStatements(raw).map((call) => readKey(call.sql))).toEqual(
      CURRENCY_REFERENCES.map(referenceKey),
    );
  });

  it('the probe binds every register table and column name: none is SQL text', async () => {
    const { repository, raw } = stub();
    const present = await repository.presentReferences();
    expect([...present.keys()]).toEqual(CURRENCY_REFERENCES.map(referenceKey));
    expect(present.get('tblinvoices.currency')).toBe('int');
    expect(raw).toHaveLength(1);
    const [probe] = raw;
    expect(probe?.sql).toBe(
      'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?) AND COLUMN_NAME IN (?)',
    );
    for (const reference of CURRENCY_REFERENCES) {
      expect(probe?.values).toContain(reference.table);
      expect(probe?.values).toContain(reference.column);
      expect(probe?.sql).not.toContain(reference.table);
    }
  });

  it('the probe matches a line exactly, in any letter case, and only a declared pair', async () => {
    const { repository } = stub({
      columns: [
        { t: 'TBLINVOICES', c: 'CURRENCY', d: 'INT' },
        { t: 'tblinvoices', c: 'default_currency', d: 'int' },
        { t: 'tblclients', c: 'currency', d: 'int' },
      ],
    });
    expect([...(await repository.presentReferences())]).toEqual([['tblinvoices.currency', 'int']]);
  });

  it('fails closed: a rejecting probe rejects the call', async () => {
    const { repository } = stub({ columns: new Error('information_schema unavailable') });
    await expect(repository.usageByCurrency(PAGE)).rejects.toThrow(
      'information_schema unavailable',
    );
  });

  it('fails closed: a rejecting statement rejects the call', async () => {
    const { repository } = stub({ raw: { 'tblfe_cart.currency': new Error('lock wait timeout') } });
    await expect(repository.usageByCurrency(PAGE)).rejects.toThrow('lock wait timeout');
  });

  it('a malformed answer row or probe row is refused, never read as zero', async () => {
    const row = stub({ raw: { 'tblinvoices.currency': [{ id: 7 }] } });
    await expect(row.repository.usageByCurrency(PAGE)).rejects.toThrow();
    const probe = stub({ columns: [{ t: 'tblinvoices', c: 'currency' } as PresentColumn] });
    await expect(probe.repository.presentReferences()).rejects.toThrow();
  });
});

describe('CurrenciesRepository: tblcurrencies through the typed delegate', () => {
  it('listAll reads the id ascending and refuses MAX + 1 rows, never truncating', async () => {
    const rows = Array.from({ length: CURRENCIES_FACADE_MAX_ROWS + 1 }, (_, index) =>
      stored(index + 1, 'USD'),
    );
    const { repository, calls } = stub({ rows });
    await expect(repository.listAll()).rejects.toBeInstanceOf(AppError);
    expect(calls[0]?.args).toMatchObject({
      orderBy: { id: 'asc' },
      take: CURRENCIES_FACADE_MAX_ROWS + 1,
    });
    const ok = stub({ rows: rows.slice(0, 2) });
    expect((await ok.repository.listAll()).map((row) => row.id)).toEqual([1, 2]);
  });

  it('findBase reads the first isdefault row by id', async () => {
    const { repository, calls } = stub({ first: stored(1, 'USD', true) });
    expect((await repository.findBase())?.isBase).toBe(true);
    expect(calls[0]?.args).toMatchObject({ where: { isdefault: true }, orderBy: { id: 'asc' } });
    expect(await stub().repository.findBase()).toBeNull();
  });

  it('create sends the five columns and never isdefault', async () => {
    const { repository, calls } = stub();
    await repository.create(NEW);
    expect((calls[0]?.args as { data: unknown }).data).toEqual({
      name: 'GBP',
      symbol: 'GBP',
      decimal_separator: '.',
      thousand_separator: ',',
      placement: 'after',
    });
  });

  it('update sends the five columns and answers null on P2025', async () => {
    const { repository, calls } = stub();
    expect((await repository.update(2, NEW))?.id).toBe(2);
    expect(calls[0]?.args).toMatchObject({
      where: { id: 2 },
      data: {
        name: 'GBP',
        symbol: 'GBP',
        decimal_separator: '.',
        thousand_separator: ',',
        placement: 'after',
      },
    });
    const missing = stub({
      update: () => Promise.reject(Object.assign(new Error('not found'), { code: 'P2025' })),
    });
    expect(await missing.repository.update(2, NEW)).toBeNull();
    const other = stub({ update: () => Promise.reject(new Error('deadlock')) });
    await expect(other.repository.update(2, NEW)).rejects.toThrow('deadlock');
  });

  it('setBaseIn sets isdefault on the id, then clears every other row', async () => {
    const { repository, calls, delegate } = stub();
    const tx = { tblcurrencies: delegate } as unknown as DbTransaction;
    expect(await repository.setBaseIn(tx, 4)).toBe(true);
    expect(calls.map((call) => [call.method, call.args])).toEqual([
      ['updateMany', { where: { id: 4 }, data: { isdefault: true } }],
      ['updateMany', { where: { id: { not: 4 } }, data: { isdefault: false } }],
    ]);
  });

  it('setBaseIn runs nothing more when no row matched the id', async () => {
    const { repository, calls, delegate } = stub({ updated: [0] });
    const tx = { tblcurrencies: delegate } as unknown as DbTransaction;
    expect(await repository.setBaseIn(tx, 99)).toBe(false);
    expect(calls).toHaveLength(1);
  });

  it('setBase runs the switch inside one $transaction', async () => {
    const { repository, calls } = stub();
    expect(await repository.setBase(4)).toBe(true);
    expect(calls.map((call) => call.method)).toEqual(['$transaction', 'updateMany', 'updateMany']);
  });

  it('remove answers whether a row was deleted', async () => {
    expect(await stub().repository.remove(2)).toBe(true);
    expect(await stub({ deleted: 0 }).repository.remove(2)).toBe(false);
  });

  it('list: the code descending by default, the id breaking ties, q over the code, the symbol and an id', async () => {
    const { repository, calls } = stub({ rows: [stored(1, 'USD')], counts: [1] });
    const page = await repository.list(request({ search: '12' }));
    expect(page.total).toBe(1);
    expect(page.rangeStart).toBe(1);
    expect(calls[0]?.args).toMatchObject({
      where: {
        OR: [{ name: { contains: '12' } }, { symbol: { contains: '12' } }, { id: 12 }],
      },
      orderBy: [{ name: 'desc' }, { id: 'desc' }],
      take: 25,
    });
    const large = stub();
    await large.repository.list(request({ search: '99999999999' }));
    expect((large.calls[0]?.args as { where: { OR: unknown[] } }).where.OR).toHaveLength(2);
  });

  it('count uses the list match without a cursor', async () => {
    const { repository, calls } = stub({ counts: [3] });
    expect(await repository.count(request({ search: 'US' }))).toBe(3);
    expect(calls[0]?.args).toEqual({
      where: { OR: [{ name: { contains: 'US' } }, { symbol: { contains: 'US' } }] },
    });
  });

  it('findById parses the stored row', async () => {
    const { repository } = stub({ first: stored(4, 'AED') });
    expect(await repository.findById(4)).toEqual({
      id: 4,
      name: 'AED',
      symbol: '$',
      decimalSeparator: '.',
      thousandSeparator: ',',
      placement: 'before',
      isBase: false,
    });
    expect(await stub().repository.findById(4)).toBeNull();
  });
});
