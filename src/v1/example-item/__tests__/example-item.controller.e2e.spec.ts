/**
 * The HTTP contract of the five routes under `/api/v1/example-item`, proven in-process with
 * Fastify `inject`: the list envelope, the detail, create, update and the CSV export, each behind
 * the bearer and permission guards (401 `ERP-AUTH-0004` without a bearer, 403 `ERP-AUTH-0005`
 * without the code), the one not-found answer, the strict bodies, the export's headers and BOM,
 * `x-request-id` on every response, and the ADR-0030 route assertion (every route under
 * `/api/v1/` or in `UNPREFIXED_ROUTES`), and the test app's module switch seam (ADR-0042, M6).
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ModuleSwitch, type ModuleName } from '../../../shared/config/modules.js';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { CSV_BOM, EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { PDF_CONTENT_TYPE } from '../../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../../shared/http/xlsx.js';
import {
  exampleItemListResponseSchema,
  exampleItemResponseSchema,
} from '../dto/example-item.dto.js';
import { EXAMPLE_ITEM_ROUTES } from '../example-item.routes.js';
import { ExampleItemCreatedV1, ExampleItemUpdatedV1 } from '../events/published.js';
import {
  createExampleItemTestApp,
  TEST_BEARERS,
  TEST_STAFF,
  type ExampleItemTestApp,
} from './create-example-item-test-app.js';

const LIST = `/${API_PREFIX}/${EXAMPLE_ITEM_ROUTES.base}`;
const EXPORT = `${LIST}/${EXAMPLE_ITEM_ROUTES.export}`;
const record = (id: string | number): string => `${LIST}/${String(id)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HTTP = { ok: 200, created: 201, bad: 400, unauthorized: 401, forbidden: 403, notFound: 404 };

type Method = 'GET' | 'POST' | 'PATCH';

/** The five routes, with a body where one is required. */
const ROUTES: readonly { method: Method; url: string; payload?: object }[] = [
  { method: 'GET', url: LIST },
  { method: 'GET', url: EXPORT },
  { method: 'GET', url: record(1) },
  { method: 'POST', url: LIST, payload: { name: 'New' } },
  { method: 'PATCH', url: record(1), payload: { name: 'Renamed' } },
];

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('ExampleItemController (Fastify inject, no network)', () => {
  let ctx: ExampleItemTestApp;

  beforeAll(async () => {
    ctx = await createExampleItemTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<ExampleItemTestApp['app']['inject']> =>
    ctx.app.inject({
      method,
      url,
      ...(token === undefined ? {} : { headers: bearer(token) }),
      ...(payload === undefined ? {} : { payload }),
    });

  it('registers the five routes under /api/v1/example-item, and no delete', () => {
    for (const route of [
      `GET ${LIST}`,
      `GET ${EXPORT}`,
      `GET ${LIST}/:id`,
      `POST ${LIST}`,
      `PATCH ${LIST}/:id`,
    ]) {
      expect(ctx.routes).toContain(route);
    }
    expect(ctx.routes.some((route) => route.startsWith('DELETE '))).toBe(false);
  });

  it('GET list with view answers 200 and the envelope on the superset meta, never an internal field', async () => {
    const res = await send('GET', `${LIST}?limit=2`, TEST_BEARERS.view);
    expect(res.statusCode).toBe(HTTP.ok);
    const body = exampleItemListResponseSchema.parse(JSON.parse(res.payload));
    expect(body.data.map((item) => item.id)).toEqual(['1', '2']);
    expect(body.meta).toMatchObject({ total: 3, rangeStart: 1, prevCursor: null });
    expect(body.meta.exportLimit).toBeGreaterThan(0);
    expect(res.payload).not.toContain('internalRef');
    expect(res.payload).not.toContain('ownerStaffId');
    expect(res.payload).not.toContain('ref-1');
  });

  it('GET list with viewOwn only → 200 with the narrowed set', async () => {
    const res = await send('GET', LIST, TEST_BEARERS.viewOwn);
    expect(res.statusCode).toBe(HTTP.ok);
    const body = exampleItemListResponseSchema.parse(JSON.parse(res.payload));
    expect(body.data.map((item) => item.id)).toEqual(['2']);
  });

  it('a bad list query → 400 ERP-VALIDATION-0001 with the issues', async () => {
    const res = await send('GET', `${LIST}?sort=label`, TEST_BEARERS.view);
    expect(res.statusCode).toBe(HTTP.bad);
    const body = problem(res);
    expect(body.code).toBe('ERP-VALIDATION-0001');
    expect(JSON.stringify(body.issues)).toContain('sort');
  });

  it.each(ROUTES)(
    '$method $url without a bearer → 401 ERP-AUTH-0004',
    async ({ method, url, payload }) => {
      const res = await send(method, url, undefined, payload);
      expect(res.statusCode).toBe(HTTP.unauthorized);
      expect(problem(res).code).toBe('ERP-AUTH-0004');
    },
  );

  it.each(ROUTES.filter((route) => route.method === 'GET'))(
    '$method $url with neither read code → 403 ERP-AUTH-0005',
    async ({ method, url }) => {
      const res = await send(method, url, TEST_BEARERS.noPermission);
      expect(res.statusCode).toBe(HTTP.forbidden);
      expect(problem(res).code).toBe('ERP-AUTH-0005');
    },
  );

  it.each(ROUTES.filter((route) => route.method !== 'GET'))(
    '$method $url with view only → 403 ERP-AUTH-0005 and nothing stored',
    async ({ method, url, payload }) => {
      const before = await ctx.repo.findById(1, 'all', TEST_STAFF.view);
      const res = await send(method, url, TEST_BEARERS.viewOnly, payload);
      expect(res.statusCode).toBe(HTTP.forbidden);
      expect(problem(res).code).toBe('ERP-AUTH-0005');
      expect(await ctx.repo.findById(1, 'all', TEST_STAFF.view)).toEqual(before);
    },
  );

  it('writer: POST 201, then GET :id 200, then PATCH 200 — one event each', async () => {
    ctx.events.drain();
    const created = await send('POST', LIST, TEST_BEARERS.writer, { name: 'Written' });
    expect(created.statusCode).toBe(HTTP.created);
    const dto = exampleItemResponseSchema.parse(JSON.parse(created.payload));
    expect(dto).toMatchObject({ name: 'Written', label: `Written (${dto.id})` });

    const read = await send('GET', record(dto.id), TEST_BEARERS.writer);
    expect(read.statusCode).toBe(HTTP.ok);
    expect(JSON.parse(read.payload)).toEqual(dto);

    const updated = await send('PATCH', record(dto.id), TEST_BEARERS.writer, { name: 'Rewritten' });
    expect(updated.statusCode).toBe(HTTP.ok);
    expect(JSON.parse(updated.payload)).toMatchObject({ id: dto.id, name: 'Rewritten' });
    expect((await ctx.repo.findById(Number(dto.id), 'all', 0))?.ownerStaffId).toBe(
      TEST_STAFF.writer,
    );

    const events = ctx.events.drain();
    expect(events.map((event) => event.constructor)).toEqual([
      ExampleItemCreatedV1,
      ExampleItemUpdatedV1,
    ]);
  });

  it("GET :id answers the SAME 404 ERP-CORE-0004 body for a missing id and for another member's row under viewOwn", async () => {
    const missing = await send('GET', record(9_999), TEST_BEARERS.viewOwn);
    const foreign = await send('GET', record(1), TEST_BEARERS.viewOwn);
    expect(missing.statusCode).toBe(HTTP.notFound);
    expect(foreign.statusCode).toBe(HTTP.notFound);
    expect(problem(missing).code).toBe('ERP-CORE-0004');
    expect(foreign.payload).toBe(missing.payload);
    const own = await send('GET', record(2), TEST_BEARERS.viewOwn);
    expect(own.statusCode).toBe(HTTP.ok);
  });

  it('a non-numeric :id is a 400, never a 404 probe; PATCH of a missing id is the same 404', async () => {
    const res = await send('GET', record('abc'), TEST_BEARERS.view);
    expect(res.statusCode).toBe(HTTP.bad);
    expect(problem(res).code).toBe('ERP-VALIDATION-0001');
    const patch = await send('PATCH', record(9_999), TEST_BEARERS.writer, { name: 'Nobody' });
    expect(patch.statusCode).toBe(HTTP.notFound);
    expect(problem(patch).code).toBe('ERP-CORE-0004');
  });

  it.each([
    { id: 77 },
    { createdAt: '2000-01-01T00:00:00.000Z' },
    { internalRef: 'x' },
    { ownerStaffId: 1 },
  ])('mass assignment %o → 400 naming the key, and nothing is stored', async (extra) => {
    const total = await ctx.repo.count(
      { search: null, sortField: 'id', order: 'asc', cursor: null, limit: 1 },
      'all',
      0,
    );
    const res = await send('POST', LIST, TEST_BEARERS.writer, { name: 'Sneaky', ...extra });
    expect(res.statusCode).toBe(HTTP.bad);
    expect(JSON.stringify(problem(res).issues)).toContain(Object.keys(extra)[0] ?? '');
    expect(
      await ctx.repo.count(
        { search: null, sortField: 'id', order: 'asc', cursor: null, limit: 1 },
        'all',
        0,
      ),
    ).toBe(total);
    const patch = await send('PATCH', record(1), TEST_BEARERS.writer, extra);
    expect(patch.statusCode).toBe(HTTP.bad);
  });

  it('GET export answers 200 text/csv with the attachment name, no-store and a BOM; /export wins over :id', async () => {
    const res = await send('GET', `${EXPORT}?sort=id`, TEST_BEARERS.view);
    expect(res.statusCode).toBe(HTTP.ok);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="example-item-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.rawPayload.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    expect(res.payload.startsWith(`${CSV_BOM}id,name,label,createdAt\r\n1,`)).toBe(true);
    expect(res.payload).not.toContain('ref-');
  });

  it('GET export honours viewOwn, and escapes a formula in a cell and in a header label (T-3.2-89)', async () => {
    const own = await send('GET', EXPORT, TEST_BEARERS.viewOwn);
    expect(own.statusCode).toBe(HTTP.ok);
    const lines = own.payload
      .slice(CSV_BOM.length)
      .split('\r\n')
      .filter((line) => line !== '');
    expect(lines).toHaveLength(2);
    expect(lines[1]?.startsWith('2,')).toBe(true);

    await send('POST', LIST, TEST_BEARERS.writer, { name: '=HYPERLINK("http://x","y")' });
    const labels = ['@SUM(1)', 'Name', 'Label', 'Created'].map(
      (l) => `header=${encodeURIComponent(l)}`,
    );
    const res = await send('GET', `${EXPORT}?q=hyperlink&${labels.join('&')}`, TEST_BEARERS.view);
    expect(res.statusCode).toBe(HTTP.ok);
    const [header, row] = res.payload.slice(CSV_BOM.length).split('\r\n');
    expect(header).toBe("'@SUM(1),Name,Label,Created");
    expect(row).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it('GET export refuses limit and cursor on their path', async () => {
    const res = await send('GET', `${EXPORT}?limit=10`, TEST_BEARERS.view);
    expect(res.statusCode).toBe(HTTP.bad);
    expect(JSON.stringify(problem(res).issues)).toContain('limit');
  });

  describe('every format and the ticked keys through the shared core (04.1.1-02)', () => {
    const KEYS_MAX = 500;

    /** The data rows of a CSV body (the header line and the trailing empty line dropped). */
    function dataRows(payload: string): string[] {
      return payload
        .slice(CSV_BOM.length)
        .split('\r\n')
        .slice(1)
        .filter((line) => line !== '');
    }

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)(
      'format=%s answers its content type, example-item-<date>.<ext> and no-store',
      async (format, contentType, magic) => {
        const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.view);
        expect(res.statusCode).toBe(HTTP.ok);
        expect(res.headers['content-type']).toBe(contentType);
        expect(res.headers['content-disposition']).toMatch(
          new RegExp(`^attachment; filename="example-item-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`),
        );
        expect(res.headers['cache-control']).toBe('no-store');
        expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
      },
    );

    it('format=print answers JSON rows with no-store and no attachment; never an internal field', async () => {
      const res = await send('GET', `${EXPORT}?format=print&key=2`, TEST_BEARERS.view);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.headers['content-disposition']).toBeUndefined();
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['id', 'name', 'label', 'createdAt']);
      expect(body.rows).toEqual([['2', 'Second', 'Second (2)', '2026-01-02 00:00:00']]);
      expect(res.payload).not.toContain('ref-');
    });

    it('key=<id> exports only that row (D-27)', async () => {
      const res = await send('GET', `${EXPORT}?key=3`, TEST_BEARERS.view);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(dataRows(res.payload)).toEqual(['3,Third,Third (3),2026-01-03T00:00:00.000Z']);
    });

    it("under viewOwn a key naming another member's row exports no data row: not a 404, not the row (D-03)", async () => {
      const foreign = await send('GET', `${EXPORT}?key=1`, TEST_BEARERS.viewOwn);
      expect(foreign.statusCode).toBe(HTTP.ok);
      expect(dataRows(foreign.payload)).toEqual([]);
      const own = await send('GET', `${EXPORT}?key=1&key=2`, TEST_BEARERS.viewOwn);
      expect(dataRows(own.payload).map((line) => line.split(',')[0])).toEqual(['2']);
    });

    it.each([
      [
        '501 keys',
        Array.from({ length: KEYS_MAX + 1 }, (_, index) => `key=${String(index + 1)}`).join('&'),
      ],
      ['key=0', 'key=0'],
      ['a key that is not a number', 'key=abc'],
    ])('%s is a 400 on the key path', async (_label, query) => {
      const res = await send('GET', `${EXPORT}?${query}`, TEST_BEARERS.view);
      expect(res.statusCode).toBe(HTTP.bad);
      expect(problem(res).issues).toEqual([expect.objectContaining({ path: ['key'] })]);
    });

    it('the list meta carries printLimit beside exportLimit', async () => {
      const res = await send('GET', LIST, TEST_BEARERS.view);
      const body = exampleItemListResponseSchema.parse(JSON.parse(res.payload));
      expect(body.meta).toMatchObject({ exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS });
    });
  });

  it.each(ROUTES)(
    '$method $url carries x-request-id, minted when absent and echoed when valid',
    async ({ method, url, payload }) => {
      const minted = await send(method, url, TEST_BEARERS.writer, payload);
      expect(minted.headers['x-request-id']).toMatch(UUID);
      const echoed = await ctx.app.inject({
        method,
        url,
        headers: { ...bearer(TEST_BEARERS.writer), 'x-request-id': 'web-trace-1' },
        ...(payload === undefined ? {} : { payload }),
      });
      expect(echoed.headers['x-request-id']).toBe('web-trace-1');
      expect(echoed.payload).not.toContain('web-trace-1');
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

describe('the module switch of the test app (ADR-0042, M6)', () => {
  it('answers ModuleSwitch from disabledModules; every module is on by default', async () => {
    // No module is switchable yet (`MODULE_NAMES` is empty); a stand-in name exercises the switch.
    const name = 'sample' as ModuleName;
    const on = await createExampleItemTestApp();
    const off = await createExampleItemTestApp({ disabledModules: [name] });
    try {
      expect(on.moduleRef.get(ModuleSwitch).isEnabled(name)).toBe(true);
      expect(off.moduleRef.get(ModuleSwitch).isEnabled(name)).toBe(false);
    } finally {
      await on.close();
      await off.close();
    }
  });
});
