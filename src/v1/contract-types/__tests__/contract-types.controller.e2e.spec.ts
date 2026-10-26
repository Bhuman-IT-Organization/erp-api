/**
 * The HTTP contract of the six routes under `/api/v1/contract-types`, proven in-process with Fastify
 * `inject` over the in-memory fake: administrators only on every handler (D-06, D-26: a bearer
 * holding every catalogue code is refused 403 `ERP-AUTH-0005` before any read, an administrator is
 * served, no bearer is 401 `ERP-AUTH-0004`), the list in Perfex's order (the id descending) with each
 * row's usage and `dateCreated`, Perfex's outcomes (D-29: any name kept as text, a duplicate name
 * accepted, nothing but the name saved), D-31's `dateCreated` from the fixed clock in the company
 * zone, the DELETE with its 409 `ERP-CONTRACTTYPES-0001` for each of the groups (D-07, D-28), the
 * four-format export of `id`, `name` and `dateCreated` with its formula escape, `x-request-id` on
 * every response, and the ADR-0030 route assertion.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { CSV_BOM, EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { PDF_CONTENT_TYPE } from '../../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../../shared/http/xlsx.js';
import { CONTRACT_TYPES_ROUTES } from '../contract-types.routes.js';
import {
  contractTypesListResponseSchema,
  contractTypesResponseSchema,
} from '../dto/contract-types.dto.js';
import {
  ContractTypesCreatedV1,
  ContractTypesDeletedV1,
  ContractTypesUpdatedV1,
} from '../events/published.js';
import type { ContractTypeUsage } from '../model/contract-types.model.js';
import {
  createContractTypesTestApp,
  TEST_BEARERS,
  TEST_STAFF,
  TEST_ZONE,
  type ContractTypesTestApp,
} from './create-contract-types-test-app.js';
import { ZERO_USAGE } from './fakes.js';

const LIST = `/${API_PREFIX}/${CONTRACT_TYPES_ROUTES.base}`;
const EXPORT = `${LIST}/${CONTRACT_TYPES_ROUTES.export}`;
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
/** The fixed clock (`TEST_NOW`, 2026-10-02T20:30:15.250Z) as `dateCreated` answers it: to the second. */
const CREATED_AT = '2026-10-02T20:30:15.000Z';
/** Every row: the fake's own match with no search, for a count. */
const ALL = { search: null, sortField: 'id', order: 'asc', cursor: null, limit: 1 } as const;
const ADMIN_ONLY = 'contract types are managed by administrators only';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** The six routes, each with the body it needs and the status an administrator gets. */
const ROUTES: readonly { method: Method; url: string; payload?: object; admin: number }[] = [
  { method: 'GET', url: LIST, admin: HTTP.ok },
  { method: 'GET', url: EXPORT, admin: HTTP.ok },
  { method: 'GET', url: record(1), admin: HTTP.ok },
  { method: 'POST', url: LIST, payload: { name: 'New' }, admin: HTTP.created },
  { method: 'PATCH', url: record(1), payload: { name: 'Head Office' }, admin: HTTP.ok },
  { method: 'DELETE', url: record(2), admin: HTTP.noContent },
];

