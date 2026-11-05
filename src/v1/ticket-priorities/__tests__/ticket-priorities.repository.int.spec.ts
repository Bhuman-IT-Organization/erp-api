/**
 * TicketPrioritiesRepository against the local mirror (DATABASE_URL from
 * ../erp-infra/env/local/api.host.env), and the service's delete refusal over it.
 *
 * `tbltickets_priorities` is node-owned, so the ownership guard admits the writes this spec makes
 * through the typed delegate. `tbltickets` is Perfex's, and the guard refuses even raw writes to it:
 * the one ticket this spec needs (a ticket that uses a test priority) is written by a plain client
 * standing in for Perfex, matched by its marker subject.
 *
 * Everything this spec writes it creates itself and deletes again: `tbltickets_priorities` rows whose
 * name starts with `MARKER` and the `tbltickets` row whose subject is `MARKER`, removed before the
 * run (a leftover of a crashed run) and after it. No seeded row is touched, and no value from the
 * local data is read into an assertion message: ids and counts are compared, never printed.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaClient } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { TICKET_PRIORITIES_NAME_MAX } from '../dto/ticket-priorities.dto.js';
import type {
  TicketPrioritiesListRequest,
  TicketPrioritiesPage,
  TicketPriority,
} from '../model/ticket-priorities.model.js';
import { TicketPrioritiesRepository } from '../repository/ticket-priorities.repository.js';
import { TicketPrioritiesService } from '../service/ticket-priorities.service.js';
import { TicketPrioritiesTransformer } from '../service/ticket-priorities.transformer.js';
import { TicketPrioritiesValidator } from '../service/ticket-priorities.validator.js';

/** Every row this spec creates carries this prefix, so the cleanup deletes exactly its own rows. */
const MARKER = 'int-spec-tp';

const numberSchema = z.union([z.bigint(), z.number()]).transform(Number);
const lengthSchema = z.tuple([z.object({ len: numberSchema })]);

const admin = { isAdmin: true, staffId: 1 } as AuthenticatedUser;

