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
    let rows: TicketStatus[] = [];
    const ticketIds: number[] = [];

    beforeAll(async () => {
      await prisma.client.tbltickets_status.deleteMany({
        where: { name: { startsWith: MARKER } },
      });
      await unguarded.tbltickets.deleteMany({
        where: { subject: { startsWith: MARKER } },
      });
      const first = await repository.create({
        name: `${MARKER}-Open`,
        statuscolor: '#03a9f4',
        statusorder: 9001,
      });
      const second = await repository.create({
        name: `${MARKER}-Closed`,
        statuscolor: '#777777',
        statusorder: 9002,
      });
      rows = [first, second];
      for (const status of rows) {
        const ticket = await unguarded.tbltickets.create({
          data: {
            userid: 1,
            department: 1,
            priority: 1,
            status: status.ticketstatusid,
            ticketkey: `${MARKER}-${String(status.ticketstatusid)}-key`,
            subject: `${MARKER}-${String(status.ticketstatusid)}-subject`,
            message: 'test',
            date: new Date(),
            email: 'test@example.com',
            name: 'Test',
          },
        });
        ticketIds.push(ticket.ticketid);
      }
      rows = await Promise.all(
        rows.map(async (status) => {
          const found = await repository.findById(status.ticketstatusid);
          if (found === null) {
            throw new Error('integration status disappeared after ticket creation');
          }
          return found;
        }),
      );
    });

    afterAll(async () => {
      if (ticketIds.length > 0) {
        await unguarded.tbltickets.deleteMany({ where: { ticketid: { in: ticketIds } } });
      }
      for (const status of rows) await repository.remove(status.ticketstatusid);
      await unguarded.$disconnect();
      await prisma.client.$disconnect();
    });

    it('lists, searches, pages, and counts ticket references against the database', async () => {
      if (rows.length !== 2) throw new Error('integration rows were not created');
      const [open, closed] = rows;
      if (open === undefined || closed === undefined) {
        throw new Error('integration rows were not created');
      }
      expect(open.isdefault).toBe(0);
      expect(await repository.findById(open.ticketstatusid)).toEqual(open);
      await expect(repository.hasTicketReferences(open.ticketstatusid)).resolves.toBe(true);
      await expect(
        service.remove(ADMIN, { id: String(open.ticketstatusid) }),
      ).rejects.toMatchObject({
        code: 'ERP-TICKETSTATUSES-0001',
        message: 'is_referenced',
      });
      await expect(
        repository.update(open.ticketstatusid, { statusorder: 9003 }),
      ).resolves.toMatchObject({
        statusorder: 9003,
      });
      const firstPage = await service.list(ADMIN, { q: MARKER, limit: '1' });
      expect(firstPage.data).toHaveLength(1);
      expect(firstPage.data[0]?.name).toContain(MARKER);
      expect(firstPage.meta.total).toBe(2);
      expect(firstPage.meta.nextCursor).toEqual(expect.any(String));
      const secondPage = await service.list(ADMIN, {
        q: MARKER,
        limit: '1',
        cursor: firstPage.meta.nextCursor ?? undefined,
      });
      expect(secondPage.data).toHaveLength(1);
      expect(secondPage.data[0]?.ticketstatusid).not.toBe(firstPage.data[0]?.ticketstatusid);
      const search = await service.list(ADMIN, { q: `${MARKER}-Open` });
      expect(search.data.map((status) => status.name)).toEqual([open.name]);
      const listedOpen =
        firstPage.data.find((status) => status.ticketstatusid === String(open.ticketstatusid)) ??
        secondPage.data.find((status) => status.ticketstatusid === String(open.ticketstatusid));
      expect(listedOpen?.ticket_count).toBe(
        await unguarded.tbltickets.count({ where: { status: open.ticketstatusid } }),
      );
    });
  },
);
