/**
 * CustomerGroupsRepository against the local mirror (DATABASE_URL from
 * ../erp-infra/env/local/api.host.env).
 * `tblcustomers_groups` is node-owned. `tblcustomer_groups` is Perfex's: the module only counts it
 * (read only). The test links are written by a separate, unguarded client (`perfex`) that stands in
 * for Perfex; the module under test never uses it, so the ownership guard stays fully on.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import type { LoggerService } from '../../../shared/logger/logger.service.js';
import { CUSTOMER_GROUPS_NAME_MAX } from '../dto/customer-groups.dto.js';
import type {
  CustomerGroupRow,
  CustomerGroupsListRequest,
  CustomerGroupsPage,
} from '../model/customer-groups.model.js';
import { CustomerGroupsRepository } from '../repository/customer-groups.repository.js';
import { CustomerGroupsService } from '../service/customer-groups.service.js';
import { CustomerGroupsTransformer } from '../service/customer-groups.transformer.js';
import { CustomerGroupsTransport } from '../service/customer-groups.transport.js';
import { CustomerGroupsValidator } from '../service/customer-groups.validator.js';
import { PrismaClient } from '../../../shared/db/generated/client.js';

/** Every group this spec creates carries this prefix, so the cleanup deletes exactly its own rows. */
const MARKER = 'int-spec-customer-groups';

/** A customer id for the test links: `tblcustomer_groups` has no foreign key, so no client is needed. */
const FAKE_CUSTOMER_ID = 2147480001;

const numberSchema = z.union([z.bigint(), z.number()]).transform(Number);
const lengthSchema = z.tuple([z.object({ len: numberSchema })]);

function request(overrides: Partial<CustomerGroupsListRequest> = {}): CustomerGroupsListRequest {
  return {
    search: MARKER,
    sortField: 'name',
    order: 'asc',
    cursor: null,
    limit: 25,
    ...overrides,
  };
}

const ids = (page: CustomerGroupsPage): number[] => page.items.map((row) => row.id);

describe.skipIf(!process.env.DATABASE_URL)(
  'CustomerGroupsRepository against the local mirror',
  () => {
    const prisma = new PrismaService(new AppConfig(), new HealthService());
    const repository = new CustomerGroupsRepository(prisma);
    const client = prisma.client;

    /**
     * Test fixtures only: a plain, unguarded client that plays Perfex (the real writer of
     * `tblcustomer_groups`). The module under test never uses it.
     */
    const perfex = new PrismaClient({
      datasourceUrl: process.env.DATABASE_URL ?? '',
    });

    const logger = { log: () => undefined } as unknown as LoggerService;
    const transport = { publish: () => Promise.resolve() } as unknown as CustomerGroupsTransport;
    const service = new CustomerGroupsService(
      new CustomerGroupsValidator(),
      repository,
      new CustomerGroupsTransformer(),
      transport,
      logger,
    );

    const admin = { isAdmin: true } as unknown as AuthenticatedUser;

    let a: CustomerGroupRow;
    let b: CustomerGroupRow;
    let c: CustomerGroupRow;

    /** The id of a row this spec created and deleted: guaranteed missing (ids are never reused). */
    let missingId = 0;

    /** Stands in for Perfex linking a customer to a group. */
    const link = async (groupId: number): Promise<void> => {
      await perfex.$executeRaw`INSERT INTO tblcustomer_groups (groupid, customer_id) VALUES (${groupId}, ${FAKE_CUSTOMER_ID})`;
    };

    const cleanup = async (): Promise<void> => {
      // The test links first (as Perfex), then the node-owned groups (through the guarded client).
      await perfex.$executeRaw`DELETE tcg FROM tblcustomer_groups tcg JOIN tblcustomers_groups g ON g.id = tcg.groupid WHERE g.name LIKE ${`${MARKER}%`}`;
      await client.tblcustomers_groups.deleteMany({ where: { name: { startsWith: MARKER } } });
    };

    const create = (suffix: string): Promise<CustomerGroupRow> =>
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
      await perfex.$disconnect();
      await prisma.client.$disconnect();
    });

    it('create answers the database id; findById returns the row as stored', async () => {
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
    });

    it('q as an id matches the id; an all-digit q up to INT runs', async () => {
      expect(ids(await repository.list(request({ search: String(c.id) })))).toContain(c.id);
      const page = await repository.list(request({ search: '2147483647' }));
      expect(page.total).toBeTypeOf('number');
    });

    it('CHARACTER_MAXIMUM_LENGTH of tblcustomers_groups.name equals CUSTOMER_GROUPS_NAME_MAX', async () => {
      const rows = await client.$queryRaw<
        unknown[]
      >`SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblcustomers_groups' AND COLUMN_NAME = 'name'`;
      expect(lengthSchema.parse(rows)[0].len).toBe(CUSTOMER_GROUPS_NAME_MAX);
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
    });

    it('countCustomers is 0 for a group no customer is in, and counts its links (read only)', async () => {
      expect(await repository.countCustomers(a.id)).toBe(0);
      const linked = await create('count-linked');
      await link(linked.id);
      expect(await repository.countCustomers(linked.id)).toBe(1);
      await link(linked.id);
      expect(await repository.countCustomers(linked.id)).toBe(2);
    });

    it('delete is refused with 409 ERP-CUSTOMERGROUPS-0001 while a customer is in the group, and nothing is deleted', async () => {
      const linked = await create('in-use');
      await link(linked.id);
      await expect(service.remove(admin, { id: String(linked.id) })).rejects.toMatchObject({
        code: 'ERP-CUSTOMERGROUPS-0001',
      });
      expect(await repository.findById(linked.id)).not.toBeNull();
      expect(await repository.countCustomers(linked.id)).toBe(1);
    });

    it('delete of an empty group succeeds (204) and the group is gone', async () => {
      const empty = await create('empty');
      expect(await repository.countCustomers(empty.id)).toBe(0);
      await expect(service.remove(admin, { id: String(empty.id) })).resolves.toBeUndefined();
      expect(await repository.findById(empty.id)).toBeNull();
    });

    it('remove deletes the group only', async () => {
      expect(await repository.remove(a.id)).toBe(true);
      expect(await repository.findById(a.id)).toBeNull();
      expect(await repository.findById(b.id)).not.toBeNull();
    });

    it('remove answers false for a missing id', async () => {
      expect(await repository.remove(missingId)).toBe(false);
    });

    it('remove answers true, then the row is gone, then false; 0 marker rows and 0 test links remain after cleanup', async () => {
      expect(await repository.remove(c.id)).toBe(true);
      expect(await repository.findById(c.id)).toBeNull();
      expect(await repository.remove(c.id)).toBe(false);
      await cleanup();
      expect(
        await client.tblcustomers_groups.count({ where: { name: { startsWith: MARKER } } }),
      ).toBe(0);
      expect(
        await client.tblcustomer_groups.count({ where: { customer_id: FAKE_CUSTOMER_ID } }),
      ).toBe(0);
    });
  },
);
