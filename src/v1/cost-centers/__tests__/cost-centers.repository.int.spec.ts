/**
 * CostCentersRepository against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * `tblcost_centers` is node-owned since plan 04.1-17, so the ownership guard admits the writes this
 * spec makes through the typed delegate. The real probe is compared with a direct read of
 * `information_schema.COLUMNS` for the six candidates (computed here, never hard-coded, so this spec
 * stays true when a slice adds a column); every present usage statement runs against the real schema
 * and equals an independent count; D-31's two create columns are read back byte for byte, and
 * the naive `DATETIME` is read as text to prove Prisma stored the wall clock verbatim; the exact
 * name match of the asset statement is checked on the real `name` column.
 *
 * Everything this spec writes it creates itself and deletes again: `tblcost_centers` rows whose name
 * starts with `MARKER`, removed before the run (a leftover of a crashed run) and after it. No other
 * table is written (`tblfe_asset_creation` is fixed_equipment-owned: the guard refuses it), no seeded
 * row is touched, and no value from the local data is read into an assertion message: ids and
 * counts are compared, never printed, and every name asserted is one this spec wrote.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { COST_CENTERS_NAME_MAX } from '../dto/cost-centers.dto.js';
import type {
  CostCenterRow,
  CostCentersListRequest,
  CostCentersPage,
  CostCenterUsage,
} from '../model/cost-centers.model.js';
import {
  COST_CENTER_REFERENCES,
  CostCentersRepository,
  referenceKey,
} from '../repository/cost-centers.repository.js';
import { NO_COST_CENTER_USAGE, wallClockAt } from '../service/cost-centers.transformer.js';

/** Every row this spec creates carries this prefix, so the cleanup deletes exactly its own rows. */
const MARKER = 'int-spec-04.1-18-cc';

/** D-31's wall clock for the marker rows: 2026-10-03 00:30:15 in Asia/Dubai. */
const STORED = wallClockAt(new Date('2026-10-02T20:30:15.250Z'), 'Asia/Dubai');
const CREATOR = 1;

const numberSchema = z.union([z.bigint(), z.number()]).transform(Number);
const oneCountSchema = z.tuple([z.object({ n: numberSchema })]);
const lengthSchema = z.tuple([z.object({ len: numberSchema })]);
const textSchema = z.tuple([z.object({ d: z.string() })]);
const collationSchema = z.tuple([z.object({ c: z.string() })]);
const groupSchema = z.array(
  z.object({
    cost_center: z.number().int().nullable(),
    _count: z.object({ _all: z.number().int() }),
  }),
);
const assetSchema = z.array(z.object({ cost_centre: z.string().nullable() }));
const idNameSchema = z.array(z.object({ id: z.number().int(), name: z.string() }));

/** The id-matched candidates the Prisma mirror models, with their typed delegate's group-by. */
type GroupBy = (ids: number[]) => Promise<unknown>;

