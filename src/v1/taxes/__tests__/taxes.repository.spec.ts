/**
 * TaxesRepository over a stub client: what it asks the database, not what the database answers (the
 * int spec proves that against the local mirror). The stub records every delegate call and every
 * tagged `$queryRaw` (its SQL text with `?` for each hole, and its bound values), so these cases
 * prove the shapes the module depends on: the 20 usage statements of `TAX_REFERENCES` (one per
 * table, the table and column names in the SQL text, the ids only in the bound values, the
 * answers summed per group, any failure rejecting the whole answer), the `default_tax` read, the
 * facade's bounded `listAll`, P2025 as `null`, the rate sort on the `taxrate` column with a numeric
 * cursor key, and `q` over the name, the id and the rate.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import {
  TAXES_FACADE_MAX_ROWS,
  type TaxesListRequest,
  type TaxUsage,
} from '../model/taxes.model.js';
import { DEFAULT_TAX_OPTION, TaxesRepository } from '../repository/taxes.repository.js';

/** The repository's constructor parameter, named without importing the database layer. */
type ClientHolder = ConstructorParameters<typeof TaxesRepository>[0];

interface RawCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/** Every table `TAX_REFERENCES` reads, with its group: 20 statements. */
const REFERENCE_TABLES: readonly (readonly [string, keyof TaxUsage])[] = [
  ['tblitems', 'items'],
  ['tblexpenses', 'expenses'],
  ['tblsubscriptions', 'subscriptions'],
  ['tblitems_of_vendor', 'vendorItems'],
  ['tblpur_order_detail', 'purchaseLines'],
  ['tblpur_request_detail', 'purchaseLines'],
  ['tblpur_estimate_detail', 'purchaseLines'],
  ['tblpur_invoice_details', 'purchaseLines'],
  ['tblgoods_receipt_detail', 'warehouseLines'],
  ['tblgoods_delivery_detail', 'warehouseLines'],
  ['tblwh_order_return_details', 'warehouseLines'],
  ['tblwh_packing_list_details', 'warehouseLines'],
  ['tblfe_cart', 'fixedEquipmentLines'],
  ['tblfe_cart_detailt', 'fixedEquipmentLines'],
  ['tblfe_goods_delivery_detail', 'fixedEquipmentLines'],
  ['tblfe_goods_receipt_detail', 'fixedEquipmentLines'],
  ['tblfe_packing_list_details', 'fixedEquipmentLines'],
  ['tblsales_return_items', 'salesReturnLines'],
  ['tblacc_tax_mappings', 'accounting'],
  ['tblacc_account_history', 'accounting'],
];

