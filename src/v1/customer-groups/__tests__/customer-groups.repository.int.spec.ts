/**
 * CustomerGroupsRepository against the local mirror (DATABASE_URL from
 * ../erp-infra/env/local/api.host.env).
 *
 * `tblcustomers_groups` and `tblcustomer_groups` are node-owned, so the ownership guard admits the
 * writes this spec makes through the typed delegates. The spec proves the rule of the task card:
 * `remove` deletes the group's rows in `tblcustomer_groups` and the group in ONE transaction, and
 * it leaves every other group's links alone.
 *
 * Everything this spec writes it creates itself and deletes again: `tblcustomers_groups` rows whose
 * name starts with `MARKER`, and `tblcustomer_groups` rows whose `customer_id` is `MARKER_CUSTOMER`
 * (a number no real customer holds), removed before the run (a leftover of a crashed run) and
 * after it. No seeded row is touched, and no value from the local data is read into an assertion
 * message: ids and counts are compared, never printed, and every name asserted is one this spec
 * wrote.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { CUSTOMER_GROUPS_NAME_MAX } from '../dto/customer-groups.dto.js';
import type {
  CustomerGroupRow,
  CustomerGroupsListRequest,
  CustomerGroupsPage,
} from '../model/customer-groups.model.js';
import { CustomerGroupsRepository } from '../repository/customer-groups.repository.js';

/** Every group this spec creates carries this prefix, so the cleanup deletes exactly its own rows. */
const MARKER = 'int-spec-customer-groups';

/** A customer id no real customer holds (below INT's maximum): marks the links this spec writes. */
const MARKER_CUSTOMER = 2_000_000_001;

const numberSchema = z.union([z.bigint(), z.number()]).transform(Number);
const lengthSchema = z.tuple([z.object({ len: numberSchema })]);

function request(overrides: Partial<CustomerGroupsListRequest> = {}): CustomerGroupsListRequest {
  return { search: MARKER, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const ids = (page: CustomerGroupsPage): number[] => page.items.map((row) => row.id);

describe.skipIf(!process.env.DATABASE_URL)(
  'CustomerGroupsRepository against the local mirror',
  () => {
    const service = new PrismaService(new AppConfig(), new HealthService());
    const repository = new CustomerGroupsRepository(service);
    const client = service.client;
    let a: CustomerGroupRow;
    let b: CustomerGroupRow;
    let c: CustomerGroupRow;
    /** The id of a row this spec created and deleted: guaranteed missing (ids are never reused). */
    let missingId = 0;

    /** Links first, then groups: the order the repository's own delete uses. */
    const cleanup = async (): Promise<void> => {
      await client.tblcustomer_groups.deleteMany({ where: { customer_id: MARKER_CUSTOMER } });
      await client.tblcustomers_groups.deleteMany({ where: { name: { startsWith: MARKER } } });
    };

    const create = (suffix: string): Promise<CustomerGroupRow> =>
      repository.create({ name: `${MARKER}-${suffix}` });

    const linksOf = (groupid: number): Promise<number> =>
      client.tblcustomer_groups.count({ where: { groupid, customer_id: MARKER_CUSTOMER } });

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
      await service.client.$disconnect();
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

    it("remove deletes the group's customer links with it, and leaves every other group's links alone", async () => {
      // `a` has two links, `b` has one: deleting `a` must remove exactly the two.
      await client.tblcustomer_groups.createMany({
        data: [
          { groupid: a.id, customer_id: MARKER_CUSTOMER },
          { groupid: a.id, customer_id: MARKER_CUSTOMER },
          { groupid: b.id, customer_id: MARKER_CUSTOMER },
        ],
      });
      expect(await linksOf(a.id)).toBe(2);
      expect(await linksOf(b.id)).toBe(1);

      expect(await repository.remove(a.id)).toBe(true);

      expect(await repository.findById(a.id)).toBeNull();
      expect(await linksOf(a.id)).toBe(0);
      expect(await linksOf(b.id)).toBe(1);
      expect(await repository.findById(b.id)).not.toBeNull();
    });

    it('remove answers false for a missing id and removes no link', async () => {
      await client.tblcustomer_groups.create({
        data: { groupid: b.id, customer_id: MARKER_CUSTOMER },
      });
      const before = await linksOf(b.id);
      expect(await repository.remove(missingId)).toBe(false);
      expect(await linksOf(b.id)).toBe(before);
    });

    it('remove answers true, then the row is gone, then false; 0 marker rows remain after the cleanup', async () => {
      expect(await repository.remove(c.id)).toBe(true);
      expect(await repository.findById(c.id)).toBeNull();
      expect(await repository.remove(c.id)).toBe(false);
      await cleanup();
      expect(
        await client.tblcustomers_groups.count({ where: { name: { startsWith: MARKER } } }),
      ).toBe(0);
      expect(
        await client.tblcustomer_groups.count({ where: { customer_id: MARKER_CUSTOMER } }),
      ).toBe(0);
    });
  },
);
