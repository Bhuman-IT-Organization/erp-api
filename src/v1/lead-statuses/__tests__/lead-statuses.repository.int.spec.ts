/**
 * LeadStatusesRepository integration tests against local MySQL.
 * Only temporary test-created rows are changed or deleted.
 */

import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { LeadStatusesRepository } from '../repository/lead-statuses.repository.js';

const MARKER = 'int-spec-lead-statuses-20261023';
const COLOR = '#123456';
const UPDATED_COLOR = '#654321';

describe.skipIf(!process.env.DATABASE_URL)('LeadStatusesRepository against local MySQL', () => {
  let prisma: PrismaService | undefined;
  let repository: LeadStatusesRepository;
  let client: PrismaService['client'];

  const cleanup = async (): Promise<void> => {
    if (prisma === undefined) return;

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

    client = prisma.client;
    repository = new LeadStatusesRepository(prisma);

    await cleanup();
  });

  afterAll(async () => {
    try {
      await cleanup();
    } finally {
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
      emailIntegration: 0,
    });

    expect(
      await client.tblleads_status.findUnique({
        where: { id: created.id },
      }),
    ).not.toBeNull();
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
