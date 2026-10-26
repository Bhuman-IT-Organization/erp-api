/**
 * ServicesRepository against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * `tblservices` is node-owned (`ownership.json`), so the ownership guard admits the writes this spec
 * makes through the typed delegate. `tbltickets` is read only: the ticket count is compared with an
 * independent count of the same column.
 *
 * Everything this spec writes it creates itself and deletes again: `tblservices` rows whose name
 * starts with `MARKER`, removed before the run (a leftover of a crashed run) and after it. No other
 * table is written, no seeded row is touched, and no value from the local data is read into an
 * assertion message: ids and counts are compared, never printed, and every name asserted is one this
 * spec wrote.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { SERVICES_NAME_MAX } from '../dto/services.dto.js';
import type { ServiceRow, ServicesListRequest, ServicesPage } from '../model/services.model.js';
import { ServicesRepository } from '../repository/services.repository.js';

/** Every row this spec creates carries this prefix, so the cleanup deletes exactly its own rows. */
const MARKER = 'int-spec-svc';

const numberSchema = z.union([z.bigint(), z.number()]).transform(Number);
const lengthSchema = z.tuple([z.object({ len: numberSchema })]);

function request(overrides: Partial<ServicesListRequest> = {}): ServicesListRequest {
  return { search: MARKER, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const ids = (page: ServicesPage): number[] => page.items.map((row) => row.id);

describe.skipIf(!process.env.DATABASE_URL)('ServicesRepository against the local mirror', () => {
  const service = new PrismaService(new AppConfig(), new HealthService());
  const repository = new ServicesRepository(service);
  const client = service.client;
  let a: ServiceRow;
  let b: ServiceRow;
  let c: ServiceRow;
  /** The id of a row this spec created and deleted: guaranteed missing (ids are never reused). */
  let missingId = 0;

  const cleanup = () => client.tblservices.deleteMany({ where: { name: { startsWith: MARKER } } });

  const create = (suffix: string): Promise<ServiceRow> =>
    repository.create({ name: `${MARKER}-${suffix}` });

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

  it('create answers the database id; findById returns the row byte for byte', async () => {
    expect(a.id).toBeGreaterThan(0);
    expect(await repository.findById(a.id)).toEqual({ id: a.id, name: `${MARKER}-a <b>` });
    expect(await repository.findById(missingId)).toBeNull();
  });

  it('update changes the name; a missing id is null', async () => {
    const updated = await repository.update(b.id, { name: `${MARKER}-b2` });
    expect(updated).toEqual({ id: b.id, name: `${MARKER}-b2` });
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

  it('q as an id matches the id; an all-digit q up to INT max runs', async () => {
    expect(ids(await repository.list(request({ search: String(c.id) })))).toContain(c.id);
    await expect(repository.count(request({ search: '2147483647' }))).resolves.toBeTypeOf('number');
  });

  it('CHARACTER_MAXIMUM_LENGTH of tblservices.name equals SERVICES_NAME_MAX', async () => {
    const rows = await client.$queryRaw<
      unknown[]
    >`SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblservices' AND COLUMN_NAME = 'name'`;
    expect(lengthSchema.parse(rows)[0].len).toBe(SERVICES_NAME_MAX);
  });

  it('countTickets equals an independent count of tbltickets.service; the marker rows are used by no ticket', async () => {
    for (const row of [a, c]) {
      expect(await repository.countTickets(row.id)).toBe(
        await client.tbltickets.count({ where: { service: row.id } }),
      );
      expect(await repository.countTickets(row.id)).toBe(0);
    }
    expect(await repository.countTickets(missingId)).toBe(0);
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
    expect(await repository.findByIds([])).toEqual([]);
  });

  it('remove answers true, then the row is gone, then false; 0 marker rows remain after the cleanup', async () => {
    expect(await repository.remove(c.id)).toBe(true);
    expect(await repository.findById(c.id)).toBeNull();
    expect(await repository.remove(c.id)).toBe(false);
    await cleanup();
    expect(await client.tblservices.count({ where: { name: { startsWith: MARKER } } })).toBe(0);
  });
});