function request(overrides: Partial<CostCentersListRequest> = {}): CostCentersListRequest {
  return { search: MARKER, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const ids = (page: CostCentersPage): number[] => page.items.map((row) => row.id);

describe.skipIf(!process.env.DATABASE_URL)('CostCentersRepository against the local mirror', () => {
  const service = new PrismaService(new AppConfig(), new HealthService());
  const repository = new CostCentersRepository(service);
  const client = service.client;
  let a: CostCenterRow;
  let b: CostCenterRow;
  let c: CostCenterRow;
  /** The id of a row this spec created and deleted: guaranteed missing (ids are never reused). */
  let missingId = 0;

  const cleanup = () =>
    client.tblcost_centers.deleteMany({ where: { name: { startsWith: MARKER } } });

  const create = (suffix: string): Promise<CostCenterRow> =>
    repository.create({ name: `${MARKER}-${suffix}`, createdBy: CREATOR, datecreated: STORED });

  /** Whether the connected schema has `table.column`, read directly (the probe's independent twin). */
  async function hasColumn(table: string, column: string): Promise<boolean> {
    const rows = await client.$queryRaw<
      unknown[]
    >`SELECT COUNT(*) AS n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${table} AND COLUMN_NAME = ${column}`;
    return oneCountSchema.parse(rows)[0].n > 0;
  }

  beforeAll(async () => {
    await cleanup();
    c = await create('c');
    a = await create('a <b>');
    b = await create('b');
    const ghost = await create('ghost');
    missingId = ghost.id;
    await repository.remove(ghost.id);
  });

  afterAll(async () => {
    await cleanup();
    await service.client.$disconnect();
  });

  it('create answers the database id; findById returns the row byte for byte with D-31 columns', async () => {
    expect(a.id).toBeGreaterThan(0);
    expect(await repository.findById(a.id)).toEqual({
      id: a.id,
      name: `${MARKER}-a <b>`,
      createdBy: CREATOR,
      datecreated: STORED,
    });
    expect(STORED.toISOString()).toBe('2026-10-03T00:30:15.000Z');
    expect(await repository.findById(missingId)).toBeNull();
  });

  it('datecreated is stored as the naive wall clock, verbatim (read as text)', async () => {
    const rows = await client.$queryRaw<
      unknown[]
    >`SELECT DATE_FORMAT(datecreated, '%Y-%m-%d %H:%i:%s') AS d FROM tblcost_centers WHERE id = ${a.id}`;
    expect(textSchema.parse(rows)[0].d).toBe('2026-10-03 00:30:15');
  });

  it('update changes the name only: created_by and datecreated byte-unchanged; a missing id is null', async () => {
    const updated = await repository.update(b.id, { name: `${MARKER}-b2` });
    expect(updated).toEqual({
      id: b.id,
      name: `${MARKER}-b2`,
      createdBy: CREATOR,
      datecreated: STORED,
    });
    expect(await repository.findById(b.id)).toEqual(updated);
    expect(await repository.update(missingId, { name: `${MARKER}-nobody` })).toBeNull();
  });

  it('three marker names page with limit 1 both ways under q, by name and by the id descending', async () => {
    const first = await repository.list(request({ limit: 1 }));
    expect(ids(first)).toEqual([a.id]);
    expect(first.total).toBe(3);
    const second = await repository.list(
      request({ limit: 1, cursor: decodeCursor(first.nextCursor, 'name') }),
    );
    expect(ids(second)).toEqual([b.id]);
    const third = await repository.list(
      request({ limit: 1, cursor: decodeCursor(second.nextCursor, 'name') }),
    );
    expect(ids(third)).toEqual([c.id]);
    expect(third.nextCursor).toBeNull();
    expect(third.rangeStart).toBe(3);
    const back = await repository.list(
      request({ limit: 1, cursor: decodeCursor(third.prevCursor, 'name') }),
    );
    expect(ids(back)).toEqual([b.id]);
    const byId = await repository.list(request({ sortField: 'id', order: 'desc' }));
    expect(ids(byId)).toEqual([b.id, a.id, c.id]);
    const idFirst = await repository.list(request({ sortField: 'id', order: 'desc', limit: 1 }));
    const idNext = await repository.list(
      request({
        sortField: 'id',
        order: 'desc',
        limit: 1,
        cursor: decodeCursor(idFirst.nextCursor, 'id'),
      }),
    );
    expect(ids(idNext)).toEqual([a.id]);
    expect(await repository.count(request())).toBe(3);
  });

  it('q as an id matches the id; an all-digit q up to INT UNSIGNED runs', async () => {
    expect(ids(await repository.list(request({ search: String(c.id) })))).toContain(c.id);
    await expect(repository.count(request({ search: '4294967295' }))).resolves.toBeTypeOf('number');
  });

  it('CHARACTER_MAXIMUM_LENGTH of tblcost_centers.name equals COST_CENTERS_NAME_MAX', async () => {
    const rows = await client.$queryRaw<
      unknown[]
    >`SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblcost_centers' AND COLUMN_NAME = 'name'`;
    expect(lengthSchema.parse(rows)[0].len).toBe(COST_CENTERS_NAME_MAX);
  });

  it('presentReferences equals a direct read of information_schema.COLUMNS; every absent candidate is simply not in it', async () => {
    const found = await Promise.all(
      COST_CENTER_REFERENCES.map(async (reference) =>
        (await hasColumn(reference.table, reference.column)) ? [referenceKey(reference)] : [],
      ),
    );
    const expected = new Set(found.flat());
    const present = await repository.presentReferences();
    expect([...present].sort()).toEqual([...expected].sort());
  });

  it('usageByCostCenter over every id runs every present statement and equals independent counts', async () => {
    const all = idNameSchema.parse(
      await client.tblcost_centers.findMany({ select: { id: true, name: true } }),
    );
    const everyId = all.map((row) => row.id);
    const present = await repository.presentReferences();
    const usage = await repository.usageByCostCenter(everyId);
    expect([...usage.keys()].sort((x, y) => x - y)).toEqual([...everyId].sort((x, y) => x - y));

    const groupBys: readonly (readonly [keyof CostCenterUsage, string, GroupBy])[] = [
      [
        'purchaseRequests',
        'tblpur_request.cost_center',
        (in_) =>
          client.tblpur_request.groupBy({
            by: ['cost_center'],
            where: { cost_center: { in: in_ } },
            _count: { _all: true },
          }),
      ],
      [
        'purchaseOrders',
        'tblpur_orders.cost_center',
        (in_) =>
          client.tblpur_orders.groupBy({
            by: ['cost_center'],
            where: { cost_center: { in: in_ } },
            _count: { _all: true },
          }),
      ],
      [
        'purchaseQuotations',
        'tblpur_estimates.cost_center',
        (in_) =>
          client.tblpur_estimates.groupBy({
            by: ['cost_center'],
            where: { cost_center: { in: in_ } },
            _count: { _all: true },
          }),
      ],
    ];
    const answers = await Promise.all(
      groupBys.map(([, key, groupBy]) =>
        present.has(key) ? groupBy(everyId) : Promise.resolve([]),
      ),
    );
    groupBys.forEach(([group], index) => {
      const expected = new Map<number, number>(everyId.map((id) => [id, 0]));
      for (const row of groupSchema.parse(answers[index])) {
        if (row.cost_center !== null) expected.set(row.cost_center, row._count._all);
      }
      const actual = new Map(everyId.map((id) => [id, usage.get(id)?.[group] ?? -1]));
      expect(actual, group).toEqual(expected);
    });

    const assets = new Map<number, number>(everyId.map((id) => [id, 0]));
    if (present.has('tblfe_asset_creation.cost_centre')) {
      const names = [...new Set(all.map((row) => row.name))];
      const stored = assetSchema.parse(
        await client.tblfe_asset_creation.findMany({
          where: { cost_centre: { in: names } },
          select: { cost_centre: true },
        }),
      );
      const byName = new Map<string, number>();
      for (const { cost_centre } of stored) {
        if (cost_centre !== null) byName.set(cost_centre, (byName.get(cost_centre) ?? 0) + 1);
      }
      for (const row of all) assets.set(row.id, byName.get(row.name) ?? 0);
    }
    const actualAssets = new Map(everyId.map((id) => [id, usage.get(id)?.assets ?? -1]));
    expect(actualAssets, 'assets').toEqual(assets);

    for (const key of ['tblexpenses.cost_center', 'tblinv_shipping_charges.cost_center']) {
      if (present.has(key)) continue;
      const group = key.startsWith('tblexpenses') ? 'expenses' : 'shippingCharges';
      expect(everyId.every((id) => usage.get(id)?.[group] === 0)).toBe(true);
    }
  });

  it('the marker rows are used by nothing: zeros in all six groups', async () => {
    const usage = await repository.usageByCostCenter([a.id, c.id]);
    expect([...usage.entries()]).toEqual([
      [a.id, NO_COST_CENTER_USAGE],
      [c.id, NO_COST_CENTER_USAGE],
    ]);
  });

  it('the asset match on the real name column: the exact bytes match, a case variant does not', async () => {
    const exact = `${MARKER}-c`;
    const variant = exact.toUpperCase();
    const binary = async (text: string): Promise<number> =>
      oneCountSchema.parse(
        await client.$queryRaw<
          unknown[]
        >`SELECT COUNT(*) AS n FROM tblcost_centers c WHERE c.id = ${c.id} AND CAST(${text} AS BINARY) = CAST(c.name AS BINARY)`,
      )[0].n;
    expect(await binary(exact)).toBe(1);
    expect(await binary(variant)).toBe(0);
    expect(await binary(`${exact} `)).toBe(0);
    // The column's own comparison would have matched the variant under a case-insensitive collation.
    const collation = collationSchema.parse(
      await client.$queryRaw<
        unknown[]
      >`SELECT COLLATION_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblcost_centers' AND COLUMN_NAME = 'name'`,
    )[0].c;
    const collated = oneCountSchema.parse(
      await client.$queryRaw<
        unknown[]
      >`SELECT COUNT(*) AS n FROM tblcost_centers c WHERE c.id = ${c.id} AND c.name = ${variant}`,
    )[0].n;
    expect(collated === 1).toBe(collation.endsWith('_ci'));
  });

  it('listAll and findByIds read the marker rows as stored', async () => {
    const own = (await repository.listAll())
      .filter((row) => row.name.startsWith(MARKER))
      .map((row) => row.id);
    expect(own).toEqual([a.id, b.id, c.id]);
    const picked = await repository.findByIds([c.id, missingId, a.id]);
    expect(picked.map((row) => row.id).sort((x, y) => x - y)).toEqual(
      [a.id, c.id].sort((x, y) => x - y),
    );
  });

  it('remove answers true, then the row is gone, then false; 0 marker rows remain after the cleanup', async () => {
    expect(await repository.remove(c.id)).toBe(true);
    expect(await repository.findById(c.id)).toBeNull();
    expect(await repository.remove(c.id)).toBe(false);
    await cleanup();
    expect(await client.tblcost_centers.count({ where: { name: { startsWith: MARKER } } })).toBe(0);
  });
});
