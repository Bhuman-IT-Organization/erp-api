/**
 * ServicesRepository against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * `tblservices` is node-owned (`ownership.json`), so the ownership guard admits the writes this spec
 * makes through the typed delegate. `tbltickets` is Perfex-owned: the module's client (guarded) only
 * reads it. The ONE ticket the refusal test needs is a fixture row, inserted and deleted through a
 * plain `PrismaClient` (`fixtures`) that is outside the ownership guard, because the guard rightly
 * refuses every write to a table another owner holds, raw SQL included. That connection is the test's
 * own seam and the module never uses it. The ticket's required columns are read from
 * information_schema, never hard-coded, so the spec stays true when a slice changes the table.
 *
 * Everything this spec writes it creates itself and deletes again: `tblservices` rows whose name
 * starts with `MARKER` or `TICKET_MARKER`, and `tbltickets` rows whose subject starts with
 * `TICKET_MARKER`, removed before the run (a leftover of a crashed run) and after it (tickets first,
 * so a service is never deleted while a ticket still uses it). No other table is written, no seeded
 * row is touched, and no value from the local data is read into an assertion message: ids and counts
 * are compared, never printed, and every name asserted is one this spec wrote.
 */
import 'reflect-metadata';
import { PrismaClient } from '../../../shared/db/generated/client.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { AppError } from '../../../shared/errors/app-error.js';
import { HealthService } from '../../../shared/health/health.service.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import type { LoggerService } from '../../../shared/logger/logger.service.js';
import { SERVICES_NAME_MAX } from '../dto/services.dto.js';
import type { ServiceRow, ServicesListRequest, ServicesPage } from '../model/services.model.js';
import { ServicesRepository } from '../repository/services.repository.js';
import { ServicesService } from '../service/services.service.js';
import { ServicesTransformer } from '../service/services.transformer.js';
import type { ServicesTransport } from '../service/services.transport.js';
import { ServicesValidator } from '../service/services.validator.js';

/** Every list/page row this spec creates carries this prefix, so the cleanup deletes exactly its own rows. */
const MARKER = 'int-spec-svc';

/**
 * The ticket test's own prefix. It does not start with `MARKER`, so its service and ticket never
 * appear in the paging tests (which search `q=MARKER`), whatever order the cleanups run in.
 */
const TICKET_MARKER = 'int-spec-tkt';

/** An administrator, as the service's `assertAdministrator` reads it. */
const ADMIN = { isAdmin: true, staffId: 1 } as unknown as AuthenticatedUser;

const numberSchema = z.union([z.bigint(), z.number()]).transform(Number);
const lengthSchema = z.tuple([z.object({ len: numberSchema })]);
const columnSchema = z.array(
  z.object({
    COLUMN_NAME: z.string(),
    DATA_TYPE: z.string(),
    COLUMN_TYPE: z.string(),
  }),
);

function request(overrides: Partial<ServicesListRequest> = {}): ServicesListRequest {
  return { search: MARKER, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const ids = (page: ServicesPage): number[] => page.items.map((row) => row.id);

/** A dummy value of the column's type, so a NOT NULL column with no default is satisfied. */
function dummyOf(type: string, columnType: string): string | number {
  if (/int|decimal|float|double|bit/.test(type)) return 0;
  if (type === 'date') return '2026-01-01';
  if (type === 'datetime' || type === 'timestamp') return '2026-01-01 00:00:00';
  if (type === 'enum') return /'([^']*)'/.exec(columnType)?.[1] ?? '';
  return '';
}

