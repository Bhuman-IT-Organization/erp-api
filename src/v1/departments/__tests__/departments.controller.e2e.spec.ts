/**
 * The HTTP contract of `api/v1/departments` in-process (the test app: the real module, guards, prefix
 * and filter; the repository faked; one `staffMembers` counter and one staff directory registered
 * through the real facade at init, their answers settable): exactly the five read routes and no
 * write route (`tbldepartments` is Perfex's; Node only reads it), administrators only on every route
 * (D-06, D-45), the record with exactly its keys (D-47), the two pickers (D-49), the counts the reads
 * show (D-51), and the four export formats (ADR-0043).
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { CSV_BOM } from '../../../shared/http/csv.js';
import { PDF_CONTENT_TYPE } from '../../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../../shared/http/xlsx.js';
import { DEPARTMENTS_ROUTES } from '../departments.routes.js';
import {
  departmentsListResponseSchema,
  departmentsManagersResponseSchema,
  departmentsOptionsResponseSchema,
  departmentsResponseSchema,
} from '../dto/departments.dto.js';
import { NO_DEPARTMENT_USAGE } from '../service/departments.transformer.js';
import {
  createDepartmentsTestApp,
  TEST_BEARERS,
  type DepartmentsTestApp,
} from './create-departments-test-app.js';
import { SEED_DEPARTMENTS } from './fakes.js';

const LIST = `/${API_PREFIX}/${DEPARTMENTS_ROUTES.base}`;
const EXPORT = `${LIST}/${DEPARTMENTS_ROUTES.export}`;
const MANAGERS = `${LIST}/${DEPARTMENTS_ROUTES.managers}`;
const OPTIONS = `${LIST}/${DEPARTMENTS_ROUTES.options}`;
const record = (id: string | number): string => `${LIST}/${String(id)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HTTP = {
  ok: 200,
  bad: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
};
const ADMIN_ONLY = 'departments are managed by administrators only';
const BODY = { name: 'Ops', hideFromClient: false, calendarId: '' } as const;

/** The exact keys of a record on the wire (D-47: never a mailbox column). */
const RECORD_KEYS = [
  'calendarId',
  'hideFromClient',
  'id',
  'managerId',
  'managerName',
  'name',
  'parentId',
  'parentName',
  'registeredUsage',
  'usage',
];

