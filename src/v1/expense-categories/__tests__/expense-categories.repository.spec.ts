/**
 * ExpenseCategoriesRepository over a stub client: what it asks the database, not what the database
 * answers (the int spec proves that against the local mirror). The stub records every delegate call
 * and every tagged `$queryRaw` (its SQL text with `?` for each hole, and its bound values), so these
 * cases can prove the shapes the table depends on: the keyset `where` and `orderBy`, the search over
 * the name or the description, P2025 as `null`, `deleteMany`'s count as the delete's answer, and the
 * three usage reads of D-07 and D-15. The petty-cash table is ABSENT from the local copy, so its
 * PRESENT path is proven only here: the presence probe binds the table name as a value, the grouped
 * count binds the page's ids, a bigint count becomes a number per id, and an error from either
 * query rejects the whole answer (an unknown count never lets a delete through).
 */
import { describe, expect, it } from 'vitest';
import type { ExpenseCategoriesListRequest } from '../model/expense-categories.model.js';
import {
  EXPENSE_CATEGORIES_PETTY_CASH_TABLE,
  ExpenseCategoriesRepository,
} from '../repository/expense-categories.repository.js';

/** The repository's constructor parameter, named without importing the database layer. */
type ClientHolder = ConstructorParameters<typeof ExpenseCategoriesRepository>[0];

