/**
 * CustomFieldsRepository against the local mirror (DATABASE_URL from
 * ../erp-infra/env/local/api.host.env).
 *
 * Read-only: `tblcustomfields` and `tblcustomfieldsvalues` are Perfex's (neither is Node's in the
 * ownership register), so this spec writes NOTHING, neither through the repository (which has no
 * write) nor through the client. Every case compares what the repository answers with an
 * independent direct read of the same rows, so it holds whatever the local data is (an empty table
 * included). Ids and counts are compared, never a name, an option or a value.
 */
import 'reflect-metadata';
import { afterAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { CustomFieldsRepository } from '../repository/custom-fields.repository.js';

/** An id no row carries (the column is a signed INT). */
const MISSING_ID = 2_147_483_000;
/** How many fields and records the comparisons sample. */
const SAMPLE = 5;

describe.skipIf(!process.env.DATABASE_URL)(
  'CustomFieldsRepository against the local mirror (reads only)',
  () => {
    const service = new PrismaService(new AppConfig(), new HealthService());
    const client = service.client;
    const repository = new CustomFieldsRepository(service);

    afterAll(async () => {
      await client.$disconnect();
    });

    it('findById answers the stored row by id, and null for an id no row carries', async () => {
      const first = await client.tblcustomfields.findFirst({
        orderBy: { id: 'asc' },
        select: { id: true, fieldto: true, active: true },
      });
      if (first !== null) {
        const row = await repository.findById(first.id);
        expect(row?.id).toBe(first.id);
        expect(row?.fieldto).toBe(first.fieldto ?? '');
        expect(row?.active).toBe(first.active === 1);
      }
      expect(await repository.findById(MISSING_ID)).toBeNull();
    });

    it('the list answers total as a direct count, the page in id order, and pages by name both ways', async () => {
      const total = await client.tblcustomfields.count();
      const request = {
        search: null,
        fieldto: null,
        sortField: 'id',
        order: 'asc',
        cursor: null,
        limit: 2,
      } as const;
      const page = await repository.list(request);
      expect(page.total).toBe(total);
      const direct = await client.tblcustomfields.findMany({
        orderBy: { id: 'asc' },
        take: 2,
        select: { id: true },
      });
      expect(page.items.map((row) => row.id)).toEqual(direct.map((row) => row.id));
      expect(await repository.count(request)).toBe(total);

      const byName = await repository.list({ ...request, sortField: 'name' });
      const nextCursor = decodeCursor(byName.nextCursor, 'name');
      if (nextCursor !== null) {
        const next = await repository.list({ ...request, sortField: 'name', cursor: nextCursor });
        expect(next.rangeStart).toBe(byName.items.length + 1);
        const back = await repository.list({
          ...request,
          sortField: 'name',
          cursor: decodeCursor(next.prevCursor, 'name'),
        });
        expect(back.items.map((row) => row.id)).toEqual(byName.items.map((row) => row.id));
      }
    });

    it('count narrows by fieldto as a direct count does', async () => {
      const first = await client.tblcustomfields.findFirst({
        where: { fieldto: { not: null } },
        orderBy: { id: 'asc' },
        select: { fieldto: true },
      });
      const fieldto = first?.fieldto ?? 'leads';
      expect(
        await repository.count({
          search: null,
          fieldto: [fieldto],
          sortField: 'id',
          order: 'asc',
          cursor: null,
          limit: 1,
        }),
      ).toBe(await client.tblcustomfields.count({ where: { fieldto: { in: [fieldto] } } }));
    });

    it('valuesCountOf equals a direct count per field, and zero for an id no row carries', async () => {
      const fields = await client.tblcustomfields.findMany({
        orderBy: { id: 'asc' },
        take: SAMPLE,
        select: { id: true },
      });
      const ids = [...fields.map((row) => row.id), MISSING_ID];
      const counts = await repository.valuesCountOf(ids);
      for (const id of ids) {
        expect(counts.get(id), `field ${String(id)}`).toBe(
          await client.tblcustomfieldsvalues.count({ where: { fieldid: id } }),
        );
      }
    });

    it('definitionsOf answers the fields of an entity in field_order, then id', async () => {
      const first = await client.tblcustomfields.findFirst({
        where: { fieldto: { not: null } },
        orderBy: { id: 'asc' },
        select: { fieldto: true },
      });
      const fieldto = first?.fieldto ?? 'leads';
      const direct = await client.tblcustomfields.findMany({
        where: { fieldto },
        orderBy: [{ field_order: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      expect((await repository.definitionsOf(fieldto)).map((row) => row.id)).toEqual(
        direct.map((row) => row.id),
      );
    });

    it('valuesOf answers the value rows of the records by record, then field; none for no record', async () => {
      const sample = await client.tblcustomfieldsvalues.findFirst({
        orderBy: { id: 'asc' },
        select: { fieldto: true, relid: true },
      });
      expect(await repository.valuesOf(sample?.fieldto ?? 'leads', [])).toEqual([]);
      if (sample === null) return;
      const direct = await client.tblcustomfieldsvalues.findMany({
        where: { fieldto: sample.fieldto, relid: { in: [sample.relid] } },
        orderBy: [{ relid: 'asc' }, { fieldid: 'asc' }, { id: 'asc' }],
        select: { relid: true, fieldid: true },
      });
      const rows = await repository.valuesOf(sample.fieldto, [sample.relid]);
      expect(rows.map((row) => [row.relId, row.fieldId])).toEqual(
        direct.map((row) => [row.relid, row.fieldid]),
      );
    });
  },
);
