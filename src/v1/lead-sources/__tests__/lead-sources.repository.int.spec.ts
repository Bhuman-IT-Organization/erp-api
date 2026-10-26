import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import type { LeadSourcesListRequest } from '../model/lead-sources.model.js';
import { LeadSourcesRepository } from '../repository/lead-sources.repository.js';

const MARKER = 'int-spec-lead-sources-2026-10';

function request(overrides: Partial<LeadSourcesListRequest> = {}): LeadSourcesListRequest {
  return { search: MARKER, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

describe.skipIf(!process.env.DATABASE_URL)('LeadSourcesRepository against the local mirror', () => {
  const service = new PrismaService(new AppConfig(), new HealthService());
  const repository = new LeadSourcesRepository(service);
  let createdIds: number[] = [];

  const cleanup = () =>
    service.client.tblleads_sources.deleteMany({ where: { name: { startsWith: MARKER } } });
  const create = (name: string) => repository.create({ name: `${MARKER}-${name}` });

  beforeAll(async () => {
    await cleanup();
    const rows = await Promise.all([create('c'), create('a'), create('b')]);
    createdIds = rows.map((row) => row.id);
  });

  afterAll(async () => {
    await cleanup();
    await service.client.$disconnect();
  });

  it('creates rows and reads only their ids and names', async () => {
    const row = await repository.findById(createdIds[0] ?? -1);
    expect(row?.id).toBeTypeOf('number');
    expect(row?.name).toBe(`${MARKER}-c`);
  });

  it('pages the marker rows by name with keyset cursors in both directions', async () => {
    const first = await repository.list(request({ limit: 1 }));
    expect(first.items[0]?.name).toBe(`${MARKER}-a`);
    const second = await repository.list(
      request({ limit: 1, cursor: decodeCursor(first.nextCursor, 'name') }),
    );
    expect(second.items[0]?.name).toBe(`${MARKER}-b`);
    const third = await repository.list(
      request({ limit: 1, cursor: decodeCursor(second.nextCursor, 'name') }),
    );
    expect(third.items[0]?.name).toBe(`${MARKER}-c`);
    const back = await repository.list(
      request({ limit: 1, cursor: decodeCursor(third.prevCursor, 'name') }),
    );
    expect(back.items[0]?.name).toBe(`${MARKER}-b`);
    expect(await repository.count(request())).toBe(3);
  });

  it('updates only the name and deletes rows created by this spec', async () => {
    const id = createdIds[1];
    if (id === undefined) throw new Error('expected a row created by this spec');
    await expect(repository.update(id, { name: `${MARKER}-renamed` })).resolves.toEqual({
      id,
      name: `${MARKER}-renamed`,
    });
    await expect(repository.remove(id)).resolves.toBe(true);
    await expect(repository.findById(id)).resolves.toBeNull();
    createdIds = createdIds.filter((createdId) => createdId !== id);
  });
});
