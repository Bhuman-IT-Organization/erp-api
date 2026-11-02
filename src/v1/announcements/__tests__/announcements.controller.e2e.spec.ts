/**
 * The HTTP contract of the six routes under `/api/v1/announcements`, proven in-process with Fastify
 * `inject` over the in-memory fake: administrators only on every handler (a bearer holding every
 * catalogue code is refused 403 `ERP-AUTH-0005` before any read, an administrator is served, no
 * bearer is 401 `ERP-AUTH-0004`), the list in Perfex's order (the date added descending), create
 * and update of the five saved fields, strict bodies, the unconditional DELETE, the four-format
 * export of `id`, `name` and `dateadded`, `x-request-id` on every response, and the ADR-0030
 * route assertion.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { CSV_BOM, EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { PDF_CONTENT_TYPE } from '../../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../../shared/http/xlsx.js';
import { ANNOUNCEMENTS_ROUTES } from '../announcements.routes.js';
import {
  announcementsListResponseSchema,
  announcementsResponseSchema,
} from '../dto/announcements.dto.js';
import {
  AnnouncementsCreatedV1,
  AnnouncementsDeletedV1,
  AnnouncementsUpdatedV1,
} from '../events/published.js';
import {
  createAnnouncementsTestApp,
  TEST_BEARERS,
  TEST_NOW,
  type AnnouncementsTestApp,
} from './create-announcements-test-app.js';

const LIST = `/${API_PREFIX}/${ANNOUNCEMENTS_ROUTES.base}`;
const EXPORT = `${LIST}/${ANNOUNCEMENTS_ROUTES.export}`;
const record = (id: string | number): string => `${LIST}/${String(id)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HTTP = {
  ok: 200,
  created: 201,
  noContent: 204,
  bad: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
};
/** The service's fixed clock, as `dateadded` answers it. */
const CREATED_AT = TEST_NOW.toISOString();
/** Every row: the fake's own match with no search, for a count. */
const ALL = { search: null, sortField: 'name', order: 'asc', cursor: null, limit: 1 } as const;
const ADMIN_ONLY = 'announcements are managed by administrators only';

