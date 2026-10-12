/**
 * TaxesRepository against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * `tbltaxes` is node-owned since plan 04.1-10, so the ownership guard admits the writes this spec
 * makes through the typed delegate. Every one of the 20 usage statements runs for real against the
 * schema (each table and column must exist and each `FIND_IN_SET` must parse), the `|`-list matcher
 * is checked on bound literals only, the rate order is checked to be numeric across pages, and the
 * name collation is read from `information_schema` so the case rule of `findOtherByName` is the
 * column's, as the fake assumes.
 *
 * Everything this spec writes it creates itself and deletes again: `tbltaxes` rows whose name starts
 * with `MARKER`, removed before the run (a leftover of a crashed run) and after it. No seeded row is
 * touched, no other table is written, and no value from the local data is read into an assertion:
 * every expected value below is one this spec wrote. The `default_tax` option is read and only its
 * type is checked; its content is never asserted, printed or logged.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import type { TaxesListRequest, TaxesPage, TaxRow } from '../model/taxes.model.js';
import { TaxesRepository } from '../repository/taxes.repository.js';
import { NO_TAX_USAGE } from '../service/taxes.transformer.js';

/** Every row this spec creates carries this prefix, so the cleanup deletes exactly its own rows. */
const MARKER = 'int-spec-04.1-11-tax';

const hitSchema = z.tuple([z.object({ hit: z.union([z.bigint(), z.number()]).transform(Number) })]);
const collationSchema = z.tuple([z.object({ c: z.string() })]);

