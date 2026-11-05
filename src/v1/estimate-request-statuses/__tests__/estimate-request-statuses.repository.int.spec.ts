import 'reflect-metadata';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaClient } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { EstimateRequestStatusesRepository } from '../repository/estimate-request-statuses.repository.js';

const MARKER = 'int-spec-estimate-request-status';

describe.skipIf(!process.env.DATABASE_URL)(
  'EstimateRequestStatusesRepository against the configured database',
  () => {
    const prisma = new PrismaService(new AppConfig(), new HealthService());
    const repository = new EstimateRequestStatusesRepository(prisma);
    const client = prisma.client;
    const directClient =
      process.env.DATABASE_URL === undefined
        ? new PrismaClient()
        : new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });

    const cleanup = async () => {
      await directClient.tblestimate_requests.deleteMany({
        where: { email: { startsWith: MARKER } },
      });
      await client.tblestimate_request_status.deleteMany({
        where: { name: { startsWith: MARKER } },
      });
    };

    const create = (suffix: string) =>
      repository.create({
        name: `${MARKER}-${suffix}`,
        color: '#757575',
        statusorder: 1,
      });

    beforeEach(cleanup);

    afterAll(async () => {
      await cleanup();
      await directClient.$disconnect();
      await client.$disconnect();
    });

    it('creates, finds, and updates a status through the database', async () => {
      const row = await create('create-update');
      expect(row.id).toBeGreaterThan(0);
      expect(await repository.findById(row.id)).toEqual(row);
      await expect(repository.update(row.id, { name: `${MARKER}-updated` })).resolves.toMatchObject(
        {
          id: row.id,
          name: `${MARKER}-updated`,
        },
      );
      expect(await repository.findById(row.id)).toMatchObject({ name: `${MARKER}-updated` });
    });

    it('pages forward and backward and counts marker rows', async () => {
      await Promise.all([create('a'), create('b'), create('c')]);
      const query = {
        search: MARKER,
        sortField: 'name' as const,
        order: 'asc' as const,
        cursor: null,
        limit: 1,
      };
      const first = await repository.list(query);
      expect(first.items.map(({ name }) => name)).toEqual([`${MARKER}-a`]);
      expect(first.total).toBe(3);
      const second = await repository.list({
        ...query,
        cursor: decodeCursor(first.nextCursor, 'name'),
      });
      expect(second.items.map(({ name }) => name)).toEqual([`${MARKER}-b`]);
      const third = await repository.list({
        ...query,
        cursor: decodeCursor(second.nextCursor, 'name'),
      });
      expect(third.items.map(({ name }) => name)).toEqual([`${MARKER}-c`]);
      const previous = await repository.list({
        ...query,
        cursor: decodeCursor(third.prevCursor, 'name'),
      });
      expect(previous.items.map(({ name }) => name)).toEqual([`${MARKER}-b`]);
      await expect(repository.count(query)).resolves.toBe(3);
    });

    it('stores no more than the status name column length', async () => {
      const name = `${MARKER}-${'x'.repeat(60)}`;
      const row = await repository.create({
        name,
        color: null,
        statusorder: null,
      });
      expect(row.name).toBe(name.slice(0, 50));
      expect(row.name).toHaveLength(50);
    });

    it('counts a real estimate-request reference before deletion', async () => {
      const status = await create('referenced');
      const email = `${MARKER}-request@example.invalid`;
      await directClient.tblestimate_requests.create({
        data: {
          email,
          submission: '{}',
          default_language: 0,
          date_added: new Date(),
          status: status.id,
        },
      });
      await expect(repository.deleteReferenceCount(status.id)).resolves.toBe(1);
      await directClient.tblestimate_requests.deleteMany({ where: { email } });
      await expect(repository.remove(status.id)).resolves.toBe(true);
    });
  },
);