describe.skipIf(!process.env.DATABASE_URL)('ServicesRepository against the local mirror', () => {
  const service = new PrismaService(new AppConfig(), new HealthService());
  const repository = new ServicesRepository(service);
  const client = service.client;

  /** The real service over the real repository: its refusal rule runs against the real tables. */
  const serviceOf = (): ServicesService =>
    new ServicesService(
      new ServicesValidator(),
      repository,
      new ServicesTransformer(),
      { publish: () => Promise.resolve() } as unknown as ServicesTransport,
      { log: () => undefined } as unknown as LoggerService,
    );

  /** Closes the one connection after BOTH describes below have run. */
  afterAll(async () => {
    await service.client.$disconnect();
  });

  describe('the list, the writes and the reads', () => {
    let a: ServiceRow;
    let b: ServiceRow;
    let c: ServiceRow;
    /** The id of a row this spec created and deleted: guaranteed missing (ids are never reused). */
    let missingId = 0;

    const cleanup = () =>
      client.tblservices.deleteMany({ where: { name: { startsWith: MARKER } } });

    const create = (suffix: string): Promise<ServiceRow> =>
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
    });

    it('create answers the database id; findById returns the row byte for byte', async () => {
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
      const idFirst = await repository.list(request({ sortField: 'id', order: 'desc', limit: 1 }));
      const idNext = await repository.list(
        request({
          sortField: 'id',
          order: 'desc',
          limit: 1,
          cursor: decodeCursor(idFirst.nextCursor, 'id'),
        }),
      );
      expect(ids(idNext)).toEqual([a.id]);
      expect(await repository.count(request())).toBe(3);
    });

    it('q as an id matches the id; an all-digit q up to INT max runs', async () => {
      expect(ids(await repository.list(request({ search: String(c.id) })))).toContain(c.id);
      await expect(repository.count(request({ search: '2147483647' }))).resolves.toBeTypeOf(
        'number',
      );
    });

    it('CHARACTER_MAXIMUM_LENGTH of tblservices.name equals SERVICES_NAME_MAX', async () => {
      const rows = await client.$queryRaw<
        unknown[]
      >`SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblservices' AND COLUMN_NAME = 'name'`;
      expect(lengthSchema.parse(rows)[0].len).toBe(SERVICES_NAME_MAX);
    });

    it('countTickets equals an independent count of tbltickets.service; the marker rows are used by no ticket', async () => {
      for (const row of [a, c]) {
        expect(await repository.countTickets(row.id)).toBe(
          await client.tbltickets.count({ where: { service: row.id } }),
        );
        expect(await repository.countTickets(row.id)).toBe(0);
      }
      expect(await repository.countTickets(missingId)).toBe(0);
    });

    it('listAll and findByIds read the marker rows as stored', async () => {
      const own = (await repository.listAll())
        .filter((row) => row.name.startsWith(MARKER))
        .map((row) => row.id);
      expect(own).toEqual([a.id, b.id, c.id]);
      const picked = await repository.findByIds([c.id, missingId, a.id]);
      expect(picked.map((row) => row.id).sort((x, y) => x - y)).toEqual(
        [a.id, c.id].sort((x, y) => x - y),
      );
      expect(await repository.findByIds([])).toEqual([]);
    });

    it('remove answers true, then the row is gone, then false; 0 marker rows remain after the cleanup', async () => {
      expect(await repository.remove(c.id)).toBe(true);
      expect(await repository.findById(c.id)).toBeNull();
      expect(await repository.remove(c.id)).toBe(false);
      await cleanup();
      expect(await client.tblservices.count({ where: { name: { startsWith: MARKER } } })).toBe(0);
    });
  });

  describe('a service a ticket uses (Perfex is_referenced)', () => {
    let used: ServiceRow;

    /**
     * The fixture seam for the ONE Perfex-owned table this spec needs a row in. The ownership guard
     * is an extension of `service.client`, so it (rightly) refuses a write to `tbltickets`; this plain
     * client is outside it, is never used by the module, and is closed in `afterAll`.
     */

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL must be set for integration tests');
    }
    const fixtures = new PrismaClient({
      datasourceUrl: databaseUrl,
    });

    /** Tickets first: a service is never deleted while a ticket of this spec still uses it. */
    const cleanupTickets = () =>
      fixtures.$executeRawUnsafe(`DELETE FROM tbltickets WHERE subject LIKE '${TICKET_MARKER}%'`);
    const cleanupServices = () =>
      client.tblservices.deleteMany({ where: { name: { startsWith: TICKET_MARKER } } });

    /**
     * Inserts one ticket that uses `serviceId`. Every NOT NULL column with no default gets a dummy
     * value of its type; column names come from information_schema, values are bound.
     */
    async function insertTicketUsing(serviceId: number): Promise<void> {
      const required = columnSchema.parse(
        await client.$queryRaw<
          unknown[]
        >`SELECT COLUMN_NAME, DATA_TYPE, COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tbltickets' AND IS_NULLABLE = 'NO' AND COLUMN_DEFAULT IS NULL AND EXTRA NOT LIKE '%auto_increment%'`,
      );
      const values = new Map<string, string | number>(
        required.map((column) => [
          column.COLUMN_NAME,
          dummyOf(column.DATA_TYPE, column.COLUMN_TYPE),
        ]),
      );
      values.set('service', serviceId);
      values.set('subject', `${TICKET_MARKER}-ticket`);
      const names = [...values.keys()];
      await fixtures.$executeRawUnsafe(
        `INSERT INTO tbltickets (${names.map((name) => `\`${name}\``).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
        ...values.values(),
      );
    }

    beforeAll(async () => {
      await cleanupTickets();
      await cleanupServices();
      used = await repository.create({ name: `${TICKET_MARKER}-used` });
    });

    afterAll(async () => {
      await cleanupTickets();
      await cleanupServices();
      await fixtures.$disconnect();
    });

    it('countTickets answers 1 for a service one ticket uses, and equals an independent count', async () => {
      expect(await repository.countTickets(used.id)).toBe(0);
      await insertTicketUsing(used.id);
      expect(await repository.countTickets(used.id)).toBe(1);
      expect(await repository.countTickets(used.id)).toBe(
        await client.tbltickets.count({ where: { service: used.id } }),
      );
    });

    it('the delete is refused with ERP-SERVICES-0001 and the row stays', async () => {
      expect(await repository.countTickets(used.id)).toBe(1);
      const refusal = await serviceOf()
        .remove(ADMIN, { id: String(used.id) })
        .then(
          () => null,
          (error: unknown) => error,
        );
      expect(refusal).toBeInstanceOf(AppError);
      expect((refusal as AppError).code).toBe('ERP-SERVICES-0001');
      expect(await repository.findById(used.id)).not.toBeNull();
    });

    it('once the ticket is deleted the count is 0 and the delete works', async () => {
      await cleanupTickets();
      expect(await repository.countTickets(used.id)).toBe(0);
      await serviceOf().remove(ADMIN, { id: String(used.id) });
      expect(await repository.findById(used.id)).toBeNull();
      expect(
        await client.tbltickets.count({ where: { subject: { startsWith: TICKET_MARKER } } }),
      ).toBe(0);
    });
  });
});