/** The five read routes, each with the status an administrator gets. */
const ROUTES: readonly { name: string; url: (id: string) => string; admin: number }[] = [
  { name: 'GET list', url: () => LIST, admin: HTTP.ok },
  { name: 'GET export', url: () => EXPORT, admin: HTTP.ok },
  { name: 'GET managers', url: () => MANAGERS, admin: HTTP.ok },
  { name: 'GET options', url: () => OPTIONS, admin: HTTP.ok },
  { name: 'GET :id', url: () => record(1), admin: HTTP.ok },
];

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('DepartmentsController (Fastify inject, no network)', () => {
  let ctx: DepartmentsTestApp;

  beforeAll(async () => {
    ctx = await createDepartmentsTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    // The seed back as it was: rows a case seeded are dropped, the four seed rows restored.
    ctx.repo.reset(SEED_DEPARTMENTS);
    ctx.repo.usage.clear();
    ctx.repo.usageError = null;
    ctx.repo.calls.length = 0;
    ctx.counter.answers.clear();
    ctx.counter.error = null;
    ctx.counter.asked.length = 0;
    ctx.directory.members = [
      { staffId: 12, name: 'Ada Lovelace' },
      { staffId: 11, name: 'Grace Hopper' },
    ];
    ctx.directory.calls.length = 0;
    ctx.directory.inactive.clear();
    ctx.logger.lines.length = 0;
  });

  const send = (url: string, token?: string): ReturnType<DepartmentsTestApp['app']['inject']> =>
    ctx.app.inject({
      method: 'GET',
      url,
      ...(token === undefined ? {} : { headers: bearer(token) }),
    });

  it('registers the five read routes under /api/v1/departments, the two pickers included', () => {
    for (const route of [
      `GET ${LIST}`,
      `GET ${EXPORT}`,
      `GET ${MANAGERS}`,
      `GET ${OPTIONS}`,
      `GET ${LIST}/:id`,
    ]) {
      expect(ctx.routes).toContain(route);
    }
  });

  it('registers no write route: tbldepartments belongs to Perfex, Node only reads it', () => {
    const departments = ctx.routes.filter((route) => route.includes(LIST));
    for (const route of departments) {
      expect(route.startsWith('GET ') || route.startsWith('HEAD '), route).toBe(true);
    }
  });

  it.each([
    ['POST', LIST],
    ['PATCH', record(1)],
    ['PUT', record(1)],
    ['DELETE', record(1)],
  ] as const)(
    '%s %s from the administrator is 404 and reads or writes nothing',
    async (method, url) => {
      const res = await ctx.app.inject({
        method,
        url,
        headers: bearer(TEST_BEARERS.admin),
        payload: BODY,
      });
      expect(res.statusCode).toBe(HTTP.notFound);
      expect(ctx.repo.calls).toEqual([]);
      expect(ctx.repo.all()).toEqual([...SEED_DEPARTMENTS].sort((a, b) => a.id - b.id));
    },
  );

  describe('administrators only (D-06, D-45, T-4.1-189)', () => {
    it.each(ROUTES)(
      '$name with a bearer holding every catalogue code, not an administrator, is 403 ERP-AUTH-0005 before any repository read, counter or directory call',
      async ({ url }) => {
        const res = await send(url('2'), TEST_BEARERS.everyCode);
        expect(res.statusCode).toBe(HTTP.forbidden);
        const body = problem(res);
        expect(body.code).toBe('ERP-AUTH-0005');
        expect(body.detail).toBe(ADMIN_ONLY);
        expect(ctx.repo.calls).toEqual([]);
        expect(ctx.counter.asked).toEqual([]);
        expect(ctx.directory.calls).toEqual([]);
        expect(ctx.logger.lines).toEqual([]);
      },
    );

    it.each(ROUTES)('$name with a bearer holding no code is 403 ERP-AUTH-0005', async (route) => {
      const res = await send(route.url('2'), TEST_BEARERS.noPermission);
      expect(res.statusCode).toBe(HTTP.forbidden);
      expect(problem(res).code).toBe('ERP-AUTH-0005');
    });

    it.each(ROUTES)('$name without a bearer is 401 ERP-AUTH-0004', async (route) => {
      const res = await send(route.url('2'));
      expect(res.statusCode).toBe(HTTP.unauthorized);
      expect(problem(res).code).toBe('ERP-AUTH-0004');
      expect(res.headers['x-request-id']).toBeTruthy();
    });

    it.each(ROUTES)(
      '$name with the administrator bearer is served ($admin) and writes no log line',
      async ({ url, admin }) => {
        const res = await send(url('2'), TEST_BEARERS.admin);
        expect(res.statusCode).toBe(admin);
        expect(ctx.logger.lines).toEqual([]);
      },
    );
  });

  describe('GET list and GET :id', () => {
    it("defaults to Perfex's order, the name ascending (ties on the id), each row with exactly the record keys", async () => {
      const res = await send(LIST, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const body = departmentsListResponseSchema.parse(JSON.parse(res.payload));
      expect(body.data.map((row) => row.id)).toEqual(['4', '1', '2', '3']);
      const raw = JSON.parse(res.payload) as { data: Record<string, unknown>[] };
      for (const row of raw.data) expect(Object.keys(row).sort()).toEqual(RECORD_KEYS);
      expect(body.meta).toMatchObject({ total: 4, rangeStart: 1, prevCursor: null });
    });

    it('each row carries every register group and the registered staff count', async () => {
      ctx.repo.usage.set(2, { ...NO_DEPARTMENT_USAGE, tickets: 3, childDepartments: 1 });
      ctx.counter.answers.set(2, 4);
      const res = await send(record(2), TEST_BEARERS.admin);
      const body = departmentsResponseSchema.parse(JSON.parse(res.payload));
      expect(Object.keys(body.usage)).toEqual(Object.keys(NO_DEPARTMENT_USAGE));
      expect(body.usage).toMatchObject({ tickets: 3, childDepartments: 1 });
      expect(body.registeredUsage).toEqual({ staffMembers: 4 });
    });

    it('a counter that rejects or a usage read that fails fails the read closed', async () => {
      ctx.counter.error = new Error('lock wait timeout');
      expect((await send(record(1), TEST_BEARERS.admin)).statusCode).toBeGreaterThanOrEqual(500);
      ctx.counter.error = null;
      ctx.repo.usageError = new Error('information_schema unavailable');
      expect((await send(LIST, TEST_BEARERS.admin)).statusCode).toBeGreaterThanOrEqual(500);
    });

    it('GET :id answers the record with its names; a missing id is 404, a non-numeric one 400', async () => {
      const res = await send(record(3), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(departmentsResponseSchema.parse(JSON.parse(res.payload))).toMatchObject({
        id: '3',
        parentId: '2',
        parentName: 'Support',
        managerId: null,
        managerName: null,
      });
      expect(problem(await send(record(404), TEST_BEARERS.admin)).code).toBe('ERP-CORE-0004');
      expect((await send(record('x'), TEST_BEARERS.admin)).statusCode).toBe(HTTP.bad);
    });

    it('a stored manager the directory no longer knows reads with a null name', async () => {
      ctx.directory.members = [];
      const res = await send(record(1), TEST_BEARERS.admin);
      expect(JSON.parse(res.payload)).toMatchObject({ managerId: '11', managerName: null });
    });
  });

  describe('the two pickers (D-49)', () => {
    it('GET managers answers the directory active members as { id, name }', async () => {
      const res = await send(MANAGERS, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(departmentsManagersResponseSchema.parse(JSON.parse(res.payload))).toEqual({
        data: [
          { id: '12', name: 'Ada Lovelace' },
          { id: '11', name: 'Grace Hopper' },
        ],
      });
      expect(ctx.repo.calls).toEqual([]);
    });

    it('GET options answers every department by name then id with its parent', async () => {
      const res = await send(OPTIONS, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(departmentsOptionsResponseSchema.parse(JSON.parse(res.payload))).toEqual({
        data: [
          { id: '4', name: 'Accounts', parentId: null },
          { id: '1', name: 'Sales', parentId: null },
          { id: '2', name: 'Support', parentId: null },
          { id: '3', name: 'Support', parentId: '2' },
        ],
      });
      expect(ctx.counter.asked).toEqual([]);
    });
  });

  describe('every export format through the shared core', () => {
    const FORMATS = ['csv', 'xlsx', 'pdf', 'print'] as const;

    it('csv answers id, name and calendarId only, the attachment name, no-store and a BOM', async () => {
      const res = await send(`${EXPORT}?sort=id`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="departments-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(
        res.payload.startsWith(
          `${CSV_BOM}id,name,calendarId\r\n1,Sales,cal-sales\r\n2,Support,\r\n3,Support,cal-3\r\n4,Accounts,\r\n`,
        ),
      ).toBe(true);
      expect(ctx.repo.calls).not.toContain('usageByDepartment');
      expect(ctx.counter.asked).toEqual([]);
    });

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)(
      'format=%s answers its content type and departments-<date>.<ext>',
      async (format, type, magic) => {
        const res = await send(`${EXPORT}?format=${format}`, TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.ok);
        expect(res.headers['content-type']).toBe(type);
        expect(res.headers['content-disposition']).toMatch(
          new RegExp(`^attachment; filename="departments-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`),
        );
        expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
      },
    );

    it('format=print answers the three columns as text rows', async () => {
      const res = await send(`${EXPORT}?format=print&sort=id`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-disposition']).toBeUndefined();
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['id', 'name', 'calendarId']);
      expect(body.rows.slice(0, 2)).toEqual([
        ['1', 'Sales', 'cal-sales'],
        ['2', 'Support', ''],
      ]);
    });

    it.each(FORMATS)(
      'format=%s from the every-code bearer is 403 and nothing is read',
      async (format) => {
        const res = await send(`${EXPORT}?format=${format}`, TEST_BEARERS.everyCode);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(ctx.repo.calls).toEqual([]);
      },
    );

    it('escapes a formula in a name, a calendar id and a header label (T-4.1-199)', async () => {
      ctx.repo.seed([
        {
          id: 60,
          name: '=HYPERLINK',
          hideFromClient: false,
          calendarId: '@SUM(1)',
          managerId: null,
          parentId: null,
        },
      ]);
      const labels = ['+Id', 'Name', 'Calendar'].map(
        (label) => `header=${encodeURIComponent(label)}`,
      );
      const res = await send(`${EXPORT}?q=HYPERLINK&${labels.join('&')}`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const [header, row] = res.payload.slice(CSV_BOM.length).split('\r\n');
      expect(header).toBe("'+Id,Name,Calendar");
      expect(row).toBe("60,'=HYPERLINK,'@SUM(1)");
    });

    it("key is a 400 on ['key'] (no bulk actions); limit and cursor still are", async () => {
      for (const [query, path] of [
        ['key=3', 'key'],
        ['limit=10', 'limit'],
        ['cursor=abc', 'cursor'],
      ] as const) {
        const res = await send(`${EXPORT}?${query}`, TEST_BEARERS.admin);
        expect(res.statusCode, query).toBe(HTTP.bad);
        expect(problem(res).issues, query).toEqual([expect.objectContaining({ path: [path] })]);
      }
    });
  });

  it.each(ROUTES)(
    '$name carries x-request-id, minted when absent and echoed when valid',
    async ({ url }) => {
      const minted = await send(url('1'), TEST_BEARERS.admin);
      expect(minted.headers['x-request-id']).toMatch(UUID);
      const echoed = await ctx.app.inject({
        method: 'GET',
        url: url('1'),
        headers: { ...bearer(TEST_BEARERS.admin), 'x-request-id': 'web-trace-1' },
      });
      expect(echoed.headers['x-request-id']).toBe('web-trace-1');
    },
  );

  it('ADR-0030: every route is under /api/v1/ or one of UNPREFIXED_ROUTES', () => {
    expect(ctx.routes.length).toBeGreaterThanOrEqual(5);
    const unprefixed: readonly string[] = UNPREFIXED_ROUTES.map((route) => `/${route}`);
    for (const route of ctx.routes) {
      const url = route.slice(route.indexOf(' ') + 1);
      expect(url.startsWith(`/${API_PREFIX}/`) || unprefixed.includes(url), route).toBe(true);
    }
  });
});
