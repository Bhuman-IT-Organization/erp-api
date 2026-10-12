/**
 * The HTTP contract of the six routes under `/api/v1/expense-categories`, proven in-process with
 * Fastify `inject`: administrators only on every handler (D-06: a bearer holding every catalogue
 * code is refused 403 `ERP-AUTH-0005` before any read, an administrator is served, no bearer is 401
 * `ERP-AUTH-0004`), the list envelope with the usage counts, the detail, create, update, the DELETE
 * with its in-use 409 (D-07, D-15), the names Perfex accepts saved and read back byte-identical
 * (D-19, T-4.1-07), the CSV export with its headers, BOM and formula escape, `x-request-id` on every
 * response, and the ADR-0030 route assertion (every route under `/api/v1/` or in
 * `UNPREFIXED_ROUTES`).
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { CSV_BOM, EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { PDF_CONTENT_TYPE } from '../../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../../shared/http/xlsx.js';
import {
  expenseCategoriesListResponseSchema,
  expenseCategoriesResponseSchema,
} from '../dto/expense-categories.dto.js';
import {
  ExpenseCategoriesCreatedV1,
  ExpenseCategoriesDeletedV1,
  ExpenseCategoriesUpdatedV1,
} from '../events/published.js';
import { EXPENSE_CATEGORIES_ROUTES } from '../expense-categories.routes.js';
import {
  createExpenseCategoriesTestApp,
  TEST_BEARERS,
  type ExpenseCategoriesTestApp,
} from './create-expense-categories-test-app.js';

const LIST = `/${API_PREFIX}/${EXPENSE_CATEGORIES_ROUTES.base}`;
const EXPORT = `${LIST}/${EXPENSE_CATEGORIES_ROUTES.export}`;
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
  conflict: 409,
};
/** Every row: the store's own match with no search, for a count. */
const ALL = { search: null, sortField: 'id', order: 'asc', cursor: null, limit: 1 } as const;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** The six routes, each with the body it needs and the status an administrator gets. */
const ROUTES: readonly { method: Method; url: string; payload?: object; admin: number }[] = [
  { method: 'GET', url: LIST, admin: HTTP.ok },
  { method: 'GET', url: EXPORT, admin: HTTP.ok },
  { method: 'GET', url: record(1), admin: HTTP.ok },
  { method: 'POST', url: LIST, payload: { name: 'New' }, admin: HTTP.created },
  { method: 'PATCH', url: record(1), payload: { name: 'First' }, admin: HTTP.ok },
  { method: 'DELETE', url: record(3), admin: HTTP.noContent },
];

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('ExpenseCategoriesController (Fastify inject, no network)', () => {
  let ctx: ExpenseCategoriesTestApp;

  beforeAll(async () => {
    ctx = await createExpenseCategoriesTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    ctx.repo.usage.clear();
    vi.restoreAllMocks();
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<ExpenseCategoriesTestApp['app']['inject']> =>
    ctx.app.inject({
      method,
      url,
      ...(token === undefined ? {} : { headers: bearer(token) }),
      ...(payload === undefined ? {} : { payload }),
    });

  /** A fresh row to delete or change, so each case owns its data. */
  const created = async (name: string, description?: string): Promise<string> => {
    const res = await send('POST', LIST, TEST_BEARERS.admin, {
      name,
      ...(description === undefined ? {} : { description }),
    });
    expect(res.statusCode).toBe(HTTP.created);
    return expenseCategoriesResponseSchema.parse(JSON.parse(res.payload)).id;
  };

  it('registers the six routes under /api/v1/expense-categories, DELETE included', () => {
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

  describe('administrators only (D-06, T-4.1-01)', () => {
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
          vi.spyOn(ctx.repo, 'usageByCategory'),
        ];
        const res = await send(method, url, TEST_BEARERS.everyCode, payload);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(problem(res).code).toBe('ERP-AUTH-0005');
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

  it('GET list answers the envelope on the superset meta, each row with its usage counts and its description in the read form', async () => {
    ctx.repo.usage.set(2, { expenses: 2, accountingMappings: 0, pettyCashAdvances: 1 });
    const res = await send('GET', `${LIST}?q=second`, TEST_BEARERS.admin);
    expect(res.statusCode).toBe(HTTP.ok);
    const body = expenseCategoriesListResponseSchema.parse(JSON.parse(res.payload));
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toEqual({
      id: '2',
      name: 'Second',
      description: 'Line one\nline two',
      expenseCount: 2,
      mappingCount: 0,
      pettyCashCount: 1,
    });
    expect(body.meta).toMatchObject({
      total: 1,
      rangeStart: 1,
      prevCursor: null,
      nextCursor: null,
    });
    expect(body.meta.exportLimit).toBeGreaterThan(0);
    expect(res.payload).not.toContain('<br');
  });

  it('a bad list query is 400 ERP-VALIDATION-0001 with the issues', async () => {
    const res = await send('GET', `${LIST}?sort=description`, TEST_BEARERS.admin);
    expect(res.statusCode).toBe(HTTP.bad);
    const body = problem(res);
    expect(body.code).toBe('ERP-VALIDATION-0001');
    expect(JSON.stringify(body.issues)).toContain('sort');
  });

  it('POST 201, then GET :id 200, then PATCH 200: one event and one log line each, the description stored in its nl2br form', async () => {
    const res = await send('POST', LIST, TEST_BEARERS.admin, {
      name: 'Written',
      description: 'two\nlines',
    });
    expect(res.statusCode).toBe(HTTP.created);
    const dto = expenseCategoriesResponseSchema.parse(JSON.parse(res.payload));
    expect(dto).toMatchObject({ name: 'Written', description: 'two\nlines' });
    expect((await ctx.repo.findById(Number(dto.id)))?.description).toBe('two<br />\nlines');

    const read = await send('GET', record(dto.id), TEST_BEARERS.admin);
    expect(read.statusCode).toBe(HTTP.ok);
    expect(JSON.parse(read.payload)).toEqual(dto);

    const updated = await send('PATCH', record(dto.id), TEST_BEARERS.admin, { name: 'Rewritten' });
    expect(updated.statusCode).toBe(HTTP.ok);
    expect(JSON.parse(updated.payload)).toEqual({ ...dto, name: 'Rewritten' });

    expect(ctx.events.drain().map((event) => event.constructor)).toEqual([
      ExpenseCategoriesCreatedV1,
      ExpenseCategoriesUpdatedV1,
    ]);
    const id = Number(dto.id);
    expect(ctx.logger.lines).toEqual([
      { message: 'expense category created', meta: { id } },
      { message: 'expense category updated', meta: { id } },
    ]);
  });

  it.each(['<script>alert(1)</script>', 'Fuel < 50 km'])(
    'the name %s saves (201) and reads back byte-identical: no character is refused (D-19, T-4.1-07)',
    async (name) => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name });
      expect(res.statusCode).toBe(HTTP.created);
      const { id } = expenseCategoriesResponseSchema.parse(JSON.parse(res.payload));
      const read = await send('GET', record(id), TEST_BEARERS.admin);
      expect(read.statusCode).toBe(HTTP.ok);
      expect(expenseCategoriesResponseSchema.parse(JSON.parse(read.payload)).name).toBe(name);
    },
  );

  describe('DELETE :id (D-07, D-15)', () => {
    it('answers 204 with no body, then GET :id is 404 ERP-CORE-0004; one event and one log line', async () => {
      const id = await created('Short-lived');
      ctx.events.drain();
      ctx.logger.lines.length = 0;
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.noContent);
      expect(res.payload).toBe('');
      const gone = await send('GET', record(id), TEST_BEARERS.admin);
      expect(gone.statusCode).toBe(HTTP.notFound);
      expect(problem(gone).code).toBe('ERP-CORE-0004');
      const events = ctx.events.drain();
      expect(events.map((event) => event.constructor)).toEqual([ExpenseCategoriesDeletedV1]);
      const [deleted] = events;
      expect(deleted).toBeInstanceOf(ExpenseCategoriesDeletedV1);
      if (!(deleted instanceof ExpenseCategoriesDeletedV1)) return;
      expect(deleted.payload.id).toBe(Number(id));
      expect(Object.keys(deleted.payload).sort()).toEqual(['at', 'id']);
      expect(ctx.logger.lines).toEqual([
        { message: 'expense category deleted', meta: { id: Number(id) } },
      ]);
    });

    it('of a missing id is 404 ERP-CORE-0004, and nothing is published', async () => {
      const res = await send('DELETE', record(9_999), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.notFound);
      expect(problem(res).code).toBe('ERP-CORE-0004');
      expect(ctx.events.count).toBe(0);
    });

    it('of a non-numeric id is 400, never a 404 probe', async () => {
      const res = await send('DELETE', record('abc'), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.bad);
      expect(problem(res).code).toBe('ERP-VALIDATION-0001');
    });

    it.each([
      ['an expense', { expenses: 1, accountingMappings: 0, pettyCashAdvances: 0 }],
      ['an accounting mapping', { expenses: 0, accountingMappings: 1, pettyCashAdvances: 0 }],
      ['a petty cash advance', { expenses: 0, accountingMappings: 0, pettyCashAdvances: 1 }],
    ])(
      'of a row used by %s is 409 ERP-EXPENSECATEGORIES-0001: the row stays readable, no event, no log line',
      async (_label, usage) => {
        const id = await created('In use');
        ctx.events.drain();
        ctx.logger.lines.length = 0;
        ctx.repo.usage.set(Number(id), usage);
        const total = await ctx.repo.count(ALL);
        const res = await send('DELETE', record(id), TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.conflict);
        const body = problem(res);
        expect(body.code).toBe('ERP-EXPENSECATEGORIES-0001');
        expect(body.detail).toBe(
          `used by ${String(usage.expenses)} expense(s), ${String(usage.accountingMappings)} accounting mapping(s) and ${String(usage.pettyCashAdvances)} petty cash advance(s)`,
        );
        expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.ok);
        expect(await ctx.repo.count(ALL)).toBe(total);
        expect(ctx.events.count).toBe(0);
        expect(ctx.logger.lines).toEqual([]);
      },
    );
  });

  it('a non-numeric :id is a 400, never a 404 probe; PATCH of a missing id is 404', async () => {
    const res = await send('GET', record('abc'), TEST_BEARERS.admin);
    expect(res.statusCode).toBe(HTTP.bad);
    expect(problem(res).code).toBe('ERP-VALIDATION-0001');
    const patch = await send('PATCH', record(9_999), TEST_BEARERS.admin, { name: 'Nobody' });
    expect(patch.statusCode).toBe(HTTP.notFound);
    expect(problem(patch).code).toBe('ERP-CORE-0004');
  });

  it.each([{ id: 77 }, { expenseCount: 1 }, { label: 'x' }])(
    'mass assignment %o is 400 naming the key, and nothing is stored',
    async (extra) => {
      const total = await ctx.repo.count(ALL);
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: 'Sneaky', ...extra });
      expect(res.statusCode).toBe(HTTP.bad);
      expect(JSON.stringify(problem(res).issues)).toContain(Object.keys(extra)[0] ?? '');
      expect(await ctx.repo.count(ALL)).toBe(total);
      const patch = await send('PATCH', record(1), TEST_BEARERS.admin, extra);
      expect(patch.statusCode).toBe(HTTP.bad);
    },
  );

  it('GET export answers 200 text/csv with the attachment name, no-store and a BOM; the description in its read form; /export wins over :id', async () => {
    const res = await send('GET', `${EXPORT}?sort=id`, TEST_BEARERS.admin);
    expect(res.statusCode).toBe(HTTP.ok);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="expense-categories-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(res.payload.startsWith(`${CSV_BOM}id,name,description\r\n1,`)).toBe(true);
    expect(res.payload).toContain('2,Second,"Line one\nline two"\r\n');
    expect(res.payload).not.toContain('<br');
  });

  it('GET export escapes a formula in a cell and in a header label (T-3.2-89, T-4.1-04)', async () => {
    await send('POST', LIST, TEST_BEARERS.admin, { name: '=HYPERLINK("http://x","y")' });
    const labels = ['@SUM(1)', 'Name', 'Description'].map((l) => `header=${encodeURIComponent(l)}`);
    const res = await send('GET', `${EXPORT}?q=hyperlink&${labels.join('&')}`, TEST_BEARERS.admin);
    expect(res.statusCode).toBe(HTTP.ok);
    const [header, row] = res.payload.slice(CSV_BOM.length).split('\r\n');
    expect(header).toBe("'@SUM(1),Name,Description");
    expect(row).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it('GET export refuses limit and cursor on their path', async () => {
    const res = await send('GET', `${EXPORT}?limit=10`, TEST_BEARERS.admin);
    expect(res.statusCode).toBe(HTTP.bad);
    expect(JSON.stringify(problem(res).issues)).toContain('limit');
  });

  describe('every format through the shared core (04.1.1-02)', () => {
    const FORMATS = ['csv', 'xlsx', 'pdf', 'print'] as const;
    /** A category named in Arabic script: outside the PDF standard font's WinAnsi range (D-24). */
    const ARABIC_NAME = '\u0645\u0648\u0627\u0635\u0644\u0627\u062A';

    it.each(FORMATS)(
      'format=%s from a bearer holding every catalogue code, not an administrator, is 403 ERP-AUTH-0005 and nothing is counted',
      async (format) => {
        const count = vi.spyOn(ctx.repo, 'count');
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.everyCode);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(problem(res).code).toBe('ERP-AUTH-0005');
        expect(count).not.toHaveBeenCalled();
      },
    );

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)(
      'format=%s answers its content type, expense-categories-<date>.<ext> and no-store',
      async (format, contentType, magic) => {
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.ok);
        expect(res.headers['content-type']).toBe(contentType);
        expect(res.headers['content-disposition']).toMatch(
          new RegExp(
            `^attachment; filename="expense-categories-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`,
          ),
        );
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
      },
    );

    it('format=print answers JSON rows with no-store and no attachment, the description in its read form', async () => {
      const res = await send('GET', `${EXPORT}?format=print&q=second`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-disposition']).toBeUndefined();
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['id', 'name', 'description']);
      expect(body.rows).toEqual([['2', 'Second', 'Line one\nline two']]);
    });

    it('key is a 400 on its path: the list has no row selection (D-27); limit and cursor still are', async () => {
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

    it('column=description exports that one column (D-13)', async () => {
      const res = await send('GET', `${EXPORT}?column=description&q=second`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.payload).toBe(`${CSV_BOM}description\r\n"Line one\nline two"\r\n`);
    });

    it.each([
      ['pdf', PRINT_MAX_ROWS],
      ['print', PRINT_MAX_ROWS],
      ['csv', EXPORT_MAX_ROWS],
      ['xlsx', EXPORT_MAX_ROWS],
    ] as const)(
      'format=%s over its cap (%i) is refused on the export path before any page is read',
      async (format, limit) => {
        vi.spyOn(ctx.repo, 'count').mockResolvedValue(limit + 1);
        const list = vi.spyOn(ctx.repo, 'list');
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.bad);
        expect(problem(res).issues).toEqual([
          {
            path: ['export'],
            message: 'too many rows to export',
            params: { limit, total: limit + 1 },
          },
        ]);
        expect(list).not.toHaveBeenCalled();
      },
    );

    it('a category named in Arabic refuses format=pdf on the font path and prints in format=print (D-24)', async () => {
      const id = await created(ARABIC_NAME);
      const pdf = await send('GET', `${EXPORT}?format=pdf`, TEST_BEARERS.admin);
      expect(pdf.statusCode).toBe(HTTP.bad);
      expect(problem(pdf).issues).toEqual([expect.objectContaining({ path: ['font'] })]);
      const print = await send('GET', `${EXPORT}?format=print`, TEST_BEARERS.admin);
      expect(print.statusCode).toBe(HTTP.ok);
      const body = JSON.parse(print.payload) as { rows: string[][] };
      expect(body.rows.map((row) => row[1])).toContain(ARABIC_NAME);
      expect((await send('DELETE', record(id), TEST_BEARERS.admin)).statusCode).toBe(
        HTTP.noContent,
      );
    });

    it('the list meta carries printLimit beside exportLimit', async () => {
      const res = await send('GET', LIST, TEST_BEARERS.admin);
      const body = expenseCategoriesListResponseSchema.parse(JSON.parse(res.payload));
      expect(body.meta).toMatchObject({ exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS });
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
      expect(echoed.payload).not.toContain('web-trace-1');
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