/** A valid body: the name, the message and the three visibility switches. */
const BODY = {
  name: 'Fuel prices',
  message: 'Updated',
  showtousers: true,
  showtostaff: false,
  showname: true,
};
/** Seed row 1 exactly as seeded, so a PATCH of it leaves the shared data as it found it. */
const SEED_1_BODY = {
  name: 'Head Office',
  message: 'Open on Sunday',
  showtousers: true,
  showtostaff: true,
  showname: false,
};

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** The six routes, each with the body it needs and the status an administrator gets. */
const ROUTES: readonly { method: Method; url: string; payload?: object; admin: number }[] = [
  { method: 'GET', url: LIST, admin: HTTP.ok },
  { method: 'GET', url: EXPORT, admin: HTTP.ok },
  { method: 'GET', url: record(1), admin: HTTP.ok },
  { method: 'POST', url: LIST, payload: { ...BODY, name: 'New' }, admin: HTTP.created },
  { method: 'PATCH', url: record(1), payload: SEED_1_BODY, admin: HTTP.ok },
  { method: 'DELETE', url: record(2), admin: HTTP.noContent },
];

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('AnnouncementsController (Fastify inject, no network)', () => {
  let ctx: AnnouncementsTestApp;

  beforeAll(async () => {
    ctx = await createAnnouncementsTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    vi.restoreAllMocks();
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<AnnouncementsTestApp['app']['inject']> =>
    ctx.app.inject({
      method,
      url,
      ...(token === undefined ? {} : { headers: bearer(token) }),
      ...(payload === undefined ? {} : { payload }),
    });

  /** A fresh row to delete or change, so each case owns its data; the log and events are cleared. */
  const created = async (name: string): Promise<string> => {
    const res = await send('POST', LIST, TEST_BEARERS.admin, { ...BODY, name });
    expect(res.statusCode).toBe(HTTP.created);
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    return announcementsResponseSchema.parse(JSON.parse(res.payload)).id;
  };

  it('registers the six routes under /api/v1/announcements, DELETE included', () => {
    for (const route of [
      `GET ${LIST}`,
      `GET ${EXPORT}`,
      `GET ${LIST}/:id`,
      `POST ${LIST}`,
      `PATCH ${LIST}/:id`,
      `DELETE ${LIST}/:id`,
    ]) {
      expect(ctx.routes).toContain(route);
    }
  });

  describe('administrators only', () => {
    it.each(ROUTES)(
      '$method $url with a bearer holding every catalogue code, not an administrator, is 403 ERP-AUTH-0005 before any read',
      async ({ method, url, payload }) => {
        const reads = [
          vi.spyOn(ctx.repo, 'list'),
          vi.spyOn(ctx.repo, 'count'),
          vi.spyOn(ctx.repo, 'findById'),
          vi.spyOn(ctx.repo, 'create'),
          vi.spyOn(ctx.repo, 'update'),
          vi.spyOn(ctx.repo, 'remove'),
        ];
        const res = await send(method, url, TEST_BEARERS.everyCode, payload);
        expect(res.statusCode).toBe(HTTP.forbidden);
        const body = problem(res);
        expect(body.code).toBe('ERP-AUTH-0005');
        expect(body.detail).toBe(ADMIN_ONLY);
        for (const spy of reads) expect(spy).not.toHaveBeenCalled();
        expect(ctx.events.count).toBe(0);
        expect(ctx.logger.lines).toEqual([]);
      },
    );

    it.each(ROUTES)(
      '$method $url with a bearer holding no code is 403 ERP-AUTH-0005',
      async ({ method, url, payload }) => {
        const res = await send(method, url, TEST_BEARERS.noPermission, payload);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(problem(res).code).toBe('ERP-AUTH-0005');
      },
    );

    it.each(ROUTES)(
      '$method $url without a bearer is 401 ERP-AUTH-0004',
      async ({ method, url, payload }) => {
        const res = await send(method, url, undefined, payload);
        expect(res.statusCode).toBe(HTTP.unauthorized);
        expect(problem(res).code).toBe('ERP-AUTH-0004');
      },
    );

    it.each(ROUTES)(
      '$method $url with the administrator bearer is served ($admin)',
      async ({ method, url, payload, admin }) => {
        const target = method === 'DELETE' ? record(await created('Doomed')) : url;
        const res = await send(method, target, TEST_BEARERS.admin, payload);
        expect(res.statusCode).toBe(admin);
      },
    );
  });

  describe('GET list', () => {
    it("defaults to Perfex's order, the date added descending, with no sort sent", async () => {
      const res = await send('GET', LIST, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const body = announcementsListResponseSchema.parse(JSON.parse(res.payload));
      const order = body.data.map((row) => Number(row.id));
      expect(order.slice(-3)).toEqual([3, 2, 1]);
      const newer = order.slice(0, -3);
      expect(newer).toEqual([...newer].sort((x, y) => y - x));
      expect(body.meta).toMatchObject({ exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS });
    });

    it('each row carries the stored fields, the date as ISO text and the switches as 0/1', async () => {
      const res = await send('GET', `${LIST}?q=holiday`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const body = announcementsListResponseSchema.parse(JSON.parse(res.payload));
      expect(body.data).toEqual([
        {
          id: '3',
          name: 'Holiday',
          message: 'Closed on Friday',
          dateadded: '2026-02-10T14:30:00.000Z',
          showtousers: 1,
          showtostaff: 0,
          showname: 0,
        },
      ]);
      expect(res.payload).not.toContain('userid');
    });

    it('a row with no message answers message null', async () => {
      const res = await send('GET', record(2), TEST_BEARERS.admin);
      expect(announcementsResponseSchema.parse(JSON.parse(res.payload)).message).toBeNull();
    });

    it('sorts by name and searches the name case-insensitively', async () => {
      const sorted = await send('GET', `${LIST}?sort=name&q=o`, TEST_BEARERS.admin);
      const names = announcementsListResponseSchema
        .parse(JSON.parse(sorted.payload))
        .data.map((row) => row.name);
      expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
      const found = await send('GET', `${LIST}?q=WAREHOUSE`, TEST_BEARERS.admin);
      expect(
        announcementsListResponseSchema.parse(JSON.parse(found.payload)).data.map((row) => row.id),
      ).toEqual(['2']);
    });

    it('pages with the cursor the previous page answered', async () => {
      const first = announcementsListResponseSchema.parse(
        JSON.parse((await send('GET', `${LIST}?limit=2&sort=name`, TEST_BEARERS.admin)).payload),
      );
      expect(first.data).toHaveLength(2);
      expect(first.meta.nextCursor).not.toBeNull();
      const second = announcementsListResponseSchema.parse(
        JSON.parse(
          (
            await send(
              'GET',
              `${LIST}?limit=2&sort=name&cursor=${encodeURIComponent(first.meta.nextCursor ?? '')}`,
              TEST_BEARERS.admin,
            )
          ).payload,
        ),
      );
      const ids = [...first.data, ...second.data].map((row) => row.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(second.meta.prevCursor).not.toBeNull();
    });

    it('a bad list query is 400 ERP-VALIDATION-0001 with the issues', async () => {
      const res = await send('GET', `${LIST}?sort=message`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.bad);
      const body = problem(res);
      expect(body.code).toBe('ERP-VALIDATION-0001');
      expect(JSON.stringify(body.issues)).toContain('sort');
    });
  });

  describe('POST and PATCH', () => {
    it('POST 201, GET :id 200, PATCH 200: the date from the fixed clock and kept, one event and one log line each', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { ...BODY, name: '  Written  ' });
      expect(res.statusCode).toBe(HTTP.created);
      const dto = announcementsResponseSchema.parse(JSON.parse(res.payload));
      expect(dto).toEqual({
        id: dto.id,
        name: 'Written',
        message: 'Updated',
        dateadded: CREATED_AT,
        showtousers: 1,
        showtostaff: 0,
        showname: 1,
      });
      expect(await ctx.repo.findById(Number(dto.id))).toMatchObject({
        name: 'Written',
        message: 'Updated',
        showtousers: 1,
        showtostaff: 0,
        showname: 1,
      });
      const read = await send('GET', record(dto.id), TEST_BEARERS.admin);
      expect(JSON.parse(read.payload)).toEqual(dto);
      const updated = await send('PATCH', record(dto.id), TEST_BEARERS.admin, {
        name: 'Rewritten',
        message: '',
        showtousers: false,
        showtostaff: true,
        showname: false,
      });
      expect(updated.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(updated.payload)).toEqual({
        ...dto,
        name: 'Rewritten',
        message: '',
        showtousers: 0,
        showtostaff: 1,
        showname: 0,
      });
      expect(ctx.events.drain().map((event) => event.constructor)).toEqual([
        AnnouncementsCreatedV1,
        AnnouncementsUpdatedV1,
      ]);
      const id = Number(dto.id);
      expect(ctx.logger.lines).toEqual([
        { message: 'announcement created', meta: { id } },
        { message: 'announcement updated', meta: { id } },
      ]);
    });

    it('POST without a message stores it as null', async () => {
      const withoutMessage = Object.fromEntries(
        Object.entries(BODY).filter(([key]) => key !== 'message'),
      );
      const res = await send('POST', LIST, TEST_BEARERS.admin, withoutMessage);
      expect(res.statusCode).toBe(HTTP.created);
      expect(announcementsResponseSchema.parse(JSON.parse(res.payload)).message).toBe('');
    });

    it.each(['Fuel < 50 km', '<script>alert(1)</script>'])(
      'the name %s saves (201) and reads back byte-identical',
      async (name) => {
        const res = await send('POST', LIST, TEST_BEARERS.admin, { ...BODY, name });
        expect(res.statusCode).toBe(HTTP.created);
        const { id } = announcementsResponseSchema.parse(JSON.parse(res.payload));
        const read = await send('GET', record(id), TEST_BEARERS.admin);
        expect(announcementsResponseSchema.parse(JSON.parse(read.payload))).toMatchObject({
          name,
          dateadded: CREATED_AT,
        });
      },
    );

    it('POST a name the seed already holds is 201: Perfex has no uniqueness check', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { ...BODY, name: 'Head Office' });
      expect(res.statusCode).toBe(HTTP.created);
    });

    it.each([
      { id: 77 },
      { announcementid: 5 },
      { userid: '1' },
      { dateadded: '2020-01-01 00:00:00' },
    ])('POST with %o is 400 naming the key, and nothing is stored', async (extra) => {
      const total = await ctx.repo.count(ALL);
      const res = await send('POST', LIST, TEST_BEARERS.admin, { ...BODY, ...extra });
      expect(res.statusCode).toBe(HTTP.bad);
      expect(JSON.stringify(problem(res).issues)).toContain(Object.keys(extra)[0] ?? '');
      expect(await ctx.repo.count(ALL)).toBe(total);
      expect(ctx.events.count).toBe(0);
    });

    it('POST with no name, a blank name or a missing switch is 400', async () => {
      const withoutSwitch = Object.fromEntries(
        Object.entries(BODY).filter(([key]) => key !== 'showname'),
      );
      for (const payload of [{ ...BODY, name: '' }, { ...BODY, name: '   ' }, withoutSwitch]) {
        const res = await send('POST', LIST, TEST_BEARERS.admin, payload);
        expect(res.statusCode).toBe(HTTP.bad);
        expect(problem(res).code).toBe('ERP-VALIDATION-0001');
      }
      expect(ctx.events.count).toBe(0);
    });

    it('PATCH {} is 400; PATCH with an extra key is 400 and the row is unchanged', async () => {
      const empty = await send('PATCH', record(1), TEST_BEARERS.admin, {});
      expect(empty.statusCode).toBe(HTTP.bad);
      expect(JSON.stringify(problem(empty).issues)).toContain('name');
      const before = await ctx.repo.findById(3);
      const sneaky = await send('PATCH', record(3), TEST_BEARERS.admin, {
        ...BODY,
        userid: '2',
      });
      expect(sneaky.statusCode).toBe(HTTP.bad);
      expect(await ctx.repo.findById(3)).toEqual(before);
    });

    it('PATCH changes the five saved fields and never the date', async () => {
      const id = await created('Rename me');
      const before = await ctx.repo.findById(Number(id));
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, {
        name: 'Renamed',
        message: 'New text',
        showtousers: true,
        showtostaff: true,
        showname: true,
      });
      expect(res.statusCode).toBe(HTTP.ok);
      expect(announcementsResponseSchema.parse(JSON.parse(res.payload)).dateadded).toBe(CREATED_AT);
      expect(await ctx.repo.findById(Number(id))).toEqual({
        ...before,
        name: 'Renamed',
        message: 'New text',
        showtousers: 1,
        showtostaff: 1,
        showname: 1,
      });
    });

    it('a non-numeric :id is a 400, never a 404 probe; PATCH of a missing id is 404', async () => {
      const res = await send('GET', record('abc'), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.bad);
      const patch = await send('PATCH', record(9_999), TEST_BEARERS.admin, BODY);
      expect(patch.statusCode).toBe(HTTP.notFound);
      expect(problem(patch).code).toBe('ERP-CORE-0004');
      expect(ctx.events.count).toBe(0);
    });
  });

  describe('DELETE :id', () => {
    it('answers 204 with no body, then GET :id is 404 ERP-CORE-0004; one event and one log line', async () => {
      const id = await created('Short-lived');
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.noContent);
      expect(res.payload).toBe('');
      const gone = await send('GET', record(id), TEST_BEARERS.admin);
      expect(gone.statusCode).toBe(HTTP.notFound);
      expect(problem(gone).code).toBe('ERP-CORE-0004');
      const events = ctx.events.drain();
      expect(events.map((event) => event.constructor)).toEqual([AnnouncementsDeletedV1]);
      expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual(['at', 'id']);
      expect(ctx.logger.lines).toEqual([
        { message: 'announcement deleted', meta: { id: Number(id) } },
      ]);
    });

    it('removes only the one row', async () => {
      const id = await created('Only me');
      const total = await ctx.repo.count(ALL);
      await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(await ctx.repo.count(ALL)).toBe(total - 1);
    });

    it('of a missing id is 404 ERP-CORE-0004, and nothing is published', async () => {
      const res = await send('DELETE', record(9_999), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.notFound);
      expect(problem(res).code).toBe('ERP-CORE-0004');
      expect(ctx.events.count).toBe(0);
      expect(ctx.logger.lines).toEqual([]);
    });
  });

  describe('every export format through the shared core', () => {
    const FORMATS = ['csv', 'xlsx', 'pdf', 'print'] as const;

    it('csv answers id, name and dateadded only, the attachment name, no-store and a BOM', async () => {
      const res = await send('GET', `${EXPORT}?sort=name`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="announcements-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.payload.startsWith(`${CSV_BOM}id,name,dateadded\r\n`)).toBe(true);
      expect(res.payload).toContain('1,Head Office,2026-01-05T09:00:00.000Z\r\n');
      expect(res.payload).not.toContain('Open on Sunday');
    });

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)(
      'format=%s answers its content type and announcements-<date>.<ext>',
      async (format, type, magic) => {
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.ok);
        expect(res.headers['content-type']).toBe(type);
        expect(res.headers['content-disposition']).toMatch(
          new RegExp(`^attachment; filename="announcements-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`),
        );
        expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
      },
    );

    it('format=print answers the three columns as text rows, no attachment', async () => {
      const res = await send('GET', `${EXPORT}?format=print&q=warehouse`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-disposition']).toBeUndefined();
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['id', 'name', 'dateadded']);
      expect(body.rows).toEqual([['2', 'Warehouse', '2026-01-20T09:00:00.000Z']]);
    });

    it.each(FORMATS)(
      'format=%s from the every-code bearer is 403 and nothing is counted',
      async (format) => {
        const count = vi.spyOn(ctx.repo, 'count');
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.everyCode);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(count).not.toHaveBeenCalled();
      },
    );

    it('escapes a formula in a name and in a header label', async () => {
      await created('=HYPERLINK("http://x","y")');
      const labels = ['@SUM(1)', 'Name', 'Date'].map((l) => `header=${encodeURIComponent(l)}`);
      const res = await send(
        'GET',
        `${EXPORT}?q=hyperlink&${labels.join('&')}`,
        TEST_BEARERS.admin,
      );
      expect(res.statusCode).toBe(HTTP.ok);
      const [header, row] = res.payload.slice(CSV_BOM.length).split('\r\n');
      expect(header).toBe("'@SUM(1),Name,Date");
      expect(row).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
    });

    it("key is a 400 on ['key'] (no bulk actions); limit and cursor still are", async () => {
      for (const [query, path] of [
        ['key=3', 'key'],
        ['limit=10', 'limit'],
        ['cursor=abc', 'cursor'],
      ] as const) {
        const res = await send('GET', `${EXPORT}?${query}`, TEST_BEARERS.admin);
        expect(res.statusCode, query).toBe(HTTP.bad);
        expect(problem(res).issues, query).toEqual([expect.objectContaining({ path: [path] })]);
      }
    });

    it('column=name exports that one column', async () => {
      const res = await send('GET', `${EXPORT}?column=name&q=warehouse`, TEST_BEARERS.admin);
      expect(res.payload).toBe(`${CSV_BOM}name\r\nWarehouse\r\n`);
    });
  });

  it.each(ROUTES.filter((route) => route.method !== 'DELETE'))(
    '$method $url carries x-request-id, minted when absent and echoed when valid',
    async ({ method, url, payload }) => {
      const minted = await send(method, url, TEST_BEARERS.admin, payload);
      expect(minted.headers['x-request-id']).toMatch(UUID);
      const echoed = await ctx.app.inject({
        method,
        url,
        headers: { ...bearer(TEST_BEARERS.admin), 'x-request-id': 'web-trace-1' },
        ...(payload === undefined ? {} : { payload }),
      });
      expect(echoed.headers['x-request-id']).toBe('web-trace-1');
    },
  );

  it('ADR-0030: every route is under /api/v1/ or one of UNPREFIXED_ROUTES', () => {
    expect(ctx.routes.length).toBeGreaterThanOrEqual(6);
    const unprefixed: readonly string[] = UNPREFIXED_ROUTES.map((route) => `/${route}`);
    for (const route of ctx.routes) {
      const url = route.slice(route.indexOf(' ') + 1);
      expect(url.startsWith(`/${API_PREFIX}/`) || unprefixed.includes(url), route).toBe(true);
    }
  });
});
