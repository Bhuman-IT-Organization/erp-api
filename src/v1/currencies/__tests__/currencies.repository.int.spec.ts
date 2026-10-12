/**
 * CurrenciesRepository against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * `tblcurrencies` is node-owned since plan 04.1-27, so the ownership guard admits the writes this
 * spec makes through the typed delegate. The real probe is compared with a direct read of
 * `information_schema.COLUMNS` for every register line (computed here, never hard-coded); every
 * present usage statement runs against the real schema and equals an independent count (an integer
 * line through its typed delegate's `count`, a text line through a typed `findMany` counted with an
 * exact JavaScript comparison); the exact-text expression is checked on bound literals; the five
 * columns are read back byte for byte; the base switch runs inside a transaction this spec rolls
 * back, so no row it did not create is changed, and the base read afterwards equals the base before.
 *
 * Everything this spec writes it creates itself and deletes again: `tblcurrencies` rows with a
 * marker code (`ZZA`, `ZZB`, `ZZC`) AND the marker symbol, removed before the run (a leftover of a
 * crashed run) and after it. A row holding a marker code with any other symbol is somebody's real
 * row: the spec then refuses to start. No other table is written, and no value from the local data
 * is read into an assertion message: ids and counts are compared, never printed.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { CURRENCIES_SYMBOL_MAX } from '../dto/currencies.dto.js';
import type { CurrencyRow, NewCurrency } from '../model/currencies.model.js';
import {
  CURRENCY_REFERENCES,
  CurrenciesRepository,
  referenceKey,
  type CurrencyReference,
} from '../repository/currencies.repository.js';
import { NO_CURRENCY_LOCK_USAGE, NO_CURRENCY_USAGE } from '../service/currencies.transformer.js';

/** The codes this spec's rows carry (at most 3 characters under the shared schema). */
const MARKER_CODES = ['ZZA', 'ZZB', 'ZZC'] as const;
/** The symbol every row of this spec carries, so a leftover is told from a real row. */
const MARKER_SYMBOL = 'zz-int-28';

const numberSchema = z.union([z.bigint(), z.number()]).transform(Number);
const oneSchema = z.tuple([z.object({ n: numberSchema })]);
const typeSchema = z.array(z.object({ d: z.string() }));
const lengthSchema = z.tuple([z.object({ len: numberSchema })]);
const sameSchema = z.tuple([z.object({ same: numberSchema })]);
const valuesSchema = z.array(z.record(z.string(), z.string().nullable()));

/** The two delegate methods the independent counts use, for a table named at run time. */
interface CountingDelegate {
  count(args: { where: Record<string, unknown> }): Promise<number>;
  findMany(args: {
    where: Record<string, unknown>;
    select: Record<string, true>;
  }): Promise<unknown[]>;
}

class Rollback extends Error {}

const input = (code: string, overrides: Partial<NewCurrency> = {}): NewCurrency => ({
  name: code,
  symbol: MARKER_SYMBOL,
  decimalSeparator: '.',
  thousandSeparator: ',',
  placement: 'before',
  ...overrides,
});

