import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaClient } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { HealthService } from '../../../shared/health/health.service.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { FakeSettingsFacade } from '../../settings/__tests__/fakes.js';
import type { SettingsFacade } from '../../settings/index.js';
import type { TicketStatus } from '../model/ticket-statuses.model.js';
import { TicketStatusesRepository } from '../repository/ticket-statuses.repository.js';
import { TicketStatusesService } from '../service/ticket-statuses.service.js';
import { TicketStatusesTransformer } from '../service/ticket-statuses.transformer.js';
import { TicketStatusesTransport } from '../service/ticket-statuses.transport.js';
import { TicketStatusesValidator } from '../service/ticket-statuses.validator.js';

const MARKER = `int-spec-ticket-status-${String(Date.now())}`;
const ADMIN: AuthenticatedUser = {
  staffId: 1,
  sessionId: 'ticket-status-int-spec',
  jti: 'ticket-status-int-spec',
  isAdmin: true,
  roleId: null,
  tokenVersion: 0,
  expiresAt: 4_102_444_800,
};

describe.skipIf(!process.env.DATABASE_URL)(
  'TicketStatusesRepository against the local mirror',
  () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined)
      throw new Error('DATABASE_URL is required for this integration spec');
    const prisma = new PrismaService(new AppConfig(), new HealthService());
    const repository = new TicketStatusesRepository(prisma);
    const unguarded = new PrismaClient({ datasourceUrl: databaseUrl });
    const service = new TicketStatusesService(
      new TicketStatusesValidator(),
      repository,
      new TicketStatusesTransformer(),
      new TicketStatusesTransport(
        new RecordingDomainEventPublisher(),
        new FakeSettingsFacade() as unknown as SettingsFacade,
      ),
      new LoggerService(),
    );
    let row: TicketStatus | undefined;
    let ticketId: number | undefined;

    beforeAll(async () => {
      await prisma.client.tbltickets_status.deleteMany({
        where: { name: { startsWith: MARKER } },
      });
      await unguarded.tbltickets.deleteMany({
        where: { subject: { startsWith: MARKER } },
      });
      row = await repository.create({
        name: `${MARKER}-Open`,
        statuscolor: '#03a9f4',
        statusorder: 9001,
      });
      const status = row;
      ticketId = (
        await unguarded.tbltickets.create({
          data: {
            userid: 1,
            department: 1,
            priority: 1,
            status: status.ticketstatusid,
            ticketkey: `${MARKER}-key`,
            subject: `${MARKER}-subject`,
            message: 'test',
            date: new Date(),
            email: 'test@example.com',
            name: 'Test',
          },
        })
      ).ticketid;
      const found = await repository.findById(status.ticketstatusid);
      if (found === null) throw new Error('integration status disappeared after ticket creation');
      row = found;
    });

    afterAll(async () => {
      if (ticketId !== undefined) {
        await unguarded.tbltickets.deleteMany({ where: { ticketid: ticketId } });
      }
      if (row !== undefined) await repository.remove(row.ticketstatusid);
      await unguarded.$disconnect();
      await prisma.client.$disconnect();
    });

    it('reads and writes the existing Prisma model without creating a table', async () => {
      if (row === undefined) throw new Error('integration row was not created');
      expect(row.isdefault).toBe(0);
      expect(await repository.findById(row.ticketstatusid)).toEqual(row);
      await expect(repository.hasTicketReferences(row.ticketstatusid)).resolves.toBe(true);
      await expect(service.remove(ADMIN, { id: String(row.ticketstatusid) })).rejects.toMatchObject(
        {
          code: 'ERP-TICKETSTATUSES-0001',
          message: 'is_referenced',
        },
      );
      await expect(
        repository.update(row.ticketstatusid, { statusorder: 9002 }),
      ).resolves.toMatchObject({
        statusorder: 9002,
      });
      expect(
        (await repository.list()).items.some(
          (status) => status.ticketstatusid === row?.ticketstatusid,
        ),
      ).toBe(true);
    });
  },
);
