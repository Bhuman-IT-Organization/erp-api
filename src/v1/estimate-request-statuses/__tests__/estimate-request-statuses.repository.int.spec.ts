import 'reflect-metadata';
import { afterAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { EstimateRequestStatusesRepository } from '../repository/estimate-request-statuses.repository.js';

describe.skipIf(!process.env.DATABASE_URL)(
  'EstimateRequestStatusesRepository against the configured database',
  () => {
    const prisma = new PrismaService(new AppConfig(), new HealthService());
    const repository = new EstimateRequestStatusesRepository(prisma);

    afterAll(async () => {
      await prisma.client.$disconnect();
    });

    it('discovers and queries both status reference columns from information_schema', async () => {
      await expect(repository.deleteReferenceCount(4_294_967_295)).resolves.toBeTypeOf('number');
    });
  },
);
