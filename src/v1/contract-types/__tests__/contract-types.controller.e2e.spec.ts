/**
 * ContractTypesController (E2E over Fastify inject, no network): HTTP codes, the schema, administrators
 * only (D-06, D-26: every route 403 on the every-code bearer), the default sort,
 * the DELETE with its 409 `ERP-CONTRACTTYPES-0001` (D-07, D-28), the
 * four export formats through `shared/http/export.ts` (CSV, Excel, PDF, print), formula escaping
 * (T-4.1-86), x-request-id minted or echoed (ADR-0030), and the route gates.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  type ContractTypesTestApp,
} from './create-contract-types-test-app.js';
import { ZERO_USAGE } from './fakes.js';

interface ProblemDetails {
  readonly type: string;
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly code?: string;
  readonly issues?: readonly unknown[];
}

const LIST = `/api/v1/${CONTRACT_TYPES_ROUTES.base}`;
const EXPORT = `${LIST}/${CONTRACT_TYPES_ROUTES.export}`;
const record = (id: number | string) => `${LIST}/${String(id)}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
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
  ['contracts', { contracts: 1 }, 'used by 1 contract(s)'],
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
    it("defaults to Perfex's order, the name descending, with no sort sent", async () => {
      const res = await send('GET', LIST, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      const body = contractTypesListResponseSchema.parse(JSON.parse(res.payload));
      const names = body.data.map((row) => row.name);
      expect(names[0]).toBe('Warehouse');
      expect(body.meta).toMatchObject({ exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS });
    });

    it('each row carries its usage', async () => {
      ctx.repo.usage.set(3, { contracts: 2 });
      const res = await send('GET', `${LIST}?q=office&sort=id`, TEST_BEARERS.admin);
      const body = contractTypesListResponseSchema.parse(JSON.parse(res.payload));
      expect(body.data.slice(0, 2)).toEqual([
        {
          id: '1',
          name: 'Head Office',
          usage: ZERO_USAGE,
        },
        {
          id: '3',
          name: 'Head Office',
          usage: { contracts: 2 },
        },
      ]);
      expect(res.payload).not.toContain('createdBy');
      expect(res.payload).not.toContain('created_by');
      expect(res.payload).not.toContain('contractsCount');
    });

    it('a bad list query is 400 ERP-VALIDATION-0001 with the issues', async () => {
      const res = await send('GET', `${LIST}?sort=unknownField`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.bad);
      expect(JSON.stringify(problem(res).issues)).toContain('sort');
    });
  });

  describe('POST and PATCH (D-29, D-31)', () => {
    it('POST 201, GET :id 200, PATCH 200: the name only changed, one event and one log line each', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: '  Written  ' });
      expect(res.statusCode).toBe(HTTP.created);
      const dto = contractTypesResponseSchema.parse(JSON.parse(res.payload));
      expect(dto).toEqual({
        id: dto.id,
        name: 'Written',
        usage: ZERO_USAGE,
      });
      expect(await ctx.repo.findById(Number(dto.id))).toEqual({
        id: Number(dto.id),
        name: 'Written',
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

    it('a very long name is accepted (LONGTEXT column)', async () => {
      const longName = 'L'.repeat(5000);
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: longName });
      expect(res.statusCode).toBe(HTTP.created);
      const dto = contractTypesResponseSchema.parse(JSON.parse(res.payload));
      expect(dto.name).toBe(longName);
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

    it('PATCH changes only the name', async () => {
      const id = await created('Rename me');
      const before = await ctx.repo.findById(Number(id));
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, { name: 'Renamed' });
      expect(res.statusCode).toBe(HTTP.ok);
      expect(contractTypesResponseSchema.parse(JSON.parse(res.payload)).name).toBe('Renamed');
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

    it('a failed usage count answers 409 its use could not be counted', async () => {
      const id = await created('Count fails');
      vi.spyOn(ctx.repo, 'usageByContractType').mockRejectedValueOnce(new Error('DB failure'));
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.conflict);
      const body = problem(res);
      expect(body.code).toBe('ERP-CONTRACTTYPES-0001');
      expect(body.detail).toBe('its use could not be counted');
    });

    it('names only the non-zero groups, in order', async () => {
      const id = await created('Busy');
      ctx.repo.usage.set(Number(id), {
        contracts: 2,
      });
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(problem(res).detail).toBe('used by 2 contract(s)');
    });
  });

  describe('every export format through the shared core', () => {
    const FORMATS = ['csv', 'xlsx', 'pdf', 'print'] as const;

    it('csv answers name and contracts, the attachment name, no-store and a BOM', async () => {
      const res = await send('GET', `${EXPORT}?sort=id`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="contract-types-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
      expect(res.headers['cache-control']).toBe('no-store');
      expect(
        res.payload.startsWith(`${CSV_BOM}name,contracts\r\nHead Office,0\r\nWarehouse,0\r\n`),
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

    it('format=print answers columns as text rows, no attachment', async () => {
      const res = await send('GET', `${EXPORT}?format=print&q=warehouse`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-disposition']).toBeUndefined();
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['name', 'contracts']);
      expect(body.rows).toEqual([['Warehouse', '0']]);
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
      const labels = ['@SUM(1)'].map((l) => `header=${encodeURIComponent(l)}`);
      const res = await send(
        'GET',
        `${EXPORT}?column=name&q=hyperlink&${labels.join('&')}`,
        TEST_BEARERS.admin,
      );
      expect(res.statusCode).toBe(HTTP.ok);
      const [header, row] = res.payload.slice(CSV_BOM.length).split('\r\n');
      expect(header).toBe("'@SUM(1)");
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

    it('column=name exports that one column (D-13)', async () => {
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
