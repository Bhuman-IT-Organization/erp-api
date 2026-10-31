/**
 * FixedEquipmentDepreciationsRepository against the local mirror (DATABASE_URL from
 * ../erp-infra/env/local/api.host.env).
 *
 * `tblfe_depreciations` is node-owned, so the ownership guard admits the writes this spec makes
 * through the typed delegate. The marker rows carry a creator no real staff member has
 * (`OWNER`), so `own` reads exactly them.
 *
 * Everything this spec writes it creates itself and deletes again: `tblfe_depreciations` rows whose
 * name starts with `MARKER`, removed before the run (a leftover of a crashed run) and after it. No
 * seeded row is touched, and no value from the local data is read into an assertion message: ids
 * and counts are compared, never printed.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { FIXED_EQUIPMENT_DEPRECIATIONS_NAME_MAX } from '../dto/fixed-equipment-depreciations.dto.js';
import type {
  FixedEquipmentDepreciation,
  FixedEquipmentDepreciationsListRequest,
  FixedEquipmentDepreciationsPage,
} from '../model/fixed-equipment-depreciations.model.js';
import { FixedEquipmentDepreciationsRepository } from '../repository/fixed-equipment-depreciations.repository.js';

/** Every row this spec creates carries this prefix, so the cleanup deletes exactly its own rows. */
const MARKER = 'int-spec-fed';
/** A creator no real staff member has, so `own` under it reads only the marker rows. */
const OWNER = 999_991;
/** Another staff id: `own` under it sees none of the marker rows. */
const STRANGER = 999_992;

const numberSchema = z.union([z.bigint(), z.number()]).transform(Number);
const lengthSchema = z.tuple([z.object({ len: numberSchema })]);

function request(
  overrides: Partial<FixedEquipmentDepreciationsListRequest> = {},
): FixedEquipmentDepreciationsListRequest {
  return { search: MARKER, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const ids = (page: FixedEquipmentDepreciationsPage): number[] => page.items.map((row) => row.id);

describe.skipIf(!process.env.DATABASE_URL)(
  'FixedEquipmentDepreciationsRepository against the local mirror',
  () => {
    const prisma = new PrismaService(new AppConfig(), new HealthService());
    const repository = new FixedEquipmentDepreciationsRepository(prisma);
    const client = prisma.client;
    let a: FixedEquipmentDepreciation;
    let b: FixedEquipmentDepreciation;
    let c: FixedEquipmentDepreciation;
    /** The id of a row this spec created and deleted: guaranteed missing (ids are never reused). */
    let missingId = 0;

    const cleanup = () =>
      client.tblfe_depreciations.deleteMany({ where: { name: { startsWith: MARKER } } });

    const create = (suffix: string, term = 12): Promise<FixedEquipmentDepreciation> =>
      repository.create({ name: `${MARKER}-${suffix}`, term, creatorId: OWNER });

    beforeAll(async () => {
      await cleanup();
      c = await create('c', 60);
      a = await create('a <b>', 12);
      b = await create('b', 36);
      const ghost = await create('ghost');
      missingId = ghost.id;
      await repository.remove(ghost.id);
    });

    afterAll(async () => {
      await cleanup();
      await client.$disconnect();
    });

    it('create answers the database id; findById returns the row byte for byte, term and creator included', async () => {
      expect(a.id).toBeGreaterThan(0);
      expect(await repository.findById(a.id, 'all', 0)).toEqual({
        id: a.id,
        name: `${MARKER}-a <b>`,
        term: 12,
        creatorId: OWNER,
      });
      expect(await repository.findById(missingId, 'all', 0)).toBeNull();
    });

    it('under own, a row is found by its creator and hidden from anyone else (null, like a missing one)', async () => {
      expect(await repository.findById(a.id, 'own', OWNER)).not.toBeNull();
      expect(await repository.findById(a.id, 'own', STRANGER)).toBeNull();
    });

    it('update changes the name and the term; the creator stays; a missing id is null', async () => {
      const updated = await repository.update(b.id, { name: `${MARKER}-b2`, term: 48 });
      expect(updated).toEqual({ id: b.id, name: `${MARKER}-b2`, term: 48, creatorId: OWNER });
      expect(await repository.findById(b.id, 'all', 0)).toEqual(updated);
      expect(await repository.update(missingId, { name: `${MARKER}-nobody`, term: 12 })).toBeNull();
    });

    it('three marker names page with limit 1 both ways under q, by name and by the id descending', async () => {
      const first = await repository.list(request({ limit: 1 }), 'all', 0);
      expect(ids(first)).toEqual([a.id]);
      expect(first.total).toBe(3);
      const second = await repository.list(
        request({ limit: 1, cursor: decodeCursor(first.nextCursor, 'name') }),
        'all',
        0,
      );
      expect(ids(second)).toEqual([b.id]);
      const third = await repository.list(
        request({ limit: 1, cursor: decodeCursor(second.nextCursor, 'name') }),
        'all',
        0,
      );
      expect(ids(third)).toEqual([c.id]);
      expect(third.nextCursor).toBeNull();
      expect(third.rangeStart).toBe(3);
      const back = await repository.list(
        request({ limit: 1, cursor: decodeCursor(third.prevCursor, 'name') }),
        'all',
        0,
      );
      expect(ids(back)).toEqual([b.id]);
      const byId = await repository.list(request({ sortField: 'id', order: 'desc' }), 'all', 0);
      expect(ids(byId)).toEqual([b.id, a.id, c.id]);
      expect(await repository.count(request(), 'all', 0)).toBe(3);
    });

    it('own narrows the list and the count to the creator’s rows', async () => {
      expect(await repository.count(request(), 'own', OWNER)).toBe(3);
      expect(await repository.count(request(), 'own', STRANGER)).toBe(0);
      expect(ids(await repository.list(request(), 'own', STRANGER))).toEqual([]);
    });

    it('CHARACTER_MAXIMUM_LENGTH of tblfe_depreciations.name equals FIXED_EQUIPMENT_DEPRECIATIONS_NAME_MAX', async () => {
      const rows = await client.$queryRaw<
        unknown[]
      >`SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblfe_depreciations' AND COLUMN_NAME = 'name'`;
      expect(lengthSchema.parse(rows)[0].len).toBe(FIXED_EQUIPMENT_DEPRECIATIONS_NAME_MAX);
    });

    it('listAll reads the marker rows by name ascending', async () => {
      const own = (await repository.listAll()).filter((row) => row.name.startsWith(MARKER));
      expect(own.map((row) => row.id)).toEqual([a.id, b.id, c.id]);
    });

    it('remove answers true, then the row is gone, then false; 0 marker rows remain after the cleanup', async () => {
      expect(await repository.remove(c.id)).toBe(true);
      expect(await repository.findById(c.id, 'all', 0)).toBeNull();
      expect(await repository.remove(c.id)).toBe(false);
      await cleanup();
      expect(
        await client.tblfe_depreciations.count({ where: { name: { startsWith: MARKER } } }),
      ).toBe(0);
    });
  },
);
