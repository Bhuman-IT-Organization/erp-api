import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import type { TicketStatus } from '../model/ticket-statuses.model.js';
import { TicketStatusesRepository } from '../repository/ticket-statuses.repository.js';

const MARKER = `int-spec-ticket-status-${String(Date.now())}`;

describe.skipIf(!process.env.DATABASE_URL)(
  'TicketStatusesRepository against the local mirror',
  () => {
    const prisma = new PrismaService(new AppConfig(), new HealthService());
    const repository = new TicketStatusesRepository(prisma);
    let row: TicketStatus | undefined;

    beforeAll(async () => {
      await prisma.client.tbltickets_status.deleteMany({
        where: { name: { startsWith: MARKER } },
      });
      row = await repository.create({
        name: `${MARKER}-Open`,
        statuscolor: '#03a9f4',
        statusorder: 9001,
      });
    });

    afterAll(async () => {
      if (row !== undefined) await repository.remove(row.ticketstatusid);
      await prisma.client.$disconnect();
    });

    it('reads and writes the existing Prisma model without creating a table', async () => {
      if (row === undefined) throw new Error('integration row was not created');
      expect(row.isdefault).toBe(0);
      expect(await repository.findById(row.ticketstatusid)).toEqual(row);
      await expect(repository.hasTicketReferences(row.ticketstatusid)).resolves.toBe(false);
      await expect(
        repository.update(row.ticketstatusid, { statusorder: 9002 }),
      ).resolves.toMatchObject({
        statusorder: 9002,
      });
      expect(
        (await repository.list()).some((status) => status.ticketstatusid === row?.ticketstatusid),
      ).toBe(true);
    });
  },
);
