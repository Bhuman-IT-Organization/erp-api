/**
 * PaymentModesRepository over a stub client: what it asks the database, not what the database
 * answers (the int spec proves that against the local mirror). The stub records every delegate call
 * and every tagged `$queryRaw` (its SQL text with `?` for each hole, and its bound values), and
 * answers the `information_schema` probe from a settable list of present columns, so these cases
 * prove the shapes the module depends on: D-33's runtime discovery (a missing candidate runs no
 * statement and counts 0, a present one is counted, with no code change between the two), the exact
 * text comparison with the ids bound as decimal text, the configuration columns never named, the
 * probe's names only in the bound values, fail closed, the facade's bounded `listAll`, an update
 * that writes all seven columns, the switch that writes `active` only, P2025 as `null`, and the
 * keyset list (the boolean `active` sort included).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import {
  PAYMENT_MODES_FACADE_MAX_ROWS,
  type NewPaymentMode,
  type PaymentModesListRequest,
  type PaymentModeUsage,
} from '../model/payment-modes.model.js';
import {
  PAYMENT_MODE_REFERENCES,
  PaymentModesRepository,
} from '../repository/payment-modes.repository.js';
import { NO_PAYMENT_MODE_USAGE } from '../service/payment-modes.transformer.js';

/** The repository's constructor parameter, named without importing the database layer. */
type ClientHolder = ConstructorParameters<typeof PaymentModesRepository>[0];

interface RawCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

interface PresentColumn {
  readonly t: string;
  readonly c: string;
}

/** Every candidate of D-33, with its group, as the plan's interfaces declare them. */
const CANDIDATES: readonly (readonly [string, string, keyof PaymentModeUsage])[] = [
  ['tblinvoicepaymentrecords', 'paymentmode', 'invoicePayments'],
  ['tblexpenses', 'paymentmode', 'expenses'],
  ['tblcreditnote_refunds', 'payment_mode', 'creditNoteRefunds'],
  ['tblpur_invoice_payment', 'paymentmode', 'purchaseInvoicePayments'],
  ['tblpur_order_payment', 'paymentmode', 'purchaseOrderPayments'],
  ['tblpur_debits_refunds', 'payment_mode', 'debitNoteRefunds'],
  ['tblfe_refunds', 'payment_mode', 'fixedEquipmentRefunds'],
  ['tblwh_order_returns_refunds', 'payment_mode', 'orderReturnRefunds'],
];

/** The configuration of D-33: Perfex allows deleting a mapped or allowed mode, so never counted. */
const CONFIGURATION = [
  'tblacc_payment_mode_mappings',
  'tblacc_expense_category_mapping_details',
  'allowed_payment_modes',
];

const ALL_PRESENT: readonly PresentColumn[] = CANDIDATES.map(([t, c]) => ({ t, c }));

const PROBE = 'information_schema.COLUMNS';