function request(overrides: Partial<TaxesListRequest> = {}): TaxesListRequest {
  return { search: MARKER, sortField: 'rate', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const ids = (page: TaxesPage): number[] => page.items.map((row) => row.id);

describe.skipIf(!process.env.DATABASE_URL)('TaxesRepository against the local mirror', () => {
  const service = new PrismaService(new AppConfig(), new HealthService());
  const repository = new TaxesRepository(service);
  /** Rates 5.00, 10.00 and 100.00: numeric order a, b, c; text order would put c before a. */
  let a: TaxRow;
  let b: TaxRow;
  let c: TaxRow;
  /** The id of a row this spec created and deleted: guaranteed missing (ids are never reused). */
  let missingId = 0;

  const cleanup = () =>
    service.client.tbltaxes.deleteMany({ where: { name: { startsWith: MARKER } } });

  /** `FIND_IN_SET` over the same split the repository's form B uses, on two bound literals. */
  async function matches(id: string, list: string): Promise<number> {
    const rows = await service.client.$queryRaw<
      unknown[]
    >`SELECT FIND_IN_SET(${id}, REGEXP_REPLACE(${list}, '[|]', ',')) AS hit`;
    return hitSchema.parse(rows)[0].hit;
  }

  beforeAll(async () => {
    await cleanup();
    c = await repository.create({ name: `${MARKER}-c`, taxrate: '100.00' });
    a = await repository.create({ name: `${MARKER}-a <b>`, taxrate: '5.00' });
    b = await repository.create({ name: `${MARKER}-b`, taxrate: '10.00' });
    const ghost = await repository.create({ name: `${MARKER}-ghost`, taxrate: '0.00' });
    missingId = ghost.id;
    await repository.remove(ghost.id);
  });

  afterAll(async () => {
    await cleanup();
    await service.client.$disconnect();
  });

  it('create answers the database id; findById returns the row byte for byte, the rate as two-decimal text', async () => {
    expect(a.id).toBeGreaterThan(0);
    expect(await repository.findById(a.id)).toEqual({
      id: a.id,
      name: `${MARKER}-a <b>`,
      taxrate: '5.00',
    });
    expect(await repository.findById(missingId)).toBeNull();
  });

  it('the rate orders numerically: limit 1 pages 5.00, 10.00, 100.00 forward and back', async () => {
    const first = await repository.list(request({ limit: 1 }));
    expect(ids(first)).toEqual([a.id]);
    expect(first.total).toBe(3);
    const second = await repository.list(
      request({ limit: 1, cursor: decodeCursor(first.nextCursor, 'rate') }),
    );
    expect(ids(second)).toEqual([b.id]);
    const third = await repository.list(
      request({ limit: 1, cursor: decodeCursor(second.nextCursor, 'rate') }),
    );
    expect(ids(third)).toEqual([c.id]);
    expect(third.nextCursor).toBeNull();
    expect(third.rangeStart).toBe(3);
    const back = await repository.list(
      request({ limit: 1, cursor: decodeCursor(third.prevCursor, 'rate') }),
    );
    expect(ids(back)).toEqual([b.id]);
    expect(ids(await repository.list(request({ order: 'desc' })))).toEqual([c.id, b.id, a.id]);
    const descFirst = await repository.list(request({ order: 'desc', limit: 1 }));
    const descNext = await repository.list(
      request({ order: 'desc', limit: 1, cursor: decodeCursor(descFirst.nextCursor, 'rate') }),
    );
    expect(ids(descNext)).toEqual([b.id]);
    expect(await repository.count(request())).toBe(3);
  });

  it('q as a rate also matches the rate; q as an id also matches the id', async () => {
    const byRate = await repository.list(request({ search: '100' }));
    expect(ids(byRate)).toContain(c.id);
    const byId = await repository.list(request({ search: String(b.id) }));
    expect(ids(byId)).toContain(b.id);
  });

  it('update changes the name and the rate; a missing id answers null', async () => {
    expect(await repository.update(b.id, { name: `${MARKER}-b2`, taxrate: '12.50' })).toEqual({
      id: b.id,
      name: `${MARKER}-b2`,
      taxrate: '12.50',
    });
    expect(await repository.update(missingId, { name: `${MARKER}-nobody` })).toBeNull();
    expect(await repository.findById(missingId)).toBeNull();
  });

  it('usageByTax runs all 20 statements against the real schema: zeros in all nine groups for new taxes', async () => {
    const usage = await repository.usageByTax([a.id, c.id]);
    expect([...usage.entries()]).toEqual([
      [a.id, NO_TAX_USAGE],
      [c.id, NO_TAX_USAGE],
    ]);
  });

  it('the "|"-list matcher, on bound literals: 12 in 3|12, not 1 in 3|12, not 2 in 12, 3 in 3', async () => {
    expect(await matches('12', '3|12')).toBeGreaterThan(0);
    expect(await matches('1', '3|12')).toBe(0);
    expect(await matches('2', '12')).toBe(0);
    expect(await matches('3', '3')).toBeGreaterThan(0);
    expect(await matches('5', '4,5')).toBeGreaterThan(0);
  });

  it('findOtherByName follows the column collation: an upper-cased name is found exactly when the collation is _ci', async () => {
    const collation = collationSchema.parse(
      await service.client.$queryRaw<
        unknown[]
      >`SELECT COLLATION_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbltaxes' AND COLUMN_NAME = 'name'`,
    )[0].c;
    const upper = `${MARKER}-c`.toUpperCase();
    const found = await repository.findOtherByName(upper);
    expect(found === c.id).toBe(collation.endsWith('_ci'));
    expect(await repository.findOtherByName(`${MARKER}-c`)).toBe(c.id);
    expect(await repository.findOtherByName(`${MARKER}-c`, c.id)).toBeNull();
  });

  it('defaultTaxSetting answers a string (its content is never read here)', async () => {
    expect(typeof (await repository.defaultTaxSetting())).toBe('string');
  });

  it('listAll and findByIds read the marker rows as stored', async () => {
    const all = await repository.listAll();
    const own = all.filter((row) => row.name.startsWith(MARKER)).map((row) => row.id);
    expect(own).toEqual([a.id, b.id, c.id]);
    const picked = await repository.findByIds([c.id, missingId, a.id]);
    expect(picked.map((row) => row.id).sort((x, y) => x - y)).toEqual(
      [a.id, c.id].sort((x, y) => x - y),
    );
  });

  it('remove answers true, then the row is gone, then remove answers false', async () => {
    expect(await repository.remove(c.id)).toBe(true);
    expect(await repository.findById(c.id)).toBeNull();
    expect(await repository.remove(c.id)).toBe(false);
  });
});
