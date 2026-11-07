import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaClient } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { HealthService } from '../../../shared/health/health.service.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import type { KnowledgeBaseGroupPage } from '../model/knowledge-base-groups.model.js';
import { KnowledgeBaseGroupsRepository } from '../repository/knowledge-base-groups.repository.js';
import { KnowledgeBaseGroupsService } from '../service/knowledge-base-groups.service.js';
import { KnowledgeBaseGroupsTransformer } from '../service/knowledge-base-groups.transformer.js';
import { KnowledgeBaseGroupsTransport } from '../service/knowledge-base-groups.transport.js';
import { KnowledgeBaseGroupsValidator } from '../service/knowledge-base-groups.validator.js';

const MARKER = 'int-spec-kb-groups';
const ADMIN: AuthenticatedUser = {
  staffId: 1,
  sessionId: 'kb-group-int-spec',
  jti: 'kb-group-int-spec',
  isAdmin: true,
  roleId: null,
  tokenVersion: 0,
  expiresAt: 4_102_444_800,
};

describe.skipIf(!process.env.DATABASE_URL)(
  'KnowledgeBaseGroupsRepository against the local mirror',
  () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (databaseUrl === undefined) {
      throw new Error('DATABASE_URL is required for this integration spec');
    }

    const prisma = new PrismaService(new AppConfig(), new HealthService());
    const repository = new KnowledgeBaseGroupsRepository(prisma);
    const unguarded = new PrismaClient({ datasourceUrl: databaseUrl });
    const events = new RecordingDomainEventPublisher();
    const logger = new LoggerService();
    const service = new KnowledgeBaseGroupsService(
      new KnowledgeBaseGroupsValidator(),
      repository,
      new KnowledgeBaseGroupsTransformer(),
      new KnowledgeBaseGroupsTransport(events),
      logger,
    );

    const createdGroupIds: number[] = [];
    const createdArticleIds: number[] = [];

    beforeAll(async () => {
      await unguarded.tblknowledge_base.deleteMany({
        where: { subject: { startsWith: MARKER } },
      });
      await prisma.client.tblknowledge_base_groups.deleteMany({
        where: { name: { startsWith: MARKER } },
      });
    });

    afterAll(async () => {
      if (createdArticleIds.length > 0) {
        await unguarded.tblknowledge_base.deleteMany({
          where: { articleid: { in: createdArticleIds } },
        });
      }
      if (createdGroupIds.length > 0) {
        await prisma.client.tblknowledge_base_groups.deleteMany({
          where: { groupid: { in: createdGroupIds } },
        });
      }
      await unguarded.$disconnect();
      await prisma.client.$disconnect();
    });

    it('creates, edits, applies slug rules, pages, and enforces delete refusal while group has articles', async () => {
      // 1. Create with Arabic letters: toSlug keeps Arabic letters
      const arabicName = `${MARKER}-قاعدة المعرفة`;
      const group1 = await service.createGroup(ADMIN, {
        name: arabicName,
        color: '#03a9f4',
        groupOrder: 1,
      });
      const id1 = Number(group1.id);
      createdGroupIds.push(id1);

      expect(group1.name).toBe(arabicName);
      expect(group1.groupSlug).toContain('قاعدة-المعرفة');
      expect(group1.groupSlug).not.toBe('');

      // 2. Perfex duplicate rule: another group with the same name appends -2
      const groupDuplicate = await service.createGroup(ADMIN, {
        name: arabicName,
        color: '#03a9f4',
        groupOrder: 2,
      });
      const idDup = Number(groupDuplicate.id);
      createdGroupIds.push(idDup);
      expect(groupDuplicate.groupSlug).toBe(`${group1.groupSlug ?? ''}-2`);

      // 3. Edit: renaming must NOT change the slug
      const renamed = await service.updateGroup(
        ADMIN,
        { id: String(id1) },
        { name: `${MARKER}-Renamed Group` },
      );
      expect(renamed.name).toBe(`${MARKER}-Renamed Group`);
      expect(renamed.groupSlug).toBe(group1.groupSlug);

      // Edit: explicit groupSlug edits the slug
      const slugEdited = await service.updateGroup(
        ADMIN,
        { id: String(id1) },
        { groupSlug: 'custom-edited-slug' },
      );
      expect(slugEdited.groupSlug).toBe('custom-edited-slug');

      // 4. Paging: list with keyset paging
      const firstPage = await service.listGroups(ADMIN, { q: MARKER, limit: '1' });
      expect(firstPage.data).toHaveLength(1);
      expect(firstPage.meta.total).toBe(2);
      expect(firstPage.meta.nextCursor).not.toBeNull();

      const secondPage = await service.listGroups(ADMIN, {
        q: MARKER,
        limit: '1',
        cursor: firstPage.meta.nextCursor ?? undefined,
      });
      expect(secondPage.data).toHaveLength(1);
      expect(secondPage.data[0]?.id).not.toBe(firstPage.data[0]?.id);
      expect(secondPage.meta.prevCursor).not.toBeNull();

      // Paging back using prevCursor
      const prevPage = await service.listGroups(ADMIN, {
        q: MARKER,
        limit: '1',
        cursor: secondPage.meta.prevCursor ?? undefined,
      });
      expect(prevPage.data).toHaveLength(1);
      expect(prevPage.data[0]?.id).toBe(firstPage.data[0]?.id);

      // 5. Delete refused while group has articles
      const article = await unguarded.tblknowledge_base.create({
        data: {
          articlegroup: id1,
          subject: `${MARKER}-Test Article`,
          description: 'Test content',
          slug: `${MARKER}-article-slug`,
          active: 1,
          datecreated: new Date(),
        },
      });
      createdArticleIds.push(article.articleid);

      await expect(service.removeGroup(ADMIN, { id: String(id1) })).rejects.toMatchObject({
        code: 'ERP-KNOWLEDGEBASEGROUPS-0001',
        message: 'The knowledge base group has articles and cannot be deleted',
      });

      // 6. Delete succeeds once articles are removed
      await unguarded.tblknowledge_base.delete({ where: { articleid: article.articleid } });
      const articleIndex = createdArticleIds.indexOf(article.articleid);
      if (articleIndex !== -1) createdArticleIds.splice(articleIndex, 1);

      await expect(service.removeGroup(ADMIN, { id: String(id1) })).resolves.toBeUndefined();
      expect(await repository.findById(id1)).toBeNull();

      // Clean up duplicate group
      await service.removeGroup(ADMIN, { id: String(idDup) });
      expect(await repository.findById(idDup)).toBeNull();
    });

    it('pages correctly when group_order contains null, negative, zero, and positive values', async () => {
      const testOrders = [null, null, -5, 0, 0, 3];
      const orderMarker = `${MARKER}-order-walk`;
      const createdOrderGroupIds: number[] = [];

      for (let i = 0; i < testOrders.length; i++) {
        const order = testOrders[i] ?? null;
        const row = await prisma.client.tblknowledge_base_groups.create({
          data: {
            name: `${orderMarker}-${String(i)}`,
            group_slug: `${orderMarker}-slug-${String(i)}`,
            description: null,
            active: 1,
            color: '#03a9f4',
            group_order: order,
          },
          select: { groupid: true },
        });
        createdOrderGroupIds.push(row.groupid);
        createdGroupIds.push(row.groupid);
      }

      // Walk every page with nextCursor in asc
      const ascWalkedIds: number[] = [];
      const ascPages: KnowledgeBaseGroupPage[] = [];
      let nextCursorAsc: string | null = null;

      do {
        const page: KnowledgeBaseGroupPage = await repository.list({
          search: orderMarker,
          sortField: 'groupOrder',
          order: 'asc',
          limit: 2,
          cursor: decodeCursor(nextCursorAsc, 'groupOrder'),
        });
        ascPages.push(page);
        for (const item of page.items) {
          ascWalkedIds.push(item.groupid);
        }
        nextCursorAsc = page.nextCursor;
      } while (nextCursorAsc !== null);

      expect(ascPages).toHaveLength(3);
      expect(ascWalkedIds).toHaveLength(6);
      expect(new Set(ascWalkedIds).size).toBe(6);
      for (const id of createdOrderGroupIds) {
        expect(ascWalkedIds).toContain(id);
      }

      // Use prevCursor from the last page and assert it gives the page before
      const lastAscPage = ascPages.at(-1);
      const secondAscPage = ascPages[1];
      expect(lastAscPage?.prevCursor).toBeDefined();
      expect(lastAscPage?.prevCursor).not.toBeNull();
      expect(secondAscPage).toBeDefined();
      if (!lastAscPage?.prevCursor || !secondAscPage) {
        throw new Error('expected at least 2 pages');
      }
      const prevAscPage = await repository.list({
        search: orderMarker,
        sortField: 'groupOrder',
        order: 'asc',
        limit: 2,
        cursor: decodeCursor(lastAscPage.prevCursor, 'groupOrder'),
      });
      expect(prevAscPage.items.map((r) => r.groupid)).toEqual(
        secondAscPage.items.map((r) => r.groupid),
      );

      // Walk every page with nextCursor in desc
      const descWalkedIds: number[] = [];
      const descPages: KnowledgeBaseGroupPage[] = [];
      let nextCursorDesc: string | null = null;

      do {
        const page: KnowledgeBaseGroupPage = await repository.list({
          search: orderMarker,
          sortField: 'groupOrder',
          order: 'desc',
          limit: 2,
          cursor: decodeCursor(nextCursorDesc, 'groupOrder'),
        });
        descPages.push(page);
        for (const item of page.items) {
          descWalkedIds.push(item.groupid);
        }
        nextCursorDesc = page.nextCursor;
      } while (nextCursorDesc !== null);

      expect(descPages).toHaveLength(3);
      expect(descWalkedIds).toHaveLength(6);
      expect(new Set(descWalkedIds).size).toBe(6);
      for (const id of createdOrderGroupIds) {
        expect(descWalkedIds).toContain(id);
      }

      // Use prevCursor from the last page and assert it gives the page before
      const lastDescPage = descPages.at(-1);
      const secondDescPage = descPages[1];
      expect(lastDescPage?.prevCursor).toBeDefined();
      expect(lastDescPage?.prevCursor).not.toBeNull();
      expect(secondDescPage).toBeDefined();
      if (!lastDescPage?.prevCursor || !secondDescPage) {
        throw new Error('expected at least 2 pages');
      }
      const prevDescPage = await repository.list({
        search: orderMarker,
        sortField: 'groupOrder',
        order: 'desc',
        limit: 2,
        cursor: decodeCursor(lastDescPage.prevCursor, 'groupOrder'),
      });
      expect(prevDescPage.items.map((r) => r.groupid)).toEqual(
        secondDescPage.items.map((r) => r.groupid),
      );
    });
  },
);