/** The table a usage statement reads: the word after `FROM`. */
function readTable(sql: string): string {
  return /FROM (\w+) r /.exec(sql)?.[1] ?? '';
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

/** One stored row as the delegate answers it (the seven columns and the id). */
function stored(id: number, name: string, active = true) {
  return {
    id,
    name,
    description: null,
    active,
    show_on_pdf: 0,
    selected_by_default: 0,
    invoices_only: 0,
    expenses_only: 0,
  };
}

interface StubOptions {
  /** What the probe answers (a live array: a case may push to it between two calls). */
  readonly columns?: PresentColumn[] | Error;
  /** What a usage statement answers per table; an `Error` rejects; absent answers `[]`. */
  readonly raw?: Readonly<Record<string, unknown>>;
  readonly rows?: readonly unknown[];
  readonly first?: unknown;
  readonly update?: () => Promise<unknown>;
  readonly updated?: number;
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
    tblpayment_modes: {
      findMany: record('findMany', () => Promise.resolve(options.rows ?? [])),
      count: record('count', () => Promise.resolve(counts.shift() ?? 0)),
      findFirst: record('findFirst', () => Promise.resolve(options.first ?? null)),
      create: record('create', () =>
        Promise.resolve({
          ...stored(9, 'Card'),
          description: 'a<br />\nb',
          show_on_pdf: 1,
          expenses_only: 1,
        }),
      ),
      update: record('update', options.update ?? (() => Promise.resolve(null))),
      updateMany: record('updateMany', () => Promise.resolve({ count: options.updated ?? 1 })),
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
  const repository = new PaymentModesRepository({ client } as unknown as ClientHolder);
  return { repository, raw, calls };
}

function request(overrides: Partial<PaymentModesListRequest> = {}): PaymentModesListRequest {
  return { search: null, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const usageStatements = (raw: readonly RawCall[]): RawCall[] =>
  raw.filter((call) => !call.sql.includes(PROBE));

const NEW: NewPaymentMode = {
  name: 'Card',
  description: 'a<br />\nb',
  active: false,
  showOnPdf: 1,
  selectedByDefault: 0,
  invoicesOnly: 0,
  expensesOnly: 1,
};

const COLUMNS = {
  id: true,
  name: true,
  description: true,
  active: true,
  show_on_pdf: true,
  selected_by_default: true,
  invoices_only: true,
  expenses_only: true,
};

describe('PaymentModesRepository: the referencing columns (D-33, discovered at runtime as D-28)', () => {
  it('D-33: a missing column counts 0 and raises no error; a present column is counted', async () => {
    const columns: PresentColumn[] = [{ t: 'tblpur_invoice_payment', c: 'paymentmode' }];
    const { repository, raw } = stub({
      columns,
      raw: {
        tblpur_invoice_payment: [{ id: '7', n: 2n }],
        tblexpenses: [{ id: '7', n: 3n }],
      },
    });

    const before = await repository.usageByPaymentMode([7, 9]);
    expect(raw).toHaveLength(2);
    expect(raw[0]?.sql).toContain(PROBE);
    expect(readTable(raw[1]?.sql ?? '')).toBe('tblpur_invoice_payment');
    for (const call of raw) {
      for (const [table] of CANDIDATES.filter(([t]) => t !== 'tblpur_invoice_payment')) {
        expect(call.sql).not.toContain(`${table} `);
      }
    }
    expect(before.get(7)).toEqual({ ...NO_PAYMENT_MODE_USAGE, purchaseInvoicePayments: 2 });
    expect(before.get(9)).toEqual(NO_PAYMENT_MODE_USAGE);

    // tblexpenses.paymentmode appears (a slice adds it, or the schema has it): no code change here.
    columns.push({ t: 'tblexpenses', c: 'paymentmode' });
    raw.length = 0;
    const after = await repository.usageByPaymentMode([7, 9]);
    expect(usageStatements(raw).map((call) => readTable(call.sql))).toEqual([
      'tblexpenses',
      'tblpur_invoice_payment',
    ]);
    expect(after.get(7)).toEqual({
      ...NO_PAYMENT_MODE_USAGE,
      purchaseInvoicePayments: 2,
      expenses: 3,
    });
    expect(after.get(9)).toEqual(NO_PAYMENT_MODE_USAGE);
  });

  it('D-33: compared as exact text', async () => {
    const answer = [
      { id: '7', n: 2n },
      { id: '07', n: 5n },
      { id: '7 ', n: 5n },
      { id: ' 7', n: 5n },
      { id: 'stripe', n: 5n },
      { id: '8', n: 5n },
      { id: '9', n: 1 },
    ];
    const { repository, raw } = stub({
      raw: Object.fromEntries(CANDIDATES.map(([table]) => [table, answer])),
    });
    const usage = await repository.usageByPaymentMode([7, 9]);
    const statements = usageStatements(raw);
    expect(statements).toHaveLength(CANDIDATES.length);
    for (const [table, column] of CANDIDATES) {
      const call = statements.find((statement) => readTable(statement.sql) === table);
      expect(call?.sql).toBe(
        `SELECT r.${column} AS id, COUNT(*) AS n FROM ${table} r WHERE CAST(r.${column} AS BINARY) IN (?) GROUP BY r.${column}`,
      );
      expect(call?.values).toEqual(['7', '9']);
      for (const value of call?.values ?? []) expect(typeof value).toBe('string');
    }
    const counted = Object.fromEntries(CANDIDATES.map(([, , group]) => [group, 2]));
    expect(usage.get(7)).toEqual(counted);
    expect(usage.get(9)).toEqual(Object.fromEntries(CANDIDATES.map(([, , group]) => [group, 1])));
    expect([...usage.keys()]).toEqual([7, 9]);
  });

  it('D-33: configuration is never counted', async () => {
    const { repository, raw } = stub();
    await repository.usageByPaymentMode([7]);
    expect(raw.length).toBe(1 + CANDIDATES.length);
    for (const call of raw) {
      for (const name of CONFIGURATION) {
        expect(call.sql).not.toContain(name);
        expect(call.values).not.toContain(name);
      }
    }
    for (const reference of PAYMENT_MODE_REFERENCES) {
      expect(
        CONFIGURATION.some((name) => reference.table === name || reference.column === name),
      ).toBe(false);
    }
  });

  it('an empty id list issues nothing: no probe, no statement', async () => {
    const { repository, raw, calls } = stub();
    expect((await repository.usageByPaymentMode([])).size).toBe(0);
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
        { t: 'TBLEXPENSES', c: 'PAYMENTMODE' },
        { t: 'tblexpenses', c: 'payment_mode' },
        { t: 'tblfe_refunds', c: 'paymentmode' },
      ],
    });
    expect([...(await repository.presentReferences())]).toEqual(['tblexpenses.paymentmode']);
  });

  it.each(CANDIDATES)('a count on %s.%s lands in the %s group', async (table, _column, group) => {
    const { repository } = stub({ raw: { [table]: [{ id: '3', n: 1n }] } });
    const usage = await repository.usageByPaymentMode([3]);
    expect(usage.get(3)).toEqual({ ...NO_PAYMENT_MODE_USAGE, [group]: 1 });
  });

  it('declares exactly the eight candidates of plan 04.1-22, frozen', () => {
    expect(Object.isFrozen(PAYMENT_MODE_REFERENCES)).toBe(true);
    expect(
      PAYMENT_MODE_REFERENCES.map((reference) => [
        reference.table,
        reference.column,
        reference.group,
      ]),
    ).toEqual(CANDIDATES.map(([table, column, group]) => [table, column, group]));
  });

  it('fails closed: a rejecting probe rejects the call', async () => {
    const { repository } = stub({ columns: new Error('information_schema unavailable') });
    await expect(repository.usageByPaymentMode([7])).rejects.toThrow(
      'information_schema unavailable',
    );
  });

  it('fails closed: a rejecting statement rejects the call', async () => {
    const { repository } = stub({ raw: { tblfe_refunds: new Error('lock wait timeout') } });
    await expect(repository.usageByPaymentMode([7])).rejects.toThrow('lock wait timeout');
  });

  it('a malformed answer row or probe row is refused, never read as zero', async () => {
    const row = stub({ raw: { tblexpenses: [{ id: '7' }] } });
    await expect(row.repository.usageByPaymentMode([7])).rejects.toThrow();
    const probe = stub({ columns: [{ t: 'tblexpenses' } as unknown as PresentColumn] });
    await expect(probe.repository.presentReferences()).rejects.toThrow();
  });
});

describe('PaymentModesRepository: the table delegate', () => {
  it('create writes the seven columns and maps the stored row', async () => {
    const { repository, calls } = stub();
    expect(await repository.create(NEW)).toEqual({
      id: 9,
      name: 'Card',
      description: 'a<br />\nb',
      active: true,
      showOnPdf: 1,
      selectedByDefault: 0,
      invoicesOnly: 0,
      expensesOnly: 1,
    });
    expect(calls[0]).toEqual({
      method: 'create',
      args: {
        data: {
          name: 'Card',
          description: 'a<br />\nb',
          active: false,
          show_on_pdf: 1,
          selected_by_default: 0,
          invoices_only: 0,
          expenses_only: 1,
        },
        select: COLUMNS,
      },
    });
  });

  it('update sends the seven columns and answers null on a Prisma P2025; anything else rethrows', async () => {
    const missing = stub({
      update: () => Promise.reject(Object.assign(new Error('not found'), { code: 'P2025' })),
    });
    expect(await missing.repository.update(404, NEW)).toBeNull();
    expect(missing.calls).toEqual([
      {
        method: 'update',
        args: {
          where: { id: 404 },
          data: {
            name: 'Card',
            description: 'a<br />\nb',
            active: false,
            show_on_pdf: 1,
            selected_by_default: 0,
            invoices_only: 0,
            expenses_only: 1,
          },
          select: COLUMNS,
        },
      },
    ]);
    const written = stub({ update: () => Promise.resolve(stored(3, 'Renamed', false)) });
    expect(await written.repository.update(3, { ...NEW, id: 99 } as NewPaymentMode)).toMatchObject({
      id: 3,
      name: 'Renamed',
      active: false,
    });
    expect(Object.keys((written.calls[0]?.args as { data: object }).data).sort()).toEqual(
      [
        'active',
        'description',
        'expenses_only',
        'invoices_only',
        'name',
        'selected_by_default',
        'show_on_pdf',
      ].sort(),
    );
    const broken = stub({
      update: () => Promise.reject(Object.assign(new Error('deadlock'), { code: 'P2034' })),
    });
    await expect(broken.repository.update(1, NEW)).rejects.toThrow('deadlock');
  });

  it('setActive sends only active through updateMany and answers whether a row matched', async () => {
    const { repository, calls } = stub({ updated: 1 });
    expect(await repository.setActive(7, false)).toBe(true);
    expect(calls).toEqual([
      { method: 'updateMany', args: { where: { id: 7 }, data: { active: false } } },
    ]);
    expect(await stub({ updated: 0 }).repository.setActive(404, true)).toBe(false);
  });

  it('findById reads the eight columns; remove answers from deleteMany', async () => {
    const { repository, calls } = stub({ first: { ...stored(2, 'Cash'), show_on_pdf: 2 } });
    expect(await repository.findById(2)).toEqual({
      id: 2,
      name: 'Cash',
      description: null,
      active: true,
      showOnPdf: 2,
      selectedByDefault: 0,
      invoicesOnly: 0,
      expensesOnly: 0,
    });
    expect(calls[0]?.args).toEqual({ where: { id: 2 }, select: COLUMNS });
    expect(await stub().repository.findById(3)).toBeNull();
    expect(await stub({ deleted: 0 }).repository.remove(404)).toBe(false);
    expect(await stub({ deleted: 1 }).repository.remove(2)).toBe(true);
  });

  it('listAll reads the name ascending then the id, at most MAX + 1 rows', async () => {
    const { repository, calls } = stub({ rows: [stored(1, 'A')] });
    expect(await repository.listAll()).toHaveLength(1);
    expect(calls).toEqual([
      {
        method: 'findMany',
        args: {
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: PAYMENT_MODES_FACADE_MAX_ROWS + 1,
          select: COLUMNS,
        },
      },
    ]);
  });

  it('listAll refuses MAX + 1 rows loudly (ERP-INTERNAL-0001), never truncating', async () => {
    const rows = Array.from({ length: PAYMENT_MODES_FACADE_MAX_ROWS + 1 }, (_, index) =>
      stored(index + 1, `M${String(index)}`),
    );
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
    const { repository, calls } = stub({ rows: [stored(9, 'Cash')] });
    expect((await repository.findByIds([9, 7])).map((row) => row.id)).toEqual([9]);
    expect(calls[0]?.args).toEqual({ where: { id: { in: [9, 7] } }, select: COLUMNS });
  });

  it('list pages on (name, id) ascending by default; q matches the name, the description and an all-digit id', async () => {
    const { repository, calls } = stub({
      rows: [stored(5, 'Five'), stored(4, 'Four')],
      counts: [5, 2],
    });
    const cursor = { sort: 'name' as const, key: ['E', 6] as const, direction: 'after' as const };
    const page = await repository.list(request({ search: '5', cursor, limit: 2 }));
    const match = {
      OR: [{ name: { contains: '5' } }, { description: { contains: '5' } }, { id: 5 }],
    };
    expect(calls[0]).toEqual({
      method: 'findMany',
      args: {
        where: {
          AND: [match, { OR: [{ name: { gt: 'E' } }, { name: 'E', id: { gt: 6 } }] }],
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 2,
        select: COLUMNS,
      },
    });
    expect(page.rangeStart).toBe(3);
    expect(page.nextCursor).not.toBeNull();
    expect(page.prevCursor).not.toBeNull();
  });

  it('q that is no number matches the name and description only; an id beyond INT is not an id', async () => {
    const { repository, calls } = stub();
    await repository.count(request({ search: 'bank' }));
    expect(calls[0]?.args).toEqual({
      where: { OR: [{ name: { contains: 'bank' } }, { description: { contains: 'bank' } }] },
    });
    const fits = stub();
    await fits.repository.count(request({ search: '2147483647' }));
    expect(fits.calls[0]?.args).toEqual({
      where: {
        OR: [
          { name: { contains: '2147483647' } },
          { description: { contains: '2147483647' } },
          { id: 2_147_483_647 },
        ],
      },
    });
    const long = stub();
    await long.repository.count(request({ search: '2147483648' }));
    expect(long.calls[0]?.args).toEqual({
      where: {
        OR: [{ name: { contains: '2147483648' } }, { description: { contains: '2147483648' } }],
      },
    });
  });

  it('the active sort pages with equality on the boolean (Prisma has no gt or lt on a Boolean)', async () => {
    const after = stub({ rows: [stored(5, 'Five', true)], counts: [3, 1] });
    await after.repository.list(
      request({
        sortField: 'active',
        cursor: { sort: 'active', key: [false, 4], direction: 'after' },
      }),
    );
    expect(after.calls[0]?.args).toMatchObject({
      where: { AND: [{}, { OR: [{ active: true }, { active: false, id: { gt: 4 } }] }] },
      orderBy: [{ active: 'asc' }, { id: 'asc' }],
    });
    const top = stub({ rows: [stored(6, 'Six', true)], counts: [3, 2] });
    await top.repository.list(
      request({
        sortField: 'active',
        cursor: { sort: 'active', key: [true, 4], direction: 'after' },
      }),
    );
    expect(top.calls[0]?.args).toMatchObject({
      where: { AND: [{}, { OR: [{ active: true, id: { gt: 4 } }] }] },
    });
    const down = stub({ rows: [stored(2, 'Two', false)], counts: [3, 2] });
    await down.repository.list(
      request({
        sortField: 'active',
        order: 'desc',
        cursor: { sort: 'active', key: [true, 4], direction: 'after' },
      }),
    );
    expect(down.calls[0]?.args).toMatchObject({
      where: { AND: [{}, { OR: [{ active: false }, { active: true, id: { lt: 4 } }] }] },
      orderBy: [{ active: 'desc' }, { id: 'desc' }],
    });
  });

  it('a before cursor reads reversed and answers in order; an empty page has no cursors', async () => {
    const { repository, calls } = stub({
      rows: [stored(3, 'A'), stored(5, 'B')],
      counts: [4, 1],
    });
    const page = await repository.list(
      request({
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
