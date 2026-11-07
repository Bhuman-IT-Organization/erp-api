/**
 * AnnouncementsRepository against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * `tblannouncements` is node-owned, so the ownership guard admits the writes this spec makes through
 * the typed delegate. It proves what a stub client cannot: the stored columns read back byte for
 * byte (the message, the three 0/1 switches, the actor's full-name `userid`), the naive `DATETIME` is
 * stored verbatim (read as text), the keyset pages both ways on `name` and `dateadded`, the
 * `q` match, the `name` column's length against `ANNOUNCEMENTS_NAME_MAX`, and the facade reads.
 *
 * Everything this spec writes it creates itself and deletes again: `tblannouncements` rows whose
 * name starts with `MARKER`, removed before the run (a leftover of a crashed run) and after it. No
 * other table is written, no seeded row is touched, and no value from the local data is read into
 * an assertion message: ids and counts are compared, never printed.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { ANNOUNCEMENTS_NAME_MAX } from '../dto/announcements.dto.js';
import type {
  AnnouncementRow,
  AnnouncementsListRequest,
  AnnouncementsPage,
} from '../model/announcements.model.js';
import { AnnouncementsRepository } from '../repository/announcements.repository.js';

/** Every row this spec creates carries this prefix, so the cleanup deletes exactly its own rows. */
const MARKER = 'int-spec-announcements';

/** Whole seconds, because the column is a DATETIME: January < February < March. */
const DATE_C = new Date('2026-01-05T09:00:00.000Z');
const DATE_A = new Date('2026-02-10T14:30:00.000Z');
const DATE_B = new Date('2026-03-15T08:15:30.000Z');

const numberSchema = z.union([z.bigint(), z.number()]).transform(Number);
const lengthSchema = z.tuple([z.object({ len: numberSchema })]);
const textSchema = z.tuple([z.object({ d: z.string() })]);
const userSchema = z.tuple([z.object({ u: z.string() })]);

function request(overrides: Partial<AnnouncementsListRequest> = {}): AnnouncementsListRequest {
  return { search: MARKER, sortField: 'name', order: 'asc', cursor: null, limit: 25, ...overrides };
}

const ids = (page: AnnouncementsPage): number[] => page.items.map((row) => row.id);

