/**
 * PredefinedRepliesRepository against the local database.
 * All created rows use a unique marker and are cleaned up after the test.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import type {
  PredefinedRepliesListRequest,
  PredefinedRepliesPage,
  PredefinedReply,
} from '../model/predefined-replies.model.js';
import { PredefinedRepliesRepository } from '../repository/predefined-replies.repository.js';

const MARKER = 'int-spec-predefined-replies-2026';
const MESSAGE_TOKEN = 'unique-predefined-reply-message-token';

function request(
  overrides: Partial<PredefinedRepliesListRequest> = {},
): PredefinedRepliesListRequest {
  return {
    search: MARKER,
    sortField: 'name',
    order: 'asc',
    cursor: null,
    limit: 25,
    ...overrides,
  };
}

const ids = (page: PredefinedRepliesPage): number[] => page.items.map((row) => row.id);

describe.skipIf(!process.env.DATABASE_URL)(
  'PredefinedRepliesRepository against the database',
  () => {
    const prisma = new PrismaService(new AppConfig(), new HealthService());
    const repository = new PredefinedRepliesRepository(prisma);
    let a: PredefinedReply;
    let b: PredefinedReply;
    let c: PredefinedReply;
    let missingId = 0;

    const cleanup = () =>
      prisma.client.tbltickets_predefined_replies.deleteMany({
        where: { name: { startsWith: MARKER } },
      });

    beforeAll(async () => {
      await cleanup();
      a = await repository.create({
        name: `${MARKER}-a`,
        message: 'First test reply',
      });
      b = await repository.create({
        name: `${MARKER}-b`,
        message: 'Second test reply',
      });
      c = await repository.create({
        name: `${MARKER}-c`,
        message: MESSAGE_TOKEN,
      });

      const ghost = await repository.create({
        name: `${MARKER}-ghost`,
        message: 'Temporary row',
      });
      missingId = ghost.id;
      await repository.remove(ghost.id);
    });

    afterAll(async () => {
      try {
        await cleanup();
      } finally {
        await prisma.client.$disconnect();
      }
    });

    it('creates rows and reads the stored values', async () => {
      expect(a.id).toBeGreaterThan(0);
      expect(await repository.findById(a.id)).toEqual({
        id: a.id,
        name: `${MARKER}-a`,
        message: 'First test reply',
      });
      expect(await repository.findById(missingId)).toBeNull();
    });

    it('lists matching rows in ascending and descending name order', async () => {
      expect(ids(await repository.list(request()))).toEqual([a.id, b.id, c.id]);
      expect(ids(await repository.list(request({ order: 'desc' })))).toEqual([c.id, b.id, a.id]);
      expect((await repository.list(request())).total).toBe(3);
    });

    it('paginates with a next cursor and a previous cursor', async () => {
      const first = await repository.list(request({ limit: 2 }));
      expect(ids(first)).toEqual([a.id, b.id]);

      const nextCursor = decodeCursor(first.nextCursor, 'name');
      expect(nextCursor).not.toBeNull();

      const second = await repository.list(request({ limit: 2, cursor: nextCursor }));
      expect(ids(second)).toEqual([c.id]);
      expect(second.rangeStart).toBe(3);

      const previousCursor = decodeCursor(second.prevCursor, 'name');
      expect(previousCursor).not.toBeNull();

      const back = await repository.list(request({ limit: 2, cursor: previousCursor }));
      expect(ids(back)).toEqual([a.id, b.id]);
      expect(back.rangeStart).toBe(1);
    });

    it('searches the message as well as the name', async () => {
      const page = await repository.list({
        ...request(),
        search: MESSAGE_TOKEN,
      });
      expect(ids(page)).toEqual([c.id]);
    });

    it('updates a row and returns null for a missing id', async () => {
      expect(
        await repository.update(b.id, {
          name: `${MARKER}-b-updated`,
          message: 'Updated test reply',
        }),
      ).toEqual({
        id: b.id,
        name: `${MARKER}-b-updated`,
        message: 'Updated test reply',
      });

      expect(
        await repository.update(missingId, {
          name: `${MARKER}-missing`,
          message: 'Does not exist',
        }),
      ).toBeNull();
    });

    it('removes a row and confirms it no longer exists', async () => {
      expect(await repository.remove(c.id)).toBe(true);
      expect(await repository.findById(c.id)).toBeNull();
      expect(await repository.remove(c.id)).toBe(false);
    });
  },
);