function request(
  overrides: Partial<TicketPrioritiesListRequest> = {},
): TicketPrioritiesListRequest {
  return { search: MARKER, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const ids = (page: TicketPrioritiesPage): number[] => page.items.map((row) => row.id);

describe.skipIf(!process.env.DATABASE_URL)(
  'TicketPrioritiesRepository against the local mirror',
  () => {
    const prisma = new PrismaService(new AppConfig(), new HealthService());
    const repository = new TicketPrioritiesRepository(prisma);
    const client = prisma.client;
    /**
     * Perfex's side of the fixture: `tbltickets` is perfex-core, so the guarded client refuses it.
     * This plain client stands in for Perfex and writes only the one marker ticket; the repository
     * and the service under test keep the guarded client.
     */
    const perfex = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL ?? '' });
    /** The real repository inside the real service; the transport and logger are inert. */
    const service = new TicketPrioritiesService(
      new TicketPrioritiesValidator(),
      repository,
      new TicketPrioritiesTransformer(),
      {
        publish: () => Promise.resolve(),
        emailPipingDefaultPriority: () => Promise.resolve(null),
      } as never,
      { log: () => undefined } as never,
    );
    let a: TicketPriority;
    let b: TicketPriority;
    let c: TicketPriority;
    /** The id of a row this spec created and deleted: guaranteed missing (ids are never reused). */
    let missingId = 0;

    /** Perfex's ticket, written by the plain client: `tbltickets` is perfex-core. */
    const insertTicket = (priority: number) =>
      perfex.$executeRaw`INSERT INTO tbltickets
        (adminreplying, userid, contactid, department, priority, status, ticketkey, subject, message, date, project_id, clientread, adminread, assigned)
        VALUES (0, 0, 0, 0, ${priority}, 1, ${MARKER}, ${MARKER}, '', NOW(), 0, 0, 0, 0)`;

    const deleteTickets = () =>
      perfex.$executeRaw`DELETE FROM tbltickets WHERE subject = ${MARKER}`;

    const cleanup = async () => {
      await deleteTickets();
      await client.tbltickets_priorities.deleteMany({ where: { name: { startsWith: MARKER } } });
    };

    const create = (suffix: string): Promise<TicketPriority> =>
      repository.create({ name: `${MARKER}-${suffix}` });

    beforeAll(async () => {
      await cleanup();
      c = await create('c');
      a = await create('a <b>');
      b = await create('b');
      const ghost = await create('ghost');
      missingId = ghost.id;
      await repository.remove(ghost.id);
    });

    afterAll(async () => {
      await cleanup();
      await client.$disconnect();
      await perfex.$disconnect();
    });

    it('create answers the database id; findById returns the row byte for byte; a missing id is null', async () => {
      expect(a.id).toBeGreaterThan(0);
      expect(await repository.findById(a.id)).toEqual({ id: a.id, name: `${MARKER}-a <b>` });
      expect(await repository.findById(missingId)).toBeNull();
    });

    it('update changes the name; a missing id is null', async () => {
      const updated = await repository.update(b.id, { name: `${MARKER}-b2` });
      expect(updated).toEqual({ id: b.id, name: `${MARKER}-b2` });
      expect(await repository.findById(b.id)).toEqual(updated);
      expect(await repository.update(missingId, { name: `${MARKER}-nobody` })).toBeNull();
    });

    it('three marker names page with limit 1 both ways under q, by name and by the id descending', async () => {
      const first = await repository.list(request({ limit: 1 }));
      expect(ids(first)).toEqual([a.id]);
      expect(first.total).toBe(3);
      const second = await repository.list(
        request({ limit: 1, cursor: decodeCursor(first.nextCursor, 'name') }),
      );
      expect(ids(second)).toEqual([b.id]);
      const third = await repository.list(
        request({ limit: 1, cursor: decodeCursor(second.nextCursor, 'name') }),
      );
      expect(ids(third)).toEqual([c.id]);
      expect(third.nextCursor).toBeNull();
      expect(third.rangeStart).toBe(3);
      const back = await repository.list(
        request({ limit: 1, cursor: decodeCursor(third.prevCursor, 'name') }),
      );
      expect(ids(back)).toEqual([b.id]);
      const byId = await repository.list(request({ sortField: 'id', order: 'desc' }));
      expect(ids(byId)).toEqual([b.id, a.id, c.id]);
      expect(await repository.count(request())).toBe(3);
    });

    it('CHARACTER_MAXIMUM_LENGTH of tbltickets_priorities.name equals TICKET_PRIORITIES_NAME_MAX', async () => {
      const rows = await client.$queryRaw<
        unknown[]
      >`SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbltickets_priorities' AND COLUMN_NAME = 'name'`;
      expect(lengthSchema.parse(rows)[0].len).toBe(TICKET_PRIORITIES_NAME_MAX);
    });

    it('listAll reads the marker rows by name ascending', async () => {
      const own = (await repository.listAll()).filter((row) => row.name.startsWith(MARKER));
      expect(own.map((row) => row.id)).toEqual([a.id, b.id, c.id]);
    });

    it('a ticket using a priority: isReferenced is true, and the delete is refused with 409 ERP-TICKETPRIORITIES-0001; the row stays', async () => {
      expect(await repository.isReferenced(c.id)).toBe(false);
      await insertTicket(c.id);
      try {
        expect(await repository.isReferenced(c.id)).toBe(true);
        await expect(service.remove(admin, { id: c.id })).rejects.toMatchObject({
          code: 'ERP-TICKETPRIORITIES-0001',
        });
        expect(await repository.findById(c.id)).toEqual(c);
      } finally {
        await deleteTickets();
      }
      expect(await repository.isReferenced(c.id)).toBe(false);
    });

    it('remove answers true, then the row is gone, then false; 0 marker rows remain after the cleanup', async () => {
      expect(await repository.remove(c.id)).toBe(true);
      expect(await repository.findById(c.id)).toBeNull();
      expect(await repository.remove(c.id)).toBe(false);
      await cleanup();
      expect(
        await client.tbltickets_priorities.count({ where: { name: { startsWith: MARKER } } }),
      ).toBe(0);
    });
  },
);