describe.skipIf(!process.env.DATABASE_URL)('CurrenciesRepository against the local mirror', () => {
  const service = new PrismaService(new AppConfig(), new HealthService());
  const repository = new CurrenciesRepository(service);
  const client = service.client;
  const delegates = client as unknown as Readonly<Record<string, CountingDelegate>>;
  let a: CurrencyRow;
  let b: CurrencyRow;

  const markerWhere = { name: { in: [...MARKER_CODES] } };
  const cleanup = () =>
    client.tblcurrencies.deleteMany({ where: { ...markerWhere, symbol: MARKER_SYMBOL } });

  /** A line's typed delegate. */
  function delegateOf(reference: CurrencyReference): CountingDelegate {
    const delegate = delegates[reference.table];
    if (delegate === undefined) throw new Error(`no delegate for ${reference.table}`);
    return delegate;
  }

  /**
   * The independent count of one line for one row: an integer line through `count` on the integer
   * id; a text line through a `findMany` of the column's non-null values, compared exactly in
   * JavaScript with the id's decimal text or the stored code.
   */
  async function independentCount(
    reference: CurrencyReference,
    row: Pick<CurrencyRow, 'id' | 'name'>,
  ): Promise<number> {
    const delegate = delegateOf(reference);
    if (reference.match === 'integerId') {
      return delegate.count({ where: { [reference.column]: row.id } });
    }
    const target = reference.match === 'codeAsText' ? row.name : String(row.id);
    const values = valuesSchema.parse(
      await delegate.findMany({
        where: { [reference.column]: { not: null } },
        select: { [reference.column]: true },
      }),
    );
    return values.filter((value) => value[reference.column] === target).length;
  }

  beforeAll(async () => {
    const real = await client.tblcurrencies.count({
      where: { ...markerWhere, symbol: { not: MARKER_SYMBOL } },
    });
    if (real > 0) throw new Error('a real tblcurrencies row holds a marker code: refusing to run');
    await cleanup();
    a = await repository.create(input('ZZA'));
    b = await repository.create(input('ZZB', { decimalSeparator: ',', placement: 'after' }));
  });

  afterAll(async () => {
    await cleanup();
    await service.client.$disconnect();
  });

  it('presentReferences holds every register line with the DATA_TYPE information_schema gives', async () => {
    const present = await repository.presentReferences();
    const direct = await Promise.all(
      CURRENCY_REFERENCES.map(
        async (reference) =>
          [
            referenceKey(reference),
            typeSchema
              .parse(
                await client.$queryRaw`SELECT DATA_TYPE AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${reference.table} AND COLUMN_NAME = ${reference.column}`,
              )[0]
              ?.d.toLowerCase(),
          ] as const,
      ),
    );
    expect([...present.keys()]).toEqual(CURRENCY_REFERENCES.map(referenceKey));
    expect([...present]).toEqual(direct);
  });

  it('usageByCurrency over every row equals the independent count of every line', async () => {
    const all = await client.tblcurrencies.findMany({ select: { id: true, name: true } });
    const answer = await repository.usageByCurrency(all);
    const expected = await Promise.all(
      all.map(async (row) => {
        const counts = await Promise.all(
          CURRENCY_REFERENCES.map((reference) => independentCount(reference, row)),
        );
        const usage: Record<string, number> = { ...NO_CURRENCY_USAGE };
        const lockUsage: Record<string, number> = { ...NO_CURRENCY_LOCK_USAGE };
        CURRENCY_REFERENCES.forEach((reference, index) => {
          const half = reference.countsForDelete ? usage : lockUsage;
          half[reference.group] = (half[reference.group] ?? 0) + (counts[index] ?? 0);
        });
        return [row.id, { usage, lockUsage }] as const;
      }),
    );
    expect([...answer.keys()].sort((x, y) => x - y)).toEqual(
      all.map((row) => row.id).sort((x, y) => x - y),
    );
    expect(new Map(answer)).toEqual(new Map(expected));
  });

  it('the exact-text expression on bound literals: bytes, no case folding, no padding', async () => {
    const same = async (left: string, right: string) =>
      sameSchema.parse(
        await client.$queryRaw`SELECT CAST(${left} AS BINARY) IN (${right}) AS same`,
      )[0].same;
    expect(await same('USD', 'USD')).toBe(1);
    expect(await same('usd', 'USD')).toBe(0);
    expect(await same('USD ', 'USD')).toBe(0);
    expect(await same('7', '07')).toBe(0);
  });

  it('create stores the five columns byte for byte and leaves isdefault 0', async () => {
    expect(await repository.findById(a.id)).toEqual({
      id: a.id,
      name: 'ZZA',
      symbol: MARKER_SYMBOL,
      decimalSeparator: '.',
      thousandSeparator: ',',
      placement: 'before',
      isBase: false,
    });
    expect((await repository.findById(b.id))?.placement).toBe('after');
  });

  it('update rewrites the five columns; a missing id is null', async () => {
    const updated = await repository.update(
      b.id,
      input('ZZC', { decimalSeparator: ',', thousandSeparator: ' ', placement: 'after' }),
    );
    expect(updated).toEqual({
      id: b.id,
      name: 'ZZC',
      symbol: MARKER_SYMBOL,
      decimalSeparator: ',',
      thousandSeparator: ' ',
      placement: 'after',
      isBase: false,
    });
    expect(await repository.update(2_147_483_000, input('ZZA'))).toBeNull();
  });

  it('the symbol column is as wide as CURRENCIES_SYMBOL_MAX', async () => {
    const [row] = lengthSchema.parse(
      await client.$queryRaw`SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblcurrencies' AND COLUMN_NAME = 'symbol'`,
    );
    expect(row.len).toBe(CURRENCIES_SYMBOL_MAX);
  });

  it('the base switch inside a rolled-back transaction: the marker the base, every other row cleared; nothing kept', async () => {
    const before = (await repository.findBase())?.id ?? null;
    let inside: number[] = [];
    await expect(
      client.$transaction(async (tx) => {
        expect(await repository.setBaseIn(tx, a.id)).toBe(true);
        inside = (
          await tx.tblcurrencies.findMany({ where: { isdefault: true }, select: { id: true } })
        ).map((row) => row.id);
        throw new Rollback('roll back');
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect(inside).toEqual([a.id]);
    expect((await repository.findBase())?.id ?? null).toBe(before);
    expect((await repository.findById(a.id))?.isBase).toBe(false);
  });

  it('setBaseIn on a missing id answers false and changes nothing', async () => {
    const before = (await repository.findBase())?.id ?? null;
    await expect(
      client.$transaction(async (tx) => {
        expect(await repository.setBaseIn(tx, 2_147_483_000)).toBe(false);
        throw new Rollback('roll back');
      }),
    ).rejects.toBeInstanceOf(Rollback);
    expect((await repository.findBase())?.id ?? null).toBe(before);
  });

  it('remove deletes the marker, then answers false; no marker row remains', async () => {
    expect(await repository.remove(a.id)).toBe(true);
    expect(await repository.remove(a.id)).toBe(false);
    expect(await repository.remove(b.id)).toBe(true);
    const left = oneSchema.parse(
      await client.$queryRaw`SELECT COUNT(*) AS n FROM tblcurrencies WHERE CAST(symbol AS BINARY) = CAST(${MARKER_SYMBOL} AS BINARY)`,
    );
    expect(left[0].n).toBe(0);
  });
});
