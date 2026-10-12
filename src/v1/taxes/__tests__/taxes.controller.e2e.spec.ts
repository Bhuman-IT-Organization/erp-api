/**
 * The HTTP contract of the six routes under `/api/v1/taxes`, proven in-process with Fastify `inject`
 * over the in-memory fake: administrators only on every handler (D-06: a bearer holding every
 * catalogue code is refused 403 `ERP-AUTH-0005` before any read, an administrator is served, no
 * bearer is 401 `ERP-AUTH-0004`), the list in Perfex's rate order with each row's usage and default
 * flag, Perfex's four refusals (in use `ERP-TAXES-0001`, the locked edit `ERP-TAXES-0002`, the
 * duplicate name `ERP-TAXES-0003`, the default tax `ERP-TAXES-0004`, D-21), the DELETE, the names
 * Perfex accepts saved and read back byte-identical, the four-format export of `id`, `name` and
 * `rate` with its formula escape, `x-request-id` on every response, and the ADR-0030 route
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
import { taxesListResponseSchema, taxesResponseSchema } from '../dto/taxes.dto.js';
import { TaxesCreatedV1, TaxesDeletedV1, TaxesUpdatedV1 } from '../events/published.js';
import type { TaxUsage } from '../model/taxes.model.js';
import { TAXES_ROUTES } from '../taxes.routes.js';
import { createTaxesTestApp, TEST_BEARERS, type TaxesTestApp } from './create-taxes-test-app.js';
import { ZERO_USAGE } from './fakes.js';

const LIST = `/${API_PREFIX}/${TAXES_ROUTES.base}`;
const EXPORT = `${LIST}/${TAXES_ROUTES.export}`;
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
/** Perfex's `default_tax` option naming the seeded `VAT` at `10.00` (a serialized PHP array). */
const DEFAULT_VAT = 'a:1:{i:0;s:9:"VAT|10.00";}';

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** The six routes, each with the body it needs and the status an administrator gets. */
const ROUTES: readonly { method: Method; url: string; payload?: object; admin: number }[] = [
  { method: 'GET', url: LIST, admin: HTTP.ok },
  { method: 'GET', url: EXPORT, admin: HTTP.ok },
  { method: 'GET', url: record(1), admin: HTTP.ok },
  { method: 'POST', url: LIST, payload: { name: 'New', rate: '1' }, admin: HTTP.created },
  { method: 'PATCH', url: record(1), payload: { name: 'VAT' }, admin: HTTP.ok },
  { method: 'DELETE', url: record(3), admin: HTTP.noContent },
];

