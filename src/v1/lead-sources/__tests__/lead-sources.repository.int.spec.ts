import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaClient } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type { LeadSourcesListRequest } from '../model/lead-sources.model.js';
import { LeadSourcesRepository } from '../repository/lead-sources.repository.js';
import { LeadSourcesService } from '../service/lead-sources.service.js';
import { LeadSourcesTransformer } from '../service/lead-sources.transformer.js';
import { LeadSourcesTransport } from '../service/lead-sources.transport.js';
import { LeadSourcesValidator } from '../service/lead-sources.validator.js';

const MARKER = 'int-spec-lead-sources-2026-10';

function request(overrides: Partial<LeadSourcesListRequest> = {}): LeadSourcesListRequest {
  return { search: MARKER, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

describe.skipIf(!process.env.DATABASE_URL)('LeadSourcesRepository against the local mirror', () => {
  const config = new AppConfig();
  const service = new PrismaService(config, new HealthService());
  const fixtureClient = new PrismaClient({ datasourceUrl: config.env.DATABASE_URL });
  const repository = new LeadSourcesRepository(service);
  let createdIds: number[] = [];

  const cleanup = () =>
    service.client.tblleads_sources.deleteMany({ where: { name: { startsWith: MARKER } } });
  const cleanupReferences = async () =>
    Promise.all([
      fixtureClient.tblleads.deleteMany({ where: { name: { startsWith: MARKER } } }),
      fixtureClient.tblleads_email_integration.deleteMany({
        where: { email: { startsWith: MARKER } },
      }),
      fixtureClient.tblweb_to_lead.deleteMany({ where: { name: { startsWith: MARKER } } }),
    ]);
  const create = (name: string) => repository.create({ name: `${MARKER}-${name}` });

  beforeAll(async () => {
    await cleanupReferences();
    await cleanup();
    const rows = await Promise.all([create('c'), create('a'), create('b')]);
    createdIds = rows.map((row) => row.id);
  });

  afterAll(async () => {
    await cleanupReferences();
    await cleanup();
    await Promise.all([fixtureClient.$disconnect(), service.client.$disconnect()]);
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

  it('counts all real reference rows and refuses to delete a source they use', async () => {
    const id = createdIds[0];
    if (id === undefined) throw new Error('expected a row created by this spec');
    const leadIds: number[] = [];
    const emailIntegrationIds: number[] = [];
    const webToLeadIds: number[] = [];
    const cleanupCreatedReferences = async () =>
      Promise.all([
        fixtureClient.tblleads.deleteMany({ where: { id: { in: leadIds } } }),
        fixtureClient.tblleads_email_integration.deleteMany({
          where: { id: { in: emailIntegrationIds } },
        }),
        fixtureClient.tblweb_to_lead.deleteMany({ where: { id: { in: webToLeadIds } } }),
      ]);

    try {
      const lead = await fixtureClient.tblleads.create({
        data: {
          name: `${MARKER}-lead`,
          dateadded: new Date(),
          status: 0,
          source: id,
          addedfrom: 0,
        },
        select: { id: true },
      });
      leadIds.push(lead.id);

      const emailIntegration = await fixtureClient.tblleads_email_integration.create({
        data: {
          active: 0,
          email: `${MARKER}@example.invalid`,
          imap_server: 'localhost',
          password: '',
          responsible: 0,
          lead_source: id,
          lead_status: 0,
          folder: 'INBOX',
        },
        select: { id: true },
      });
      emailIntegrationIds.push(emailIntegration.id);

      const webToLead = await fixtureClient.tblweb_to_lead.create({
        data: {
          form_key: MARKER.slice(-32),
          lead_source: id,
          lead_status: 0,
          name: `${MARKER}-form`,
          dateadded: new Date(),
        },
        select: { id: true },
      });
      webToLeadIds.push(webToLead.id);

      await expect(repository.usageByLeadSource([id])).resolves.toEqual(
        new Map([[id, { leads: 3 }]]),
      );

      const testService = new LeadSourcesService(
        new LeadSourcesValidator(),
        repository,
        new LeadSourcesTransformer(),
        new LeadSourcesTransport(new RecordingDomainEventPublisher(), {
          getOption: () => Promise.resolve(null),
        }),
        new LoggerService(),
      );
      const error = await testService
        .remove(
          {
            staffId: 1,
            sessionId: 'lead-source-int-spec',
            jti: 'lead-source-int-spec',
            isAdmin: true,
            roleId: null,
            tokenVersion: 0,
            expiresAt: 4_102_444_800,
          },
          { id: String(id) },
        )
        .then(
          () => null,
          (reason: unknown) => reason,
        );
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: 'ERP-LEADSOURCES-0001',
        status: 409,
        message: 'used by 3 lead(s)',
      });
      await expect(repository.findById(id)).resolves.not.toBeNull();
    } finally {
      await cleanupCreatedReferences();
    }
  });
});