/** The table a statement joins: the word after `JOIN`. */
function joined(sql: string): string {
  return /JOIN (\w+) r /.exec(sql)?.[1] ?? '';
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
  /** What `$queryRaw` answers per joined table; an `Error` rejects; absent answers `[]`. */
  readonly raw?: Readonly<Record<string, unknown>>;
  readonly rows?: readonly unknown[];
  readonly first?: unknown;
  readonly option?: unknown;
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
    tbltaxes: {
      findMany: record('findMany', () => Promise.resolve(options.rows ?? [])),
      count: record('count', () => Promise.resolve(counts.shift() ?? 0)),
      findFirst: record('findFirst', () => Promise.resolve(options.first ?? null)),
      create: record('create', () => Promise.resolve({ id: 9, name: 'VAT', taxrate: '5.56' })),
      update: record('update', options.update ?? (() => Promise.resolve(null))),
      deleteMany: record('deleteMany', () => Promise.resolve({ count: options.deleted ?? 1 })),
    },
    tbloptions: {
      findFirst: record('tbloptions.findFirst', () => Promise.resolve(options.option ?? null)),
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
      const sql = strings.join('?');
      raw.push({ sql, values: flatten(values) });
      const answer = options.raw?.[joined(sql)] ?? [];
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  const repository = new TaxesRepository({ client } as unknown as ClientHolder);
  return { repository, raw, calls };
}

function request(overrides: Partial<TaxesListRequest> = {}): TaxesListRequest {
  return { search: null, sortField: 'rate', order: 'asc', cursor: null, limit: 25, ...overrides };
}

describe('TaxesRepository: usageByTax (D-07, the 20 statements of TAX_REFERENCES)', () => {
  it('an empty id list issues no query at all', async () => {
    const { repository, raw, calls } = stub();
    expect((await repository.usageByTax([])).size).toBe(0);
    expect(raw).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('issues exactly one statement per referencing table, each table in the SQL text, the ids only in the values', async () => {
    const { repository, raw, calls } = stub();
    await repository.usageByTax([7, 9]);
    expect(calls).toEqual([]);
    expect(raw).toHaveLength(REFERENCE_TABLES.length);
    expect(raw.map((call) => joined(call.sql)).sort()).toEqual(
      REFERENCE_TABLES.map(([table]) => table).sort(),
    );
    for (const call of raw) {
      expect(call.values).toEqual([7, 9]);
      expect(call.sql).toMatch(/^SELECT t\.id AS tax, COUNT\(\*\) AS n FROM tbltaxes t JOIN /);
      expect(call.sql).toContain('WHERE t.id IN (?) GROUP BY t.id');
      expect(call.sql).not.toMatch(/[79]/);
      for (const value of call.values) expect(typeof value).toBe('number');
    }
  });

  it('a "|"-joined list column is matched with FIND_IN_SET; an id column with an equality', async () => {
    const { repository, raw } = stub();
    await repository.usageByTax([1]);
    const sqlOf = (table: string): string =>
      raw.find((call) => joined(call.sql) === table)?.sql ?? '';
    expect(sqlOf('tblpur_order_detail')).toContain(
      "FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax, '[|]', ',')) > 0",
    );
    expect(sqlOf('tblgoods_delivery_detail')).toContain('REGEXP_REPLACE(r.tax_id,');
    // fixed_equipment writes `tax` as '[]' and reads `tax_id` as the id list (Fixed_equipment_model.php:8788): both count.
    expect(sqlOf('tblfe_cart_detailt')).toContain(
      "FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax, '[|]', ',')) > 0 OR FIND_IN_SET(t.id, REGEXP_REPLACE(r.tax_id, '[|]', ',')) > 0",
    );
    expect(sqlOf('tblitems')).toContain('ON r.tax = t.id OR r.tax2 = t.id');
    expect(sqlOf('tblsubscriptions')).toContain('ON r.tax_id = t.id OR r.tax_id_2 = t.id');
    expect(sqlOf('tblacc_tax_mappings')).toContain('ON r.tax_id = t.id WHERE');
    expect(sqlOf('tblacc_account_history')).toContain('ON r.tax = t.id WHERE');
  });

  it("sums a group's tables per id and answers zeros for an unused id", async () => {
    const { repository } = stub({
      raw: {
        tblpur_order_detail: [{ tax: 7, n: 2n }],
        tblpur_invoice_details: [{ tax: '7', n: 2n }],
        tblexpenses: [{ tax: 9, n: 1 }],
        tblacc_tax_mappings: [{ tax: 7, n: 1n }],
        tblacc_account_history: [{ tax: 7, n: 3n }],
      },
    });
    const usage = await repository.usageByTax([7, 9]);
    expect(usage.get(7)).toEqual({
      items: 0,
      expenses: 0,
      subscriptions: 0,
      vendorItems: 0,
      purchaseLines: 4,
      warehouseLines: 0,
      fixedEquipmentLines: 0,
      salesReturnLines: 0,
      accounting: 4,
    });
    expect(usage.get(9)).toMatchObject({ expenses: 1, purchaseLines: 0, accounting: 0 });
  });

  it.each(REFERENCE_TABLES)('a count on %s lands in the %s group', async (table, group) => {
    const { repository } = stub({ raw: { [table]: [{ tax: 3, n: 1n }] } });
    const usage = await repository.usageByTax([3]);
    expect(usage.get(3)?.[group]).toBe(1);
  });

  it('fails closed: one rejecting statement rejects the whole answer', async () => {
    const { repository } = stub({ raw: { tblfe_cart: new Error('Unknown column tax_id') } });
    await expect(repository.usageByTax([7])).rejects.toThrow('Unknown column tax_id');
  });

  it('a malformed answer row is refused, never read as zero', async () => {
    const { repository } = stub({ raw: { tblitems: [{ tax: 7 }] } });
    await expect(repository.usageByTax([7])).rejects.toThrow();
  });
});

describe('TaxesRepository: the default_tax read (D-21) and the facade reads', () => {
  it("defaultTaxSetting answers '' when the option is absent and its value otherwise", async () => {
    const absent = stub();
    expect(await absent.repository.defaultTaxSetting()).toBe('');
    expect(absent.calls).toEqual([
      {
        method: 'tbloptions.findFirst',
        args: { where: { name: DEFAULT_TAX_OPTION }, select: { value: true } },
      },
    ]);
    expect(DEFAULT_TAX_OPTION).toBe('default_tax');
    const present = stub({ option: { value: 'VAT|5.00' } });
    expect(await present.repository.defaultTaxSetting()).toBe('VAT|5.00');
  });

  it('listAll reads the rate ascending then the id, at most MAX + 1 rows', async () => {
    const { repository, calls } = stub({ rows: [{ id: 1, name: 'VAT', taxrate: '5.00' }] });
    expect(await repository.listAll()).toEqual([{ id: 1, name: 'VAT', taxrate: '5.00' }]);
    expect(calls).toEqual([
      {
        method: 'findMany',
        args: {
          orderBy: [{ taxrate: 'asc' }, { id: 'asc' }],
          take: TAXES_FACADE_MAX_ROWS + 1,
          select: { id: true, name: true, taxrate: true },
        },
      },
    ]);
  });

  it('listAll refuses MAX + 1 rows loudly (ERP-INTERNAL-0001), never truncating', async () => {
    const rows = Array.from({ length: TAXES_FACADE_MAX_ROWS + 1 }, (_, index) => ({
      id: index + 1,
      name: `T${String(index)}`,
      taxrate: '1.00',
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
    const { repository, calls } = stub({ rows: [{ id: 9, name: 'GST', taxrate: '10.00' }] });
    expect(await repository.findByIds([9, 7])).toEqual([{ id: 9, name: 'GST', taxrate: '10.00' }]);
    expect(calls[0]?.args).toEqual({
      where: { id: { in: [9, 7] } },
      select: { id: true, name: true, taxrate: true },
    });
  });
});

describe('TaxesRepository: the table delegate', () => {
  it('reads a Prisma Decimal as its two-decimal text', async () => {
    const decimal = { toFixed: (places: number) => (5.5).toFixed(places) };
    const { repository } = stub({ first: { id: 1, name: 'VAT', taxrate: decimal } });
    expect(await repository.findById(1)).toEqual({ id: 1, name: 'VAT', taxrate: '5.50' });
    const negativeZero = stub({ first: { id: 2, name: 'Zero', taxrate: -0 } });
    expect(await negativeZero.repository.findById(2)).toEqual({
      id: 2,
      name: 'Zero',
      taxrate: '0.00',
    });
    const broken = stub({ first: { id: 3, name: 'Bad', taxrate: '5.5' } });
    await expect(broken.repository.findById(3)).rejects.toThrow();
  });

  it('update answers null on a Prisma P2025 and rethrows anything else', async () => {
    const missing = stub({
      update: () => Promise.reject(Object.assign(new Error('not found'), { code: 'P2025' })),
    });
    expect(await missing.repository.update(404, { name: 'Nobody' })).toBeNull();
    expect(missing.calls).toEqual([
      {
        method: 'update',
        args: {
          where: { id: 404 },
          data: { name: 'Nobody' },
          select: { id: true, name: true, taxrate: true },
        },
      },
    ]);
    const broken = stub({
      update: () => Promise.reject(Object.assign(new Error('deadlock'), { code: 'P2034' })),
    });
    await expect(broken.repository.update(1, { name: 'X' })).rejects.toThrow('deadlock');
    const written = stub({
      update: () => Promise.resolve({ id: 3, name: 'Echo', taxrate: '7.00' }),
    });
    expect(await written.repository.update(3, { taxrate: '7.00' })).toEqual({
      id: 3,
      name: 'Echo',
      taxrate: '7.00',
    });
  });

  it('create writes the name and the rounded rate; remove answers from deleteMany', async () => {
    const { repository, calls } = stub();
    expect(await repository.create({ name: 'VAT', taxrate: '5.56' })).toEqual({
      id: 9,
      name: 'VAT',
      taxrate: '5.56',
    });
    expect(calls[0]).toEqual({
      method: 'create',
      args: {
        data: { name: 'VAT', taxrate: '5.56' },
        select: { id: true, name: true, taxrate: true },
      },
    });
    expect(await stub({ deleted: 0 }).repository.remove(404)).toBe(false);
    expect(await stub({ deleted: 1 }).repository.remove(2)).toBe(true);
  });

  it("findOtherByName asks for another row's id by the exact name, the edited row excluded", async () => {
    const none = stub();
    expect(await none.repository.findOtherByName('VAT')).toBeNull();
    expect(none.calls[0]?.args).toEqual({ where: { name: 'VAT' }, select: { id: true } });
    const other = stub({ first: { id: 4 } });
    expect(await other.repository.findOtherByName('VAT', 2)).toBe(4);
    expect(other.calls[0]?.args).toEqual({
      where: { name: 'VAT', NOT: { id: 2 } },
      select: { id: true },
    });
  });

  it('list sorts the rate on taxrate with a NUMERIC cursor key; q matches the name, the id and the rate', async () => {
    const { repository, calls } = stub({
      rows: [
        { id: 4, name: 'Five', taxrate: '5.00' },
        { id: 2, name: 'Ten', taxrate: '10.00' },
      ],
      counts: [5, 2],
    });
    const cursor = { sort: 'rate' as const, key: [1, 1] as const, direction: 'after' as const };
    const page = await repository.list(request({ search: '5', cursor, limit: 2 }));
    const match = { OR: [{ name: { contains: '5' } }, { id: 5 }, { taxrate: '5.00' }] };
    expect(calls[0]).toEqual({
      method: 'findMany',
      args: {
        where: { AND: [match, { OR: [{ taxrate: { gt: 1 } }, { taxrate: 1, id: { gt: 1 } }] }] },
        orderBy: [{ taxrate: 'asc' }, { id: 'asc' }],
        take: 2,
        select: { id: true, name: true, taxrate: true },
      },
    });
    expect(calls[2]?.args).toEqual({
      where: { AND: [match, { OR: [{ taxrate: { lt: 5 } }, { taxrate: 5, id: { lt: 4 } }] }] },
    });
    expect(page.rangeStart).toBe(3);
    expect(page.nextCursor).not.toBeNull();
    expect(page.prevCursor).not.toBeNull();
  });

  it('q that is no number matches the name only; an id too long for INT is not an id', async () => {
    const { repository, calls } = stub();
    await repository.count(request({ search: 'vat' }));
    expect(calls[0]?.args).toEqual({ where: { OR: [{ name: { contains: 'vat' } }] } });
    const long = stub();
    await long.repository.count(request({ search: '99999999999' }));
    expect(long.calls[0]?.args).toEqual({
      where: { OR: [{ name: { contains: '99999999999' } }, { taxrate: '99999999999.00' }] },
    });
  });

  it('a before cursor reads reversed and answers in order; an empty page has no cursors', async () => {
    const { repository, calls } = stub({
      rows: [
        { id: 3, name: 'A', taxrate: '1.00' },
        { id: 5, name: 'B', taxrate: '2.00' },
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
    const empty = await stub().repository.list(request({ sortField: 'id' }));
    expect(empty).toEqual({
      items: [],
      nextCursor: null,
      prevCursor: null,
      total: 0,
      rangeStart: 0,
    });
  });
});