interface RawCall {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/** A bound `Prisma.join(...)` arrives as one value holding its own `values`. */
function isJoined(value: unknown): value is { values: unknown[] } {
  return (
    typeof value === 'object' && value !== null && 'values' in value && Array.isArray(value.values)
  );
}

/** Every bound value, a joined list spread into its members. */
function flatten(values: readonly unknown[]): unknown[] {
  return values.flatMap((value) => (isJoined(value) ? value.values : [value]));
}

interface StubOptions {
  /** Answers of `$queryRaw`, in call order; an `Error` is thrown instead of answered. */
  readonly raw?: readonly unknown[];
  readonly expenses?: readonly { category: number; _count: { id: number } }[];
  readonly mappings?: readonly { category_id: number; _count: { id: number } }[];
  readonly update?: () => Promise<unknown>;
  readonly deleted?: number;
  readonly rows?: readonly unknown[];
  /** Answers of `count`, in call order; `0` once the queue is empty. */
  readonly counts?: readonly number[];
}

function stub(options: StubOptions = {}) {
  const raw: RawCall[] = [];
  const calls: { method: string; args: unknown }[] = [];
  const answers = [...(options.raw ?? [])];
  const counts = [...(options.counts ?? [])];
  const record =
    <T>(method: string, answer: () => Promise<T>) =>
    (args: unknown): Promise<T> => {
      calls.push({ method, args });
      return answer();
    };
  const client = {
    tblexpenses_categories: {
      findMany: record('findMany', () => Promise.resolve(options.rows ?? [])),
      count: record('count', () => Promise.resolve(counts.shift() ?? 0)),
      findFirst: record('findFirst', () => Promise.resolve(null)),
      create: record('create', () =>
        Promise.resolve({ id: 9, name: 'Fuel', description: 'a<br />\nb' }),
      ),
      update: record('update', options.update ?? (() => Promise.resolve(null))),
      deleteMany: record('deleteMany', () => Promise.resolve({ count: options.deleted ?? 1 })),
    },
    tblexpenses: {
      groupBy: record('tblexpenses.groupBy', () => Promise.resolve(options.expenses ?? [])),
    },
    tblacc_expense_category_mappings: {
      groupBy: record('tblacc_expense_category_mappings.groupBy', () =>
        Promise.resolve(options.mappings ?? []),
      ),
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown> => {
      raw.push({ sql: strings.join('?'), values: flatten(values) });
      const answer = answers.shift();
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  const repository = new ExpenseCategoriesRepository({ client } as unknown as ClientHolder);
  return { repository, raw, calls };
}

const ABSENT = [{ n: 0n }];
const PRESENT = [{ n: 1n }];

function request(
  overrides: Partial<ExpenseCategoriesListRequest> = {},
): ExpenseCategoriesListRequest {
  return { search: null, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

describe('ExpenseCategoriesRepository: usageByCategory (D-07, D-15)', () => {
  it('(a) an empty id list issues no query at all', async () => {
    const { repository, raw, calls } = stub();
    expect((await repository.usageByCategory([])).size).toBe(0);
    expect(raw).toEqual([]);
    expect(calls).toEqual([]);
  });

  it('(b) petty-cash table ABSENT: one probe, no grouped petty-cash query, the two groupBy results per id', async () => {
    const { repository, raw, calls } = stub({
      raw: [ABSENT],
      expenses: [{ category: 7, _count: { id: 3 } }],
      mappings: [
        { category_id: 7, _count: { id: 1 } },
        { category_id: 8, _count: { id: 2 } },
      ],
    });
    const usage = await repository.usageByCategory([7, 8, 9]);
    expect([...usage.entries()]).toEqual([
      [7, { expenses: 3, accountingMappings: 1, pettyCashAdvances: 0 }],
      [8, { expenses: 0, accountingMappings: 2, pettyCashAdvances: 0 }],
      [9, { expenses: 0, accountingMappings: 0, pettyCashAdvances: 0 }],
    ]);
    expect(raw).toHaveLength(1);
    expect(raw[0]?.sql).toContain('information_schema.TABLES');
    expect(calls).toEqual([
      {
        method: 'tblexpenses.groupBy',
        args: {
          by: ['category'],
          where: { category: { in: [7, 8, 9] } },
          _count: { id: true },
        },
      },
      {
        method: 'tblacc_expense_category_mappings.groupBy',
        args: {
          by: ['category_id'],
          where: { category_id: { in: [7, 8, 9] } },
          _count: { id: true },
        },
      },
    ]);
  });

  it('(c) petty-cash table PRESENT: exactly one grouped query with the page ids bound; a bigint count maps per id', async () => {
    const { repository, raw } = stub({ raw: [PRESENT, [{ category: '7', n: 2n }]] });
    const usage = await repository.usageByCategory([7, 8]);
    expect(raw).toHaveLength(2);
    const grouped = raw[1];
    expect(grouped?.sql).toContain('tblpur_petty_cash_advances');
    expect(grouped?.sql).toContain('expense_category');
    expect(grouped?.sql).toContain('GROUP BY');
    expect(grouped?.values).toEqual([7, 8]);
    expect(usage.get(7)).toEqual({ expenses: 0, accountingMappings: 0, pettyCashAdvances: 2 });
    expect(usage.get(8)).toEqual({ expenses: 0, accountingMappings: 0, pettyCashAdvances: 0 });
  });

  it('(d) the probe binds the table name as a VALUE: it is in the bound values, never in the SQL text', async () => {
    const { repository, raw } = stub({ raw: [ABSENT, PRESENT] });
    await repository.usageByCategory([1]);
    const probe = raw[0];
    expect(probe?.values).toEqual([EXPENSE_CATEGORIES_PETTY_CASH_TABLE]);
    expect(EXPENSE_CATEGORIES_PETTY_CASH_TABLE).toBe('tblpur_petty_cash_advances');
    expect(probe?.sql).not.toContain(EXPENSE_CATEGORIES_PETTY_CASH_TABLE);
    expect(probe?.sql).toMatch(/TABLE_SCHEMA = DATABASE\(\) AND TABLE_NAME = \?$/);
    expect(await repository.tablePresent('tblexpenses')).toBe(true);
    expect(raw[1]?.values).toEqual(['tblexpenses']);
    expect(raw[1]?.sql).toBe(probe?.sql);
  });

  it('(e) fails closed: an error from the grouped query or from the probe rejects the whole answer', async () => {
    const failing = stub({ raw: [PRESENT, new Error('Unknown column expense_category')] });
    await expect(failing.repository.usageByCategory([7])).rejects.toThrow(
      'Unknown column expense_category',
    );
    const probeFails = stub({ raw: [new Error('connection lost')] });
    await expect(probeFails.repository.usageByCategory([7])).rejects.toThrow('connection lost');
  });

  it('a probe answer that is not one count row is refused, not read as absent', async () => {
    const { repository } = stub({ raw: [[]] });
    await expect(repository.usageByCategory([7])).rejects.toThrow();
  });
});

describe('ExpenseCategoriesRepository: the table delegate', () => {
  it('(f) update answers null on a Prisma P2025 and rethrows anything else', async () => {
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
          select: { id: true, name: true, description: true },
        },
      },
    ]);
    const broken = stub({
      update: () => Promise.reject(Object.assign(new Error('deadlock'), { code: 'P2034' })),
    });
    await expect(broken.repository.update(1, { name: 'X' })).rejects.toThrow('deadlock');
  });

  it('update answers the stored row it wrote', async () => {
    const { repository } = stub({
      update: () => Promise.resolve({ id: 3, name: 'Echo', description: null }),
    });
    expect(await repository.update(3, { name: 'Echo' })).toEqual({
      id: 3,
      name: 'Echo',
      description: null,
    });
  });

  it('(g) remove answers false when deleteMany counts 0, true when it counts 1', async () => {
    const none = stub({ deleted: 0 });
    expect(await none.repository.remove(404)).toBe(false);
    expect(none.calls).toEqual([{ method: 'deleteMany', args: { where: { id: 404 } } }]);
    expect(await stub({ deleted: 1 }).repository.remove(2)).toBe(true);
  });

  it('create writes the name and the stored description; findById reads by id', async () => {
    const { repository, calls } = stub();
    expect(await repository.create({ name: 'Fuel', description: 'a<br />\nb' })).toEqual({
      id: 9,
      name: 'Fuel',
      description: 'a<br />\nb',
    });
    expect(await repository.findById(9)).toBeNull();
    expect(calls).toEqual([
      {
        method: 'create',
        args: {
          data: { name: 'Fuel', description: 'a<br />\nb' },
          select: { id: true, name: true, description: true },
        },
      },
      {
        method: 'findFirst',
        args: { where: { id: 9 }, select: { id: true, name: true, description: true } },
      },
    ]);
  });

  it('(h) list: q over the name or the description, the keyset where and orderBy, total and rank by count', async () => {
    const { repository, calls } = stub({
      rows: [
        { id: 4, name: 'Fuel', description: null },
        { id: 2, name: 'Gas', description: 'x' },
      ],
      counts: [5, 2],
    });
    const match = { OR: [{ name: { contains: 'fu' } }, { description: { contains: 'fu' } }] };
    const cursor = {
      sort: 'name' as const,
      key: ['Delta', 1] as const,
      direction: 'after' as const,
    };
    const page = await repository.list(request({ search: 'fu', cursor, limit: 2 }));

    expect(calls[0]).toEqual({
      method: 'findMany',
      args: {
        where: {
          AND: [
            match,
            {
              OR: [{ name: { gt: 'Delta' } }, { name: 'Delta', id: { gt: 1 } }],
            },
          ],
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: 2,
        select: { id: true, name: true, description: true },
      },
    });
    expect(calls[1]).toEqual({ method: 'count', args: { where: match } });
    expect(calls[2]).toEqual({
      method: 'count',
      args: {
        where: {
          AND: [match, { OR: [{ name: { lt: 'Fuel' } }, { name: 'Fuel', id: { lt: 4 } }] }],
        },
      },
    });
    expect(page.items.map((row) => row.id)).toEqual([4, 2]);
    expect(page.total).toBe(5);
    expect(page.rangeStart).toBe(3);
    expect(page.prevCursor).not.toBeNull();
    expect(page.nextCursor).not.toBeNull();
  });

  it('list with no q and no cursor matches everything; a before cursor reads reversed and answers in order', async () => {
    const { repository, calls } = stub({
      rows: [
        { id: 3, name: 'A', description: null },
        { id: 5, name: 'B', description: null },
      ],
      counts: [4, 1],
    });
    const page = await repository.list(
      request({
        sortField: 'id',
        order: 'desc',
        cursor: { sort: 'id', key: [2, 2], direction: 'before' },
      }),
    );
    expect(calls[0]?.args).toMatchObject({
      where: { AND: [{}, { OR: [{ id: { gt: 2 } }, { id: { gt: 2 } }] }] },
      orderBy: [{ id: 'asc' }, { id: 'asc' }],
    });
    expect(page.items.map((row) => row.id)).toEqual([5, 3]);

    const first = stub();
    const empty = await first.repository.list(request());
    expect(first.calls[0]?.args).toMatchObject({ where: {} });
    expect(first.calls[1]).toEqual({ method: 'count', args: { where: {} } });
    expect(first.calls).toHaveLength(2);
    expect(empty).toEqual({
      items: [],
      nextCursor: null,
      prevCursor: null,
      total: 0,
      rangeStart: 0,
    });
  });

  it('count is the match without the cursor', async () => {
    const { repository, calls } = stub({ counts: [3] });
    expect(await repository.count(request({ search: 'x' }))).toBe(3);
    expect(calls).toEqual([
      {
        method: 'count',
        args: { where: { OR: [{ name: { contains: 'x' } }, { description: { contains: 'x' } }] } },
      },
    ]);
  });
});
