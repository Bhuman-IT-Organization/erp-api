/**
 * The HTTP contract of the six routes under `/api/v1/ticket-priorities`, proven in-process with
 * Fastify `inject` over the in-memory fake and the real guards: administrators only on every
 * handler (a bearer holding every catalogue code is refused 403 `ERP-AUTH-0005` before any read, a
 * bearer holding none is 403, no bearer is 401 `ERP-AUTH-0004`, an administrator is served), the
 * list in Perfex's order (the id descending), create and rename, the DELETE with its 409
 * `ERP-TICKETPRIORITIES-0001` while a ticket uses the priority or its use cannot be counted and
 * 409 `ERP-TICKETPRIORITIES-0002` for the email-piping default, the export of `id` and `name`,
 * `x-request-id` on every response, and the ADR-0030 route assertion.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { CSV_BOM, EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { PDF_CONTENT_TYPE } from '../../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../../shared/http/xlsx.js';
import { ticketPrioritiesResponseSchema } from '../dto/ticket-priorities.dto.js';
import {
  TicketPrioritiesCreatedV1,
  TicketPrioritiesDeletedV1,
  TicketPrioritiesUpdatedV1,
} from '../events/published.js';
import { EMAIL_PIPING_DEFAULT_PRIORITY_OPTION } from '../service/ticket-priorities.transport.js';
import {
  createTicketPrioritiesTestApp,
  TEST_BEARERS,
  TEST_ZONE,
  type TicketPrioritiesTestApp,
} from './create-ticket-priorities-test-app.js';

const LIST = `/${API_PREFIX}/ticket-priorities`;
const EXPORT = `${LIST}/export`;
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

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

interface ListBody {
  readonly data: readonly { readonly id: string; readonly name: string }[];
  readonly meta: { readonly exportLimit: number; readonly printLimit: number };
}

/** The six routes, each with the body it needs and the status an administrator gets. */
const ROUTES: readonly { method: Method; url: string; payload?: object; admin: number }[] = [
  { method: 'GET', url: LIST, admin: HTTP.ok },
  { method: 'GET', url: EXPORT, admin: HTTP.ok },
  { method: 'GET', url: record(1), admin: HTTP.ok },
  { method: 'POST', url: LIST, payload: { name: 'New' }, admin: HTTP.created },
  { method: 'PATCH', url: record(1), payload: { name: 'Low' }, admin: HTTP.ok },
  { method: 'DELETE', url: record(2), admin: HTTP.noContent },
];

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('TicketPrioritiesController (Fastify inject, no network)', () => {
  let ctx: TicketPrioritiesTestApp;

  beforeAll(async () => {
    ctx = await createTicketPrioritiesTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    ctx.repo.referenced.clear();
    ctx.repo.isReferencedFails = false;
    ctx.settings.options = [{ name: 'default_timezone', value: TEST_ZONE }];
    ctx.settings.calls.length = 0;
    vi.restoreAllMocks();
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<TicketPrioritiesTestApp['app']['inject']> =>
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
    return ticketPrioritiesResponseSchema.parse(JSON.parse(res.payload)).id;
  };

  it('registers the six routes under /api/v1/ticket-priorities, DELETE included', () => {
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

  describe('administrators only (ADR-0034 d.2)', () => {
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
          vi.spyOn(ctx.repo, 'isReferenced'),
        ];
        const res = await send(method, url, TEST_BEARERS.everyCode, payload);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(problem(res).code).toBe('ERP-AUTH-0005');
        for (const spy of reads) expect(spy).not.toHaveBeenCalled();
        expect(ctx.settings.calls).toEqual([]);
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
      '$method $url with an unknown bearer is 401 ERP-AUTH-0004',
      async ({ method, url, payload }) => {
        const res = await send(method, url, 'not-a-real-token', payload);
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

  describe('GET list and GET :id', () => {
    it("defaults to Perfex's order, the id descending, with no sort sent", async () => {
      const res = await send('GET', LIST, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const body = JSON.parse(res.payload) as ListBody;
      const order = body.data.map((row) => Number(row.id));
      expect(order).toEqual([...order].sort((x, y) => y - x));
      expect(order.slice(-4)).toEqual([4, 3, 2, 1]);
      expect(body.meta).toMatchObject({ exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS });
    });

    it('sorts by name and searches the name, case-insensitively', async () => {
      const res = await send('GET', `${LIST}?sort=name&q=MED`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const body = JSON.parse(res.payload) as ListBody;
      expect(body.data).toEqual([{ id: '2', name: 'Medium' }]);
    });

    it('GET :id answers the id as a string and the name', async () => {
      const res = await send('GET', record(1), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(res.payload)).toEqual({ id: '1', name: 'Low' });
    });

    it('a bad list query is 400 ERP-VALIDATION-0001 with the issues', async () => {
      const res = await send('GET', `${LIST}?sort=priorityid`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.bad);
      const body = problem(res);
      expect(body.code).toBe('ERP-VALIDATION-0001');
      expect(JSON.stringify(body.issues)).toContain('sort');
    });

    it('a non-numeric :id is a 400, never a 404 probe; a missing id is 404 ERP-CORE-0004', async () => {
      expect((await send('GET', record('abc'), TEST_BEARERS.admin)).statusCode).toBe(HTTP.bad);
      const missing = await send('GET', record(9_999), TEST_BEARERS.admin);
      expect(missing.statusCode).toBe(HTTP.notFound);
      expect(problem(missing).code).toBe('ERP-CORE-0004');
    });
  });

  describe('POST and PATCH', () => {
    it('POST 201, GET :id 200, PATCH 200: the trimmed name, one event and one log line each', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: '  Critical  ' });
      expect(res.statusCode).toBe(HTTP.created);
      const dto = ticketPrioritiesResponseSchema.parse(JSON.parse(res.payload));
      expect(dto).toEqual({ id: dto.id, name: 'Critical' });
      const read = await send('GET', record(dto.id), TEST_BEARERS.admin);
      expect(JSON.parse(read.payload)).toEqual(dto);
      const updated = await send('PATCH', record(dto.id), TEST_BEARERS.admin, {
        name: 'Blocker',
      });
      expect(updated.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(updated.payload)).toEqual({ id: dto.id, name: 'Blocker' });
      expect(ctx.events.drain().map((event) => event.constructor)).toEqual([
        TicketPrioritiesCreatedV1,
        TicketPrioritiesUpdatedV1,
      ]);
      const id = Number(dto.id);
      expect(ctx.logger.lines.map((line) => line.meta)).toEqual([{ id }, { id }]);
      expect(ctx.logger.lines[0]?.message).toBe('ticket priority created');
    });

    it('POST a name the seed already holds is 201: Perfex has no uniqueness check', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: 'High' });
      expect(res.statusCode).toBe(HTTP.created);
    });

    it.each([
      ['empty', { name: '' }],
      ['blank', { name: '   ' }],
      ['51 characters', { name: 'a'.repeat(51) }],
      ['missing', {}],
      ['with an extra key', { name: 'Sneaky', priorityid: 77 }],
    ])('POST with a name that is %s is 400, and nothing is stored', async (_label, body) => {
      const total = await ctx.repo.count(ALL);
      const res = await send('POST', LIST, TEST_BEARERS.admin, body);
      expect(res.statusCode).toBe(HTTP.bad);
      expect(problem(res).code).toBe('ERP-VALIDATION-0001');
      expect(await ctx.repo.count(ALL)).toBe(total);
      expect(ctx.events.count).toBe(0);
    });

    it("PATCH {} is 400 on ['name']; PATCH of a missing id is 404 and nothing is published", async () => {
      const empty = await send('PATCH', record(1), TEST_BEARERS.admin, {});
      expect(empty.statusCode).toBe(HTTP.bad);
      expect(problem(empty).issues).toEqual([expect.objectContaining({ path: ['name'] })]);
      const patch = await send('PATCH', record(9_999), TEST_BEARERS.admin, { name: 'Nobody' });
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
      expect(events.map((event) => event.constructor)).toEqual([TicketPrioritiesDeletedV1]);
      expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual(['at', 'id']);
      expect(ctx.logger.lines).toEqual([
        { message: 'ticket priority deleted', meta: { id: Number(id) } },
      ]);
    });

    it('of a missing id is 404 ERP-CORE-0004, and nothing is published', async () => {
      const res = await send('DELETE', record(9_999), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.notFound);
      expect(problem(res).code).toBe('ERP-CORE-0004');
      expect(ctx.events.count).toBe(0);
    });

    it('while a ticket uses it is 409 ERP-TICKETPRIORITIES-0001: the row stays, no event, no log line', async () => {
      const id = await created('In use');
      ctx.repo.referenced.add(Number(id));
      const total = await ctx.repo.count(ALL);
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.conflict);
      const body = problem(res);
      expect(body.code).toBe('ERP-TICKETPRIORITIES-0001');
      expect(body.detail).toBe('Priority in use by a ticket');
      expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.ok);
      expect(await ctx.repo.count(ALL)).toBe(total);
      expect(ctx.events.count).toBe(0);
      expect(ctx.logger.lines).toEqual([]);
    });

    it('when its use could not be counted is 409 ERP-TICKETPRIORITIES-0001, never a 500', async () => {
      const id = await created('Uncountable');
      ctx.repo.isReferencedFails = true;
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.conflict);
      const body = problem(res);
      expect(body.code).toBe('ERP-TICKETPRIORITIES-0001');
      expect(body.detail).toBe('its use could not be counted');
      expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.ok);
      expect(ctx.events.count).toBe(0);
    });

    it('of the email-piping default is 409 ERP-TICKETPRIORITIES-0002, and the row stays', async () => {
      const id = await created('Piped');
      ctx.settings.options = [
        { name: 'default_timezone', value: TEST_ZONE },
        { name: EMAIL_PIPING_DEFAULT_PRIORITY_OPTION, value: id },
      ];
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.conflict);
      expect(problem(res).code).toBe('ERP-TICKETPRIORITIES-0002');
      expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.ok);
      expect(ctx.events.count).toBe(0);
    });
  });

  describe('GET export', () => {
    const FORMATS = ['csv', 'xlsx', 'pdf', 'print'] as const;

    it('csv answers id and name only, the attachment name, no-store and a BOM', async () => {
      const res = await send('GET', `${EXPORT}?sort=id`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="ticket-priorities-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(
        res.payload.startsWith(`${CSV_BOM}id,name\r\n1,Low\r\n2,Medium\r\n3,High\r\n4,Urgent\r\n`),
      ).toBe(true);
    });

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)(
      'format=%s answers its content type and ticket-priorities-<date>.<ext>',
      async (format, type, magic) => {
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.ok);
        expect(res.headers['content-type']).toBe(type);
        expect(res.headers['content-disposition']).toMatch(
          new RegExp(`^attachment; filename="ticket-priorities-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`),
        );
        expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
      },
    );

    it('format=print answers the two columns as text rows, no attachment', async () => {
      const res = await send('GET', `${EXPORT}?format=print&q=urgent`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-disposition']).toBeUndefined();
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['id', 'name']);
      expect(body.rows).toEqual([['4', 'Urgent']]);
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