describe.skipIf(!process.env.DATABASE_URL)(
  'AnnouncementsRepository against the local mirror',
  () => {
    const service = new PrismaService(new AppConfig(), new HealthService());
    const repository = new AnnouncementsRepository(service);
    const client = service.client;
    let a: AnnouncementRow;
    let b: AnnouncementRow;
    let c: AnnouncementRow;
    /** The id of a row this spec created and deleted: guaranteed missing (ids are never reused). */
    let missingId = 0;

    const cleanup = () =>
      client.tblannouncements.deleteMany({ where: { name: { startsWith: MARKER } } });

    beforeAll(async () => {
      await cleanup();
      c = await repository.create(
        { name: `${MARKER}-c`, message: '', showtousers: 0, showtostaff: 0, showname: 0 },
        DATE_C,
        'IntSpec Repository',
      );
      a = await repository.create(
        {
          name: `${MARKER}-a <b>`,
          message: 'Line 1\nLine <2> & "three"',
          showtousers: 1,
          showtostaff: 0,
          showname: 1,
        },
        DATE_A,
        'IntSpec Repository',
      );
      b = await repository.create(
        { name: `${MARKER}-b`, message: 'Second', showtousers: 0, showtostaff: 1, showname: 0 },
        DATE_B,
        'IntSpec Repository',
      );
      const ghost = await repository.create(
        { name: `${MARKER}-ghost`, message: '', showtousers: 0, showtostaff: 0, showname: 0 },
        DATE_C,
        'IntSpec Repository',
      );
      missingId = ghost.id;
      await repository.remove(ghost.id);
    });

    afterAll(async () => {
      await cleanup();
      await service.client.$disconnect();
    });

    it('create answers the database id; findById returns the row byte for byte', async () => {
      expect(a.id).toBeGreaterThan(0);
      expect(await repository.findById(a.id)).toEqual({
        id: a.id,
        name: `${MARKER}-a <b>`,
        message: 'Line 1\nLine <2> & "three"',
        dateadded: DATE_A,
        showtousers: 1,
        showtostaff: 0,
        showname: 1,
      });
      expect(await repository.findById(c.id)).toMatchObject({ message: '', showname: 0 });
      expect(await repository.findById(missingId)).toBeNull();
    });

    it('dateadded is stored as the naive date and time, verbatim (read as text)', async () => {
      const rows = await client.$queryRaw<
        unknown[]
      >`SELECT DATE_FORMAT(dateadded, '%Y-%m-%d %H:%i:%s') AS d FROM tblannouncements WHERE announcementid = ${a.id}`;
      expect(textSchema.parse(rows)[0].d).toBe('2026-02-10 14:30:00');
    });

    it('userid stores the staff member full name, as Perfex does', async () => {
      const rows = await client.$queryRaw<
        unknown[]
      >`SELECT userid AS u FROM tblannouncements WHERE announcementid = ${a.id}`;
      expect(userSchema.parse(rows)[0].u).toBe('IntSpec Repository');
    });

    it('stores a message longer than 65,535 characters in full', async () => {
      const message = 'x'.repeat(65_536);
      const row = await repository.create(
        { name: `${MARKER}-long-message`, message, showtousers: 0, showtostaff: 0, showname: 0 },
        DATE_C,
        'IntSpec Repository',
      );
      try {
        expect((await repository.findById(row.id))?.message).toBe(message);
      } finally {
        // The paging tests below count every marker row, so this one must not outlive its test.
        await repository.remove(row.id);
      }
    });

    it('update changes the five fields and never the date; a missing id is null', async () => {
      const updated = await repository.update(b.id, {
        name: `${MARKER}-b2`,
        message: '',
        showtousers: 1,
        showtostaff: 1,
        showname: 1,
      });
      expect(updated).toEqual({
        id: b.id,
        name: `${MARKER}-b2`,
        message: '',
        dateadded: DATE_B,
        showtousers: 1,
        showtostaff: 1,
        showname: 1,
      });
      expect(await repository.findById(b.id)).toEqual(updated);
      expect(
        await repository.update(missingId, {
          name: `${MARKER}-nobody`,
          message: '',
          showtousers: 0,
          showtostaff: 0,
          showname: 0,
        }),
      ).toBeNull();
    });

    it('update without a message leaves the stored message byte for byte', async () => {
      const before = await repository.findById(a.id);
      const updated = await repository.update(a.id, {
        name: `${MARKER}-a <b>`,
        showtousers: 0,
        showtostaff: 1,
        showname: 0,
      });
      expect(updated).toEqual({ ...before, showtousers: 0, showtostaff: 1, showname: 0 });
      expect((await repository.findById(a.id))?.message).toBe('Line 1\nLine <2> & "three"');
      // put the switches back: the paging tests below read this row
      await repository.update(a.id, {
        name: `${MARKER}-a <b>`,
        showtousers: 1,
        showtostaff: 0,
        showname: 1,
      });
    });

    it('three marker names page with limit 1 both ways under q, by name', async () => {
      const first = await repository.list(request({ limit: 1 }));
      expect(ids(first)).toEqual([a.id]);
      expect(first.total).toBe(3);
      expect(first.rangeStart).toBe(1);
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
      expect(await repository.count(request())).toBe(3);
    });

    it('pages by the date added, newest first and oldest first, through a date cursor', async () => {
      const newest = await repository.list(
        request({ sortField: 'dateadded', order: 'desc', limit: 1 }),
      );
      expect(ids(newest)).toEqual([b.id]);
      const middle = await repository.list(
        request({
          sortField: 'dateadded',
          order: 'desc',
          limit: 1,
          cursor: decodeCursor(newest.nextCursor, 'dateadded'),
        }),
      );
      expect(ids(middle)).toEqual([a.id]);
      const oldest = await repository.list(
        request({
          sortField: 'dateadded',
          order: 'desc',
          limit: 1,
          cursor: decodeCursor(middle.nextCursor, 'dateadded'),
        }),
      );
      expect(ids(oldest)).toEqual([c.id]);
      expect(oldest.nextCursor).toBeNull();
      const back = await repository.list(
        request({
          sortField: 'dateadded',
          order: 'desc',
          limit: 1,
          cursor: decodeCursor(oldest.prevCursor, 'dateadded'),
        }),
      );
      expect(ids(back)).toEqual([a.id]);
      expect(ids(await repository.list(request({ sortField: 'dateadded', order: 'asc' })))).toEqual(
        [c.id, a.id, b.id],
      );
    });

    it('q as an id matches the id; an all-digit q beyond INT is no id but still runs', async () => {
      expect(ids(await repository.list(request({ search: String(c.id) })))).toContain(c.id);
      await expect(repository.count(request({ search: '2147483647' }))).resolves.toBe(0);
      await expect(repository.count(request({ search: '4294967295' }))).resolves.toBe(0);
    });

    it('CHARACTER_MAXIMUM_LENGTH of tblannouncements.name equals ANNOUNCEMENTS_NAME_MAX', async () => {
      const rows = await client.$queryRaw<
        unknown[]
      >`SELECT CHARACTER_MAXIMUM_LENGTH AS len FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tblannouncements' AND COLUMN_NAME = 'name'`;
      expect(lengthSchema.parse(rows)[0].len).toBe(ANNOUNCEMENTS_NAME_MAX);
    });

    it('listAll and findByIds read the marker rows as stored', async () => {
      const own = (await repository.listAll())
        .filter((row) => row.name.startsWith(MARKER))
        .map((row) => row.id);
      expect(own).toEqual([b.id, a.id, c.id]);
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
      expect(await client.tblannouncements.count({ where: { name: { startsWith: MARKER } } })).toBe(
        0,
      );
    });
  },
);
