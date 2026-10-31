/**
 * LeadStatusesRepository integration tests against local MySQL.
 * Only temporary test-created rows are changed or deleted.
 */

import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaClient } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { LeadStatusesRepository } from '../repository/lead-statuses.repository.js';
import { LeadStatusesService } from '../service/lead-statuses.service.js';

const MARKER = 'int-spec-lead-statuses-20261023';
const COLOR = '#123456';
const UPDATED_COLOR = '#654321';

describe.skipIf(!process.env.DATABASE_URL)('LeadStatusesRepository against local MySQL', () => {
  let prisma: PrismaService | undefined;
  let fixtureClient: PrismaClient | undefined;
  let repository: LeadStatusesRepository;
  let service: LeadStatusesService;
  let client: PrismaService['client'];

  const getFixtureClient = (): PrismaClient => {
    if (fixtureClient === undefined) {
      throw new Error('Integration-test fixture client is not initialized');
    }

    return fixtureClient;
  };

  const admin = {
    isAdmin: true,
  } as unknown as Parameters<LeadStatusesService['remove']>[0];

  // Only the methods used by remove() are needed here.
  // The repository itself uses the real MySQL database.
  const createService = (realRepository: LeadStatusesRepository): LeadStatusesService => {
    const validator = {
      parseParams: (params: unknown) => ({
        id: Number((params as { id: unknown }).id),
      }),
    };

    const transformer = {};

    const transport = {
      configuredDefaultStatus: () => Promise.resolve(null),
      publish: () => Promise.resolve(),
    };

    const logger = {
      log: () => undefined,
    };

    return new LeadStatusesService(
      validator as unknown as ConstructorParameters<typeof LeadStatusesService>[0],
      realRepository,
      transformer as unknown as ConstructorParameters<typeof LeadStatusesService>[2],
      transport as unknown as ConstructorParameters<typeof LeadStatusesService>[3],
      logger as unknown as ConstructorParameters<typeof LeadStatusesService>[4],
    );
  };

  const cleanup = async (): Promise<void> => {
    if (prisma === undefined || fixtureClient === undefined) {
      return;
    }

    // Remove test-created legacy lead records first.
    // This direct client is only for integration-test fixtures.
    await fixtureClient.tblleads.deleteMany({
      where: {
        name: {
          startsWith: MARKER,
        },
      },
    });

    // Remove test-created legacy email-integration records.
    await fixtureClient.tblleads_email_integration.deleteMany({
      where: {
        email: {
          startsWith: MARKER,
        },
      },
    });

    // Delete test statuses last, using the guarded Node client.
    await prisma.client.tblleads_status.deleteMany({
      where: {
        name: {
          startsWith: MARKER,
        },
      },
    });
  };

  beforeAll(async () => {
    prisma = new PrismaService(new AppConfig(), new HealthService());

    // Separate client for test fixtures in legacy-owned tables.
    // DATABASE_URL must point to your local integration-test database.
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }

    fixtureClient = new PrismaClient({
      datasourceUrl: databaseUrl,
    });

    await fixtureClient.$connect();

    // The application repository continues using the guarded client.
    client = prisma.client;
    repository = new LeadStatusesRepository(prisma);
    service = createService(repository);

    await cleanup();
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
      if (fixtureClient !== undefined) {
        await fixtureClient.$disconnect();
      }

      if (prisma !== undefined) {
        await prisma.client.$disconnect();
      }
    }
  });

  it('creates and reads a lead status', async () => {
    const created = await repository.create({
      name: `${MARKER}-create`,
      color: COLOR,
      statusorder: 101,
    });

    expect(created.id).toBeGreaterThan(0);

    expect(created).toMatchObject({
      name: `${MARKER}-create`,
      color: COLOR,
      statusorder: 101,
      isdefault: 0,
    });

    expect(await repository.findById(created.id)).toEqual(created);
  });

  it('updates an existing lead status', async () => {
    const created = await repository.create({
      name: `${MARKER}-update`,
      color: COLOR,
      statusorder: 102,
    });

    const updated = await repository.update(created.id, {
      name: `${MARKER}-updated`,
      color: UPDATED_COLOR,
      statusorder: 103,
    });

    expect(updated).toMatchObject({
      id: created.id,
      name: `${MARKER}-updated`,
      color: UPDATED_COLOR,
      statusorder: 103,
    });

    expect(await repository.findById(created.id)).toEqual(updated);
  });

  it('reads statuses through repository methods', async () => {
    const created = await repository.create({
      name: `${MARKER}-list`,
      color: COLOR,
      statusorder: 104,
    });

    const all = await repository.listAll();

    expect(all.some((row) => row.id === created.id)).toBe(true);

    const selected = await repository.findByIds([created.id]);

    expect(selected).toContainEqual(created);
  });

  it('returns zero usage for a new status', async () => {
    const created = await repository.create({
      name: `${MARKER}-usage`,
      color: COLOR,
      statusorder: 105,
    });

    const usage = await repository.usageByStatus(created.id);

    expect(usage).toEqual({
      leads: 0,
      lastLeadStatus: 0,
      emailIntegration: 0,
      webToLead: 0,
    });

    expect(
      await client.tblleads_status.findUnique({
        where: { id: created.id },
      }),
    ).not.toBeNull();
  });

  it('blocks deletion when an actual lead references the status', async () => {
    const status = await repository.create({
      name: `${MARKER}-lead-reference`,
      color: COLOR,
      statusorder: 107,
    });

    await getFixtureClient().tblleads.create({
      data: {
        name: `${MARKER}-lead-${String(status.id)}`,
        dateadded: new Date(),
        status: status.id,
        source: 0,
        addedfrom: 0,
      },
    });

    // Confirm that the real database record is counted.
    await expect(repository.usageByStatus(status.id)).resolves.toEqual({
      leads: 1,
      lastLeadStatus: 0,
      emailIntegration: 0,
      webToLead: 0,
    });

    // The service must refuse to delete the referenced status.
    await expect(service.remove(admin, { id: String(status.id) })).rejects.toMatchObject({
      code: 'ERP-LEADSTATUSES-0001',
    });

    expect(await repository.findById(status.id)).not.toBeNull();
  });

  it('blocks deletion when an actual email-integration record references the status', async () => {
    const status = await repository.create({
      name: `${MARKER}-email-reference`,
      color: COLOR,
      statusorder: 108,
    });

    await getFixtureClient().tblleads_email_integration.create({
      data: {
        active: 1,
        email: `${MARKER}-email-${String(status.id)}@example.test`,
        imap_server: 'localhost',
        password: 'integration-test-only',
        responsible: 0,
        lead_source: 0,
        lead_status: status.id,
        folder: 'INBOX',
      },
    });

    // Confirm that the real database record is counted.
    await expect(repository.usageByStatus(status.id)).resolves.toEqual({
      leads: 0,
      lastLeadStatus: 0,
      emailIntegration: 1,
      webToLead: 0,
    });

    // The service must refuse to delete the referenced status.
    await expect(service.remove(admin, { id: String(status.id) })).rejects.toMatchObject({
      code: 'ERP-LEADSTATUSES-0001',
    });

    expect(await repository.findById(status.id)).not.toBeNull();
  });

  it('deletes a status created by this test', async () => {
    const created = await repository.create({
      name: `${MARKER}-delete`,
      color: COLOR,
      statusorder: 106,
    });

    expect(await repository.remove(created.id)).toBe(true);

    expect(await repository.findById(created.id)).toBeNull();

    expect(await repository.remove(created.id)).toBe(false);
  });
});
