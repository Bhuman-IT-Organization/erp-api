/**
 * KnowledgeBaseRepository against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * `tblknowledge_base` is node-owned, so the ownership guard admits the writes this
 * spec makes through the typed delegate.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { KnowledgeBaseRepository } from '../repository/knowledge-base.repository.js';

describe.skipIf(!process.env.DATABASE_URL)(
  'KnowledgeBaseRepository against the local database',
  () => {
    let prisma: PrismaService;
    let repo: KnowledgeBaseRepository;

    beforeAll(() => {
      prisma = new PrismaService(new AppConfig(), new HealthService());
      repo = new KnowledgeBaseRepository(prisma);
    });

    afterAll(async () => {
      await prisma.onModuleDestroy();
    });

    it('instantiates repository correctly against PrismaService', () => {
      expect(repo).toBeDefined();
      expect(repo).toBeInstanceOf(KnowledgeBaseRepository);
    });
  },
);