/** One usage per group, that group at 1 and the rest at 0, with the words its 409 detail uses. */
const ONE_GROUP: readonly (readonly [string, ContractTypeUsage, string])[] = [
  ['purchaseRequests', { ...ZERO_USAGE, purchaseRequests: 1 }, 'used by 1 purchase request(s)'],
  ['purchaseOrders', { ...ZERO_USAGE, purchaseOrders: 1 }, 'used by 1 purchase order(s)'],
  [
    'purchaseQuotations',
    { ...ZERO_USAGE, purchaseQuotations: 1 },
    'used by 1 purchase quotation(s)',
  ],
  ['shippingCharges', { ...ZERO_USAGE, shippingCharges: 1 }, 'used by 1 shipping charge(s)'],
  ['expenses', { ...ZERO_USAGE, expenses: 1 }, 'used by 1 expense(s)'],
  ['assets', { ...ZERO_USAGE, assets: 1 }, 'used by 1 asset(s)'],
];

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('ContractTypesController (Fastify inject, no network)', () => {
  let ctx: ContractTypesTestApp;

  beforeAll(async () => {
    ctx = await createContractTypesTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    ctx.repo.usage.clear();
    ctx.settings.options = [{ name: 'default_timezone', value: TEST_ZONE }];
    ctx.settings.calls.length = 0;
    vi.restoreAllMocks();
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<ContractTypesTestApp['app']['inject']> =>
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
    return contractTypesResponseSchema.parse(JSON.parse(res.payload)).id;
  };

  it('registers the six routes under /api/v1/contract-types, DELETE included', () => {
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
          vi.spyOn(ctx.repo, 'usageByContractType'),
        ];
        const res = await send(method, url, TEST_BEARERS.everyCode, payload);
        expect(res.statusCode).toBe(HTTP.forbidden);
        const body = problem(res);
        expect(body.code).toBe('ERP-AUTH-0005');
        expect(body.detail).toBe(ADMIN_ONLY);
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
      const body = contractTypesListResponseSchema.parse(JSON.parse(res.payload));
      const order = body.data.map((row) => Number(row.id));
      expect(order).toEqual([...order].sort((x, y) => y - x));
      expect(order.slice(-3)).toEqual([3, 2, 1]);
      expect(body.meta).toMatchObject({ exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS });
    });

    it('each row carries its usage and dateCreated (the instant of the wall clock, or null)', async () => {
      ctx.repo.usage.set(3, { ...ZERO_USAGE, purchaseOrders: 2, assets: 1 });
      const res = await send('GET', `${LIST}?q=office&sort=id`, TEST_BEARERS.admin);
      const body = contractTypesListResponseSchema.parse(JSON.parse(res.payload));
      expect(body.data.slice(0, 2)).toEqual([
        {
          id: '1',
          name: 'Head Office',
          dateCreated: '2026-01-05T05:00:00.000Z',
          usage: ZERO_USAGE,
        },
        {
          id: '3',
          name: 'Head Office',
          dateCreated: '2026-02-10T10:30:00.000Z',
          usage: { ...ZERO_USAGE, purchaseOrders: 2, assets: 1 },
        },
      ]);
      const undated = await send('GET', record(2), TEST_BEARERS.admin);
      expect(contractTypesResponseSchema.parse(JSON.parse(undated.payload)).dateCreated).toBeNull();
      expect(res.payload).not.toContain('createdBy');
      expect(res.payload).not.toContain('created_by');
    });

    it('a bad list query is 400 ERP-VALIDATION-0001 with the issues (dateCreated is no sort)', async () => {
      const res = await send('GET', `${LIST}?sort=dateCreated`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.bad);
      expect(JSON.stringify(problem(res).issues)).toContain('sort');
    });
  });

  describe('POST and PATCH (D-29, D-31)', () => {
    it('POST 201, GET :id 200, PATCH 200: dateCreated from the fixed clock, the name only changed, one event and one log line each', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: '  Written  ' });
      expect(res.statusCode).toBe(HTTP.created);
      const dto = contractTypesResponseSchema.parse(JSON.parse(res.payload));
      expect(dto).toEqual({
        id: dto.id,
        name: 'Written',
        dateCreated: CREATED_AT,
        usage: ZERO_USAGE,
      });
      expect(await ctx.repo.findById(Number(dto.id))).toMatchObject({
        createdBy: TEST_STAFF.admin,
      });
      const read = await send('GET', record(dto.id), TEST_BEARERS.admin);
      expect(JSON.parse(read.payload)).toEqual(dto);
      const updated = await send('PATCH', record(dto.id), TEST_BEARERS.admin, {
        name: 'Rewritten',
      });
      expect(updated.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(updated.payload)).toEqual({ ...dto, name: 'Rewritten' });
      expect(ctx.events.drain().map((event) => event.constructor)).toEqual([
        ContractTypesCreatedV1,
        ContractTypesUpdatedV1,
      ]);
      const id = Number(dto.id);
      expect(ctx.logger.lines).toEqual([
        { message: 'contract type created', meta: { id } },
        { message: 'contract type updated', meta: { id } },
      ]);
    });

    it.each(['Fuel < 50 km', '<script>alert(1)</script>'])(
      'the name %s saves (201) and reads back byte-identical (T-4.1-85)',
      async (name) => {
        const res = await send('POST', LIST, TEST_BEARERS.admin, { name });
        expect(res.statusCode).toBe(HTTP.created);
        const { id } = contractTypesResponseSchema.parse(JSON.parse(res.payload));
        const read = await send('GET', record(id), TEST_BEARERS.admin);
        expect(contractTypesResponseSchema.parse(JSON.parse(read.payload))).toMatchObject({
          name,
          dateCreated: CREATED_AT,
        });
      },
    );

    it('POST a name the seed already holds is 201: Perfex has no uniqueness check (D-29)', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: 'Fixed-Term' });
      expect(res.statusCode).toBe(HTTP.created);
    });

    it.each([{ created_by: 9 }, { datecreated: '2020-01-01 00:00:00' }, { id: 77 }, { usage: {} }])(
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

    it("PATCH {} is 400 on ['name']; PATCH with created_by is 400 and the row is unchanged", async () => {
      const empty = await send('PATCH', record(1), TEST_BEARERS.admin, {});
      expect(empty.statusCode).toBe(HTTP.bad);
      expect(problem(empty).issues).toEqual([expect.objectContaining({ path: ['name'] })]);
      const before = await ctx.repo.findById(3);
      const sneaky = await send('PATCH', record(3), TEST_BEARERS.admin, {
        name: 'Taken over',
        created_by: 2,
      });
      expect(sneaky.statusCode).toBe(HTTP.bad);
      expect(await ctx.repo.findById(3)).toEqual(before);
    });

    it('PATCH changes only the name: dateCreated and created_by unchanged', async () => {
      const id = await created('Rename me');
      const before = await ctx.repo.findById(Number(id));
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, { name: 'Renamed' });
      expect(res.statusCode).toBe(HTTP.ok);
      expect(contractTypesResponseSchema.parse(JSON.parse(res.payload)).dateCreated).toBe(
        CREATED_AT,
      );
      expect(await ctx.repo.findById(Number(id))).toEqual({ ...before, name: 'Renamed' });
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

  describe('DELETE :id (D-07, D-28)', () => {
    it('answers 204 with no body, then GET :id is 404 ERP-CORE-0004; one event and one log line', async () => {
      const id = await created('Short-lived');
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.noContent);
      expect(res.payload).toBe('');
      const gone = await send('GET', record(id), TEST_BEARERS.admin);
      expect(gone.statusCode).toBe(HTTP.notFound);
      expect(problem(gone).code).toBe('ERP-CORE-0004');
      const events = ctx.events.drain();
      expect(events.map((event) => event.constructor)).toEqual([ContractTypesDeletedV1]);
      expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual(['at', 'id']);
      expect(ctx.logger.lines).toEqual([
        { message: 'contract type deleted', meta: { id: Number(id) } },
      ]);
    });

    it('of a missing id is 404 ERP-CORE-0004, and nothing is published', async () => {
      const res = await send('DELETE', record(9_999), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.notFound);
      expect(problem(res).code).toBe('ERP-CORE-0004');
      expect(ctx.events.count).toBe(0);
    });

    it.each(ONE_GROUP)(
      'of a contract type used in %s is 409 ERP-CONTRACTTYPES-0001: the row stays readable, no event, no log line',
      async (group, usage, detail) => {
        const id = await created(`In use: ${group}`);
        ctx.repo.usage.set(Number(id), usage);
        const total = await ctx.repo.count(ALL);
        const res = await send('DELETE', record(id), TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.conflict);
        const body = problem(res);
        expect(body.code).toBe('ERP-CONTRACTTYPES-0001');
        expect(body.detail).toBe(detail);
        expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.ok);
        expect(await ctx.repo.count(ALL)).toBe(total);
        expect(ctx.events.count).toBe(0);
        expect(ctx.logger.lines).toEqual([]);
      },
    );

    it('names only the non-zero groups, in order', async () => {
      const id = await created('Busy');
      ctx.repo.usage.set(Number(id), {
        ...ZERO_USAGE,
        purchaseRequests: 2,
        expenses: 1,
        assets: 4,
      });
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(problem(res).detail).toBe(
        'used by 2 purchase request(s), 1 expense(s) and 4 asset(s)',
      );
    });
  });

  describe('every export format through the shared core', () => {
    const FORMATS = ['csv', 'xlsx', 'pdf', 'print'] as const;

    it('csv answers id, name and dateCreated only, the attachment name, no-store and a BOM', async () => {
      const res = await send('GET', `${EXPORT}?sort=id`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="contract-types-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(
        res.payload.startsWith(
          `${CSV_BOM}id,name,dateCreated\r\n1,Head Office,2026-01-05T05:00:00.000Z\r\n2,Warehouse,\r\n`,
        ),
      ).toBe(true);
    });

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)(
      'format=%s answers its content type and contract-types-<date>.<ext>',
      async (format, type, magic) => {
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.ok);
        expect(res.headers['content-type']).toBe(type);
        expect(res.headers['content-disposition']).toMatch(
          new RegExp(`^attachment; filename="contract-types-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`),
        );
        expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
      },
    );

    it('format=print answers the three columns as text rows, no attachment', async () => {
      const res = await send('GET', `${EXPORT}?format=print&q=warehouse`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-disposition']).toBeUndefined();
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['id', 'name', 'dateCreated']);
      expect(body.rows).toEqual([['2', 'Warehouse', '']]);
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

    it('escapes a formula in a name and in a header label (T-4.1-86)', async () => {
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

    it('column=name exports that one column (D-13); the usage is never read', async () => {
      const usage = vi.spyOn(ctx.repo, 'usageByContractType');
      const res = await send('GET', `${EXPORT}?column=name&q=warehouse`, TEST_BEARERS.admin);
      expect(res.payload).toBe(`${CSV_BOM}name\r\nWarehouse\r\n`);
      expect(usage).not.toHaveBeenCalled();
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
