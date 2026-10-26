/**
 * The HTTP contract of the six routes under `/api/v1/services`, proven in-process with Fastify
 * `inject` over the in-memory fake: administrators only on every handler (D-06, D-26: a bearer
 * holding every catalogue code is refused 403 `ERP-AUTH-0005` before any read, an administrator is
 * served, no bearer is 401 `ERP-AUTH-0004`), the list in Perfex's order (the id descending), Perfex's
 * outcomes (any name kept as text, a duplicate name accepted, nothing but the name saved), the
 * DELETE with its 409 `ERP-SERVICES-0001` while a ticket uses the service, the four-format export of
 * `id` and `name` with its formula escape, `x-request-id` on every response, and the ADR-0030 route
 * assertion.
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
  SERVICES_NAME_MAX,
  servicesListResponseSchema,
  servicesResponseSchema,
} from '../dto/services.dto.js';
import { ServicesCreatedV1, ServicesDeletedV1, ServicesUpdatedV1 } from '../events/published.js';
import { SERVICES_ROUTES } from '../services.routes.js';
import {
  createServicesTestApp,
  TEST_BEARERS,
  type ServicesTestApp,
} from './create-services-test-app.js';

const LIST = `/${API_PREFIX}/${SERVICES_ROUTES.base}`;
const EXPORT = `${LIST}/${SERVICES_ROUTES.export}`;
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
/** Every row: the fake's own match with no search, for a count. */
const ALL = { search: null, sortField: 'id', order: 'asc', cursor: null, limit: 1 } as const;
const ADMIN_ONLY = 'services are managed by administrators only';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** The six routes, each with the body it needs and the status an administrator gets. */
const ROUTES: readonly { method: Method; url: string; payload?: object; admin: number }[] = [
  { method: 'GET', url: LIST, admin: HTTP.ok },
  { method: 'GET', url: EXPORT, admin: HTTP.ok },
  { method: 'GET', url: record(1), admin: HTTP.ok },
  { method: 'POST', url: LIST, payload: { name: 'New' }, admin: HTTP.created },
  { method: 'PATCH', url: record(1), payload: { name: 'Gold Support' }, admin: HTTP.ok },
  { method: 'DELETE', url: record(2), admin: HTTP.noContent },
];

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('ServicesController (Fastify inject, no network)', () => {
  let ctx: ServicesTestApp;

  beforeAll(async () => {
    ctx = await createServicesTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    ctx.repo.tickets.clear();
    vi.restoreAllMocks();
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<ServicesTestApp['app']['inject']> =>
    ctx.app.inject({
      method,
      url,
      ...(token === undefined ? {} : { headers: bearer(token) }),
      ...(payload === undefined ? {} : { payload }),
    });

  /** A fresh row to delete or change, so each case owns its data; the log and events are cleared. */
  const created = async (name: string): Promise<string> => {
    const res = await send('POST', LIST, TEST_BEARERS.admin, { name });
    expect(res.statusCode).toBe(HTTP.created);
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    return servicesResponseSchema.parse(JSON.parse(res.payload)).id;
  };

  it('registers the six routes under /api/v1/services, DELETE included', () => {
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

  describe('administrators only (D-06, D-26, T-4.1-79)', () => {
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
          vi.spyOn(ctx.repo, 'countTickets'),
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
    it("defaults to Perfex's order, the id descending, with no sort sent", async () => {
      const res = await send('GET', LIST, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const body = servicesListResponseSchema.parse(JSON.parse(res.payload));
      const order = body.data.map((row) => Number(row.id));
      expect(order).toEqual([...order].sort((x, y) => y - x));
      expect(order.slice(-3)).toEqual([3, 2, 1]);
      expect(body.meta).toMatchObject({ exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS });
    });

    it('each row is { id, name } and nothing else', async () => {
      const res = await send('GET', `${LIST}?q=gold&sort=id`, TEST_BEARERS.admin);
      const body = servicesListResponseSchema.parse(JSON.parse(res.payload));
      expect(body.data.slice(0, 2)).toEqual([
        { id: '1', name: 'Gold Support' },
        { id: '3', name: 'Gold Support' },
      ]);
    });

    it('a bad list query is 400 ERP-VALIDATION-0001 with the issues (created is no sort)', async () => {
      const res = await send('GET', `${LIST}?sort=created`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.bad);
      expect(JSON.stringify(problem(res).issues)).toContain('sort');
    });
  });

  describe('POST and PATCH', () => {
    it('POST 201, GET :id 200, PATCH 200: the name only changed, one event and one log line each', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: '  Written  ' });
      expect(res.statusCode).toBe(HTTP.created);
      const dto = servicesResponseSchema.parse(JSON.parse(res.payload));
      expect(dto).toEqual({ id: dto.id, name: 'Written' });
      const read = await send('GET', record(dto.id), TEST_BEARERS.admin);
      expect(JSON.parse(read.payload)).toEqual(dto);
      const updated = await send('PATCH', record(dto.id), TEST_BEARERS.admin, {
        name: 'Rewritten',
      });
      expect(updated.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(updated.payload)).toEqual({ ...dto, name: 'Rewritten' });
      expect(ctx.events.drain().map((event) => event.constructor)).toEqual([
        ServicesCreatedV1,
        ServicesUpdatedV1,
      ]);
      const id = Number(dto.id);
      expect(ctx.logger.lines).toEqual([
        { message: 'service created', meta: { id } },
        { message: 'service updated', meta: { id } },
      ]);
    });

    it.each(['Fuel < 50 km', '<script>alert(1)</script>'])(
      'the name %s saves (201) and reads back byte-identical (names are text)',
      async (name) => {
        const res = await send('POST', LIST, TEST_BEARERS.admin, { name });
        expect(res.statusCode).toBe(HTTP.created);
        const { id } = servicesResponseSchema.parse(JSON.parse(res.payload));
        const read = await send('GET', record(id), TEST_BEARERS.admin);
        expect(servicesResponseSchema.parse(JSON.parse(read.payload))).toMatchObject({ name });
      },
    );

    it('POST a name the seed already holds is 201: Perfex has no uniqueness check', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: 'Gold Support' });
      expect(res.statusCode).toBe(HTTP.created);
    });

    it('a name of 50 characters saves; 51 is 400 on name (tblservices.name is VARCHAR(50))', async () => {
      const ok = await send('POST', LIST, TEST_BEARERS.admin, {
        name: 'a'.repeat(SERVICES_NAME_MAX),
      });
      expect(ok.statusCode).toBe(HTTP.created);
      const tooLong = await send('POST', LIST, TEST_BEARERS.admin, {
        name: 'a'.repeat(SERVICES_NAME_MAX + 1),
      });
      expect(tooLong.statusCode).toBe(HTTP.bad);
      expect(JSON.stringify(problem(tooLong).issues)).toContain('name');
    });

    it.each([{ serviceid: 9 }, { created_by: 9 }, { id: 77 }])(
      'POST with %o is 400 naming the key, and nothing is stored (T-4.1-80)',
      async (extra) => {
        const total = await ctx.repo.count(ALL);
        const res = await send('POST', LIST, TEST_BEARERS.admin, { name: 'Sneaky', ...extra });
        expect(res.statusCode).toBe(HTTP.bad);
        expect(JSON.stringify(problem(res).issues)).toContain(Object.keys(extra)[0] ?? '');
        expect(await ctx.repo.count(ALL)).toBe(total);
        expect(ctx.events.count).toBe(0);
      },
    );

    it("PATCH {} is 400 on ['name']; PATCH with an extra key is 400 and the row is unchanged", async () => {
      const empty = await send('PATCH', record(1), TEST_BEARERS.admin, {});
      expect(empty.statusCode).toBe(HTTP.bad);
      expect(problem(empty).issues).toEqual([expect.objectContaining({ path: ['name'] })]);
      const before = await ctx.repo.findById(3);
      const sneaky = await send('PATCH', record(3), TEST_BEARERS.admin, {
        name: 'Taken over',
        serviceid: 2,
      });
      expect(sneaky.statusCode).toBe(HTTP.bad);
      expect(await ctx.repo.findById(3)).toEqual(before);
    });

    it('a non-numeric :id is a 400, never a 404 probe; PATCH of a missing id is 404', async () => {
      const res = await send('GET', record('abc'), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.bad);
      const patch = await send('PATCH', record(9_999), TEST_BEARERS.admin, { name: 'Nobody' });
      expect(patch.statusCode).toBe(HTTP.notFound);
      expect(problem(patch).code).toBe('ERP-CORE-0004');
      expect(ctx.events.count).toBe(0);
    });
  });

  describe('DELETE :id (Perfex is_referenced)', () => {
    it('answers 204 with no body, then GET :id is 404 ERP-CORE-0004; one event and one log line', async () => {
      const id = await created('Short-lived');
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.noContent);
      expect(res.payload).toBe('');
      const gone = await send('GET', record(id), TEST_BEARERS.admin);
      expect(gone.statusCode).toBe(HTTP.notFound);
      expect(problem(gone).code).toBe('ERP-CORE-0004');
      const events = ctx.events.drain();
      expect(events.map((event) => event.constructor)).toEqual([ServicesDeletedV1]);
      expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual(['at', 'id']);
      expect(ctx.logger.lines).toEqual([{ message: 'service deleted', meta: { id: Number(id) } }]);
    });

    it('of a missing id is 404 ERP-CORE-0004, and nothing is published', async () => {
      const res = await send('DELETE', record(9_999), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.notFound);
      expect(problem(res).code).toBe('ERP-CORE-0004');
      expect(ctx.events.count).toBe(0);
    });

    it.each([
      [1, 'used by 1 ticket(s)'],
      [4, 'used by 4 ticket(s)'],
    ])(
      'of a service %i ticket(s) use is 409 ERP-SERVICES-0001: the row stays readable, no event, no log line',
      async (tickets, detail) => {
        const id = await created(`In use: ${String(tickets)}`);
        ctx.repo.tickets.set(Number(id), tickets);
        const total = await ctx.repo.count(ALL);
        const res = await send('DELETE', record(id), TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.conflict);
        const body = problem(res);
        expect(body.code).toBe('ERP-SERVICES-0001');
        expect(body.detail).toBe(detail);
        expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.ok);
        expect(await ctx.repo.count(ALL)).toBe(total);
        expect(ctx.events.count).toBe(0);
        expect(ctx.logger.lines).toEqual([]);
      },
    );

    it('the 409 detail names a count only, never the service name', async () => {
      const id = await created('Secret Name');
      ctx.repo.tickets.set(Number(id), 2);
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.payload).not.toContain('Secret Name');
    });
  });

  describe('every export format through the shared core', () => {
    const FORMATS = ['csv', 'xlsx', 'pdf', 'print'] as const;

    it('csv answers id and name only, the attachment name, no-store and a BOM', async () => {
      const res = await send('GET', `${EXPORT}?sort=id`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="services-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.payload.startsWith(`${CSV_BOM}id,name\r\n1,Gold Support\r\n2,Billing\r\n`)).toBe(
        true,
      );
    });

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)(
      'format=%s answers its content type and services-<date>.<ext>',
      async (format, type, magic) => {
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.ok);
        expect(res.headers['content-type']).toBe(type);
        expect(res.headers['content-disposition']).toMatch(
          new RegExp(`^attachment; filename="services-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`),
        );
        expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
      },
    );

    it('format=print answers the two columns as text rows, no attachment', async () => {
      const res = await send('GET', `${EXPORT}?format=print&q=billing`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-disposition']).toBeUndefined();
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['id', 'name']);
      expect(body.rows).toEqual([['2', 'Billing']]);
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
      const labels = ['@SUM(1)', 'Name'].map((l) => `header=${encodeURIComponent(l)}`);
      const res = await send(
        'GET',
        `${EXPORT}?q=hyperlink&${labels.join('&')}`,
        TEST_BEARERS.admin,
      );
      expect(res.statusCode).toBe(HTTP.ok);
      const [header, row] = res.payload.slice(CSV_BOM.length).split('\r\n');
      expect(header).toBe("'@SUM(1),Name");
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

    it('column=name exports that one column; the ticket count is never read', async () => {
      const tickets = vi.spyOn(ctx.repo, 'countTickets');
      const res = await send('GET', `${EXPORT}?column=name&q=billing`, TEST_BEARERS.admin);
      expect(res.payload).toBe(`${CSV_BOM}name\r\nBilling\r\n`);
      expect(tickets).not.toHaveBeenCalled();
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