/** One usage per group, that group at 1 and the rest at 0, with the words its 409 detail uses. */
const ONE_GROUP: readonly (readonly [string, TaxUsage, string])[] = [
  ['items', { ...ZERO_USAGE, items: 1 }, 'used by 1 item(s)'],
  ['expenses', { ...ZERO_USAGE, expenses: 1 }, 'used by 1 expense(s)'],
  ['subscriptions', { ...ZERO_USAGE, subscriptions: 1 }, 'used by 1 subscription(s)'],
  ['vendorItems', { ...ZERO_USAGE, vendorItems: 1 }, 'used by 1 vendor item(s)'],
  ['purchaseLines', { ...ZERO_USAGE, purchaseLines: 1 }, 'used by 1 purchase line(s)'],
  ['warehouseLines', { ...ZERO_USAGE, warehouseLines: 1 }, 'used by 1 warehouse line(s)'],
  [
    'fixedEquipmentLines',
    { ...ZERO_USAGE, fixedEquipmentLines: 1 },
    'used by 1 fixed equipment line(s)',
  ],
  ['salesReturnLines', { ...ZERO_USAGE, salesReturnLines: 1 }, 'used by 1 sales return line(s)'],
  ['accounting', { ...ZERO_USAGE, accounting: 1 }, 'used by 1 accounting row(s)'],
];

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('TaxesController (Fastify inject, no network)', () => {
  let ctx: TaxesTestApp;

  beforeAll(async () => {
    ctx = await createTaxesTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    ctx.repo.usage.clear();
    ctx.repo.defaultTax = '';
    vi.restoreAllMocks();
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<TaxesTestApp['app']['inject']> =>
    ctx.app.inject({
      method,
      url,
      ...(token === undefined ? {} : { headers: bearer(token) }),
      ...(payload === undefined ? {} : { payload }),
    });

  /** A fresh row to delete or change, so each case owns its data; the log and events are cleared. */
  const created = async (name: string, rate = '1'): Promise<string> => {
    const res = await send('POST', LIST, TEST_BEARERS.admin, { name, rate });
    expect(res.statusCode).toBe(HTTP.created);
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    return taxesResponseSchema.parse(JSON.parse(res.payload)).id;
  };

  it('registers the six routes under /api/v1/taxes, DELETE included', () => {
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

  describe('administrators only (D-06, T-4.1-37)', () => {
    it.each(ROUTES)(
      '$method $url with a bearer holding every catalogue code, not an administrator, is 403 ERP-AUTH-0005 before any read',
      async ({ method, url, payload }) => {
        const reads = [
          vi.spyOn(ctx.repo, 'list'),
          vi.spyOn(ctx.repo, 'count'),
          vi.spyOn(ctx.repo, 'findById'),
          vi.spyOn(ctx.repo, 'findOtherByName'),
          vi.spyOn(ctx.repo, 'create'),
          vi.spyOn(ctx.repo, 'update'),
          vi.spyOn(ctx.repo, 'remove'),
          vi.spyOn(ctx.repo, 'usageByTax'),
          vi.spyOn(ctx.repo, 'defaultTaxSetting'),
        ];
        const res = await send(method, url, TEST_BEARERS.everyCode, payload);
        expect(res.statusCode).toBe(HTTP.forbidden);
        const body = problem(res);
        expect(body.code).toBe('ERP-AUTH-0005');
        expect(body.detail).toBe('taxes are managed by administrators only');
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
    it("defaults to Perfex's order, the rate ascending and numeric, with no sort sent", async () => {
      const res = await send('GET', LIST, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const body = taxesListResponseSchema.parse(JSON.parse(res.payload));
      const seeded = body.data.filter((row) => ['1', '2', '3'].includes(row.id));
      expect(seeded.map((row) => row.rate)).toEqual(['5.00', '10.00', '100.00']);
      expect(body.meta).toMatchObject({ exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS });
    });

    it('each row carries its usage and isDefault; the setting text never reaches the wire', async () => {
      ctx.repo.usage.set(1, { ...ZERO_USAGE, expenses: 2, purchaseLines: 1 });
      ctx.repo.defaultTax = DEFAULT_VAT;
      const res = await send('GET', `${LIST}?q=vat`, TEST_BEARERS.admin);
      const body = taxesListResponseSchema.parse(JSON.parse(res.payload));
      expect(body.data[0]).toEqual({
        id: '1',
        name: 'VAT',
        rate: '10.00',
        usage: { ...ZERO_USAGE, expenses: 2, purchaseLines: 1 },
        isDefault: true,
      });
      expect(res.payload).not.toContain('a:1:');
    });

    it('a bad list query is 400 ERP-VALIDATION-0001 with the issues', async () => {
      const res = await send('GET', `${LIST}?sort=taxrate`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.bad);
      expect(JSON.stringify(problem(res).issues)).toContain('sort');
    });
  });

  describe('POST and PATCH', () => {
    it('POST 201, GET :id 200, PATCH 200: the rate rounded, one event and one log line each', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: 'Written', rate: '5.555' });
      expect(res.statusCode).toBe(HTTP.created);
      const dto = taxesResponseSchema.parse(JSON.parse(res.payload));
      expect(dto).toMatchObject({ name: 'Written', rate: '5.56', isDefault: false });
      const read = await send('GET', record(dto.id), TEST_BEARERS.admin);
      expect(JSON.parse(read.payload)).toEqual(dto);
      const updated = await send('PATCH', record(dto.id), TEST_BEARERS.admin, { rate: '7' });
      expect(updated.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(updated.payload)).toEqual({ ...dto, rate: '7.00' });
      expect(ctx.events.drain().map((event) => event.constructor)).toEqual([
        TaxesCreatedV1,
        TaxesUpdatedV1,
      ]);
      const id = Number(dto.id);
      expect(ctx.logger.lines).toEqual([
        { message: 'tax created', meta: { id } },
        { message: 'tax updated', meta: { id } },
      ]);
    });

    it.each(['Fuel < 50 km', '<script>alert(1)</script>'])(
      'the name %s saves (201) and reads back byte-identical (T-4.1-42)',
      async (name) => {
        const res = await send('POST', LIST, TEST_BEARERS.admin, { name, rate: '3' });
        expect(res.statusCode).toBe(HTTP.created);
        const { id } = taxesResponseSchema.parse(JSON.parse(res.payload));
        const read = await send('GET', record(id), TEST_BEARERS.admin);
        expect(taxesResponseSchema.parse(JSON.parse(read.payload)).name).toBe(name);
      },
    );

    it("POST VAT|5 is 400 on ['name'] and nothing is stored (T-4.1-40)", async () => {
      const total = await ctx.repo.count(ALL);
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: 'VAT|5', rate: '5' });
      expect(res.statusCode).toBe(HTTP.bad);
      expect(problem(res).issues).toEqual([expect.objectContaining({ path: ['name'] })]);
      expect(await ctx.repo.count(ALL)).toBe(total);
    });

    it('POST a name the seed holds in another letter case is 409 ERP-TAXES-0003; nothing stored, no event', async () => {
      const total = await ctx.repo.count(ALL);
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: 'vat', rate: '1' });
      expect(res.statusCode).toBe(HTTP.conflict);
      expect(problem(res).code).toBe('ERP-TAXES-0003');
      expect(await ctx.repo.count(ALL)).toBe(total);
      expect(ctx.events.count).toBe(0);
      expect(ctx.logger.lines).toEqual([]);
    });

    it("PATCH to another tax's name is 409 ERP-TAXES-0003; keeping its own name is not", async () => {
      const id = await created('Rename me');
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, { name: 'REDUCED' });
      expect(res.statusCode).toBe(HTTP.conflict);
      expect(problem(res).code).toBe('ERP-TAXES-0003');
      const same = await send('PATCH', record(id), TEST_BEARERS.admin, { name: 'Rename me' });
      expect(same.statusCode).toBe(HTTP.ok);
    });

    it.each([
      ['an expense', { ...ZERO_USAGE, expenses: 1 }, 'used by 1 expense(s)'],
      ['a subscription', { ...ZERO_USAGE, subscriptions: 2 }, 'used by 2 subscription(s)'],
    ])(
      'PATCH of a tax used by %s is 409 ERP-TAXES-0002 and the row is unchanged',
      async (label, usage, detail) => {
        const id = await created(`Locked by ${label}`, '4');
        ctx.repo.usage.set(Number(id), usage);
        const res = await send('PATCH', record(id), TEST_BEARERS.admin, { rate: '9' });
        expect(res.statusCode).toBe(HTTP.conflict);
        const body = problem(res);
        expect(body.code).toBe('ERP-TAXES-0002');
        expect(body.detail).toBe(detail);
        expect(await ctx.repo.findById(Number(id))).toMatchObject({
          name: `Locked by ${label}`,
          taxrate: '4.00',
        });
        expect(ctx.events.count).toBe(0);
        expect(ctx.logger.lines).toEqual([]);
      },
    );

    it('PATCH of a tax used only by items is allowed (Perfex locks only for expenses and subscriptions)', async () => {
      const id = await created('Items only', '4');
      ctx.repo.usage.set(Number(id), { ...ZERO_USAGE, items: 3, purchaseLines: 2 });
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, { rate: '6' });
      expect(res.statusCode).toBe(HTTP.ok);
    });

    it.each([
      ['the name', { name: 'Sales tax' }],
      ['the rate', { rate: '10.5' }],
      ['the name in another letter case', { name: 'vat' }],
    ])(
      'PATCH changing %s of a tax default_tax names is 409 ERP-TAXES-0004 (D-21), the row unchanged',
      async (_label, patch) => {
        ctx.repo.defaultTax = DEFAULT_VAT;
        const res = await send('PATCH', record(1), TEST_BEARERS.admin, patch);
        expect(res.statusCode).toBe(HTTP.conflict);
        const body = problem(res);
        expect(body.code).toBe('ERP-TAXES-0004');
        expect(body.detail).not.toContain('VAT|10.00');
        expect(await ctx.repo.findById(1)).toEqual({ id: 1, name: 'VAT', taxrate: '10.00' });
        expect(ctx.events.count).toBe(0);
      },
    );

    it('PATCH of a default tax whose name and rate equal the stored ones succeeds (nothing for Perfex to rewrite)', async () => {
      ctx.repo.defaultTax = DEFAULT_VAT;
      const res = await send('PATCH', record(1), TEST_BEARERS.admin, { name: 'VAT', rate: '10' });
      expect(res.statusCode).toBe(HTTP.ok);
      expect(taxesResponseSchema.parse(JSON.parse(res.payload))).toMatchObject({
        name: 'VAT',
        rate: '10.00',
        isDefault: true,
      });
    });

    it('a non-numeric :id is a 400, never a 404 probe; PATCH of a missing id is 404', async () => {
      const res = await send('GET', record('abc'), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.bad);
      const patch = await send('PATCH', record(9_999), TEST_BEARERS.admin, { name: 'Nobody' });
      expect(patch.statusCode).toBe(HTTP.notFound);
      expect(problem(patch).code).toBe('ERP-CORE-0004');
    });

    it.each([{ id: 77 }, { usage: {} }, { isDefault: true }, { taxrate: '1' }])(
      'mass assignment %o is 400 naming the key, and nothing is stored',
      async (extra) => {
        const total = await ctx.repo.count(ALL);
        const res = await send('POST', LIST, TEST_BEARERS.admin, {
          name: 'Sneaky',
          rate: '1',
          ...extra,
        });
        expect(res.statusCode).toBe(HTTP.bad);
        expect(JSON.stringify(problem(res).issues)).toContain(Object.keys(extra)[0] ?? '');
        expect(await ctx.repo.count(ALL)).toBe(total);
      },
    );
  });

  describe('DELETE :id (D-07)', () => {
    it('answers 204 with no body, then GET :id is 404 ERP-CORE-0004; one event and one log line', async () => {
      const id = await created('Short-lived');
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.noContent);
      expect(res.payload).toBe('');
      const gone = await send('GET', record(id), TEST_BEARERS.admin);
      expect(gone.statusCode).toBe(HTTP.notFound);
      expect(problem(gone).code).toBe('ERP-CORE-0004');
      const events = ctx.events.drain();
      expect(events.map((event) => event.constructor)).toEqual([TaxesDeletedV1]);
      expect(Object.keys(events[0]?.payload ?? {}).sort()).toEqual(['at', 'id']);
      expect(ctx.logger.lines).toEqual([{ message: 'tax deleted', meta: { id: Number(id) } }]);
    });

    it('of a missing id is 404 ERP-CORE-0004, and nothing is published', async () => {
      const res = await send('DELETE', record(9_999), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.notFound);
      expect(problem(res).code).toBe('ERP-CORE-0004');
      expect(ctx.events.count).toBe(0);
    });

    it.each(ONE_GROUP)(
      'of a tax used in %s is 409 ERP-TAXES-0001: the row stays readable, no event, no log line',
      async (group, usage, detail) => {
        const id = await created(`In use: ${group}`);
        ctx.repo.usage.set(Number(id), usage);
        const total = await ctx.repo.count(ALL);
        const res = await send('DELETE', record(id), TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.conflict);
        const body = problem(res);
        expect(body.code).toBe('ERP-TAXES-0001');
        expect(body.detail).toBe(detail);
        expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.ok);
        expect(await ctx.repo.count(ALL)).toBe(total);
        expect(ctx.events.count).toBe(0);
        expect(ctx.logger.lines).toEqual([]);
      },
    );

    it('names only the non-zero groups, in order', async () => {
      const id = await created('Busy');
      ctx.repo.usage.set(Number(id), { ...ZERO_USAGE, items: 2, expenses: 1, accounting: 4 });
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(problem(res).detail).toBe('used by 2 item(s), 1 expense(s) and 4 accounting row(s)');
    });
  });

  describe('every export format through the shared core', () => {
    const FORMATS = ['csv', 'xlsx', 'pdf', 'print'] as const;

    it('csv answers id, name and rate only, the attachment name, no-store and a BOM', async () => {
      const res = await send('GET', `${EXPORT}?sort=id`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="taxes-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.payload.startsWith(`${CSV_BOM}id,name,rate\r\n1,VAT,10.00\r\n`)).toBe(true);
    });

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)(
      'format=%s answers its content type and taxes-<date>.<ext>',
      async (format, type, magic) => {
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.admin);
        expect(res.statusCode).toBe(HTTP.ok);
        expect(res.headers['content-type']).toBe(type);
        expect(res.headers['content-disposition']).toMatch(
          new RegExp(`^attachment; filename="taxes-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`),
        );
        expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
      },
    );

    it('format=print answers the three columns as text rows, no attachment', async () => {
      const res = await send('GET', `${EXPORT}?format=print&q=reduced`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-disposition']).toBeUndefined();
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['id', 'name', 'rate']);
      expect(body.rows).toEqual([['2', 'Reduced', '5.00']]);
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

    it('escapes a formula in a name and in a header label (T-4.1-43)', async () => {
      await created('=HYPERLINK("http://x","y")');
      const labels = ['@SUM(1)', 'Name', 'Rate'].map((l) => `header=${encodeURIComponent(l)}`);
      const res = await send(
        'GET',
        `${EXPORT}?q=hyperlink&${labels.join('&')}`,
        TEST_BEARERS.admin,
      );
      expect(res.statusCode).toBe(HTTP.ok);
      const [header, row] = res.payload.slice(CSV_BOM.length).split('\r\n');
      expect(header).toBe("'@SUM(1),Name,Rate");
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

    it('column=rate exports that one column (D-13)', async () => {
      const res = await send('GET', `${EXPORT}?column=rate&q=reduced`, TEST_BEARERS.admin);
      expect(res.payload).toBe(`${CSV_BOM}rate\r\n5.00\r\n`);
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
