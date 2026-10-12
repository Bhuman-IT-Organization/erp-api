/**
 * The HTTP contract of the three read routes under `/api/v1/custom-fields`, proven in-process with
 * Fastify `inject`: administrators only on every handler (a bearer holding every catalogue code is
 * refused 403 `ERP-AUTH-0005` before any read, a bearer holding none too, no bearer is 401
 * `ERP-AUTH-0004`), the list with its value counts and its one filter, the record with its
 * fingerprint, the four export formats, no write route at all (the tables are Perfex's), and the
 * ADR-0030 route assertion.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { PDF_CONTENT_TYPE } from '../../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../../shared/http/xlsx.js';
import { CUSTOM_FIELDS_ROUTES } from '../custom-fields.routes.js';
import {
  customFieldsListResponseSchema,
  customFieldsResponseSchema,
} from '../dto/custom-fields.dto.js';
import {
  createCustomFieldsTestApp,
  TEST_BEARERS,
  type CustomFieldsTestApp,
} from './create-custom-fields-test-app.js';

const LIST = `/${API_PREFIX}/${CUSTOM_FIELDS_ROUTES.base}`;
const EXPORT = `${LIST}/${CUSTOM_FIELDS_ROUTES.export}`;
const record = (id: number): string => `${LIST}/${String(id)}`;
const HTTP = {
  ok: 200,
  bad: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
};

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

/** The three routes. */
const ROUTES: readonly { method: Method; url: string }[] = [
  { method: 'GET', url: LIST },
  { method: 'GET', url: EXPORT },
  { method: 'GET', url: record(1) },
];

/** The write routes this copy removed: Perfex's Setup > Custom Fields page is the only writer. */
const REMOVED_WRITES: readonly { method: Method; url: string; payload?: object }[] = [
  { method: 'POST', url: LIST, payload: { fieldto: 'leads', type: 'input', name: 'New' } },
  { method: 'PATCH', url: record(1), payload: { name: 'Renamed' } },
  { method: 'PATCH', url: `${record(1)}/active`, payload: { active: false } },
  { method: 'DELETE', url: record(3) },
];

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('CustomFieldsController (Fastify inject, no network)', () => {
  let ctx: CustomFieldsTestApp;

  beforeAll(async () => {
    ctx = await createCustomFieldsTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    ctx.logger.lines.length = 0;
    vi.restoreAllMocks();
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<CustomFieldsTestApp['app']['inject']> =>
    ctx.app.inject({
      method,
      url,
      headers: token === undefined ? {} : { authorization: `Bearer ${token}` },
      ...(payload === undefined ? {} : { payload }),
    });

  it('registers the three read routes under /api/v1/custom-fields', () => {
    for (const route of [`GET ${LIST}`, `GET ${EXPORT}`, `GET ${LIST}/:id`]) {
      expect(ctx.routes).toContain(route);
    }
  });

  it('registers no write route under /api/v1/custom-fields: Perfex owns both tables', () => {
    const writes = ctx.routes.filter(
      (route) =>
        /^(POST|PUT|PATCH|DELETE) /.test(route) &&
        route.slice(route.indexOf(' ') + 1).startsWith(LIST),
    );
    expect(writes).toEqual([]);
  });

  it.each(REMOVED_WRITES)(
    '$method $url is 404 for an administrator and reaches no handler',
    async ({ method, url, payload }) => {
      const res = await send(method, url, TEST_BEARERS.admin, payload);
      expect(res.statusCode).toBe(HTTP.notFound);
      expect(await ctx.repo.findById(1)).toMatchObject({ name: 'Source', active: true });
      expect(await ctx.repo.findById(3)).not.toBeNull();
    },
  );

  describe('administrators only (Perfex: is_admin(), T-4.2-66)', () => {
    it.each(ROUTES)(
      '$method $url with a bearer holding every catalogue code is 403 ERP-AUTH-0005 before any read',
      async ({ method, url }) => {
        const reads = [
          vi.spyOn(ctx.repo, 'list'),
          vi.spyOn(ctx.repo, 'count'),
          vi.spyOn(ctx.repo, 'findById'),
          vi.spyOn(ctx.repo, 'valuesCountOf'),
        ];
        const res = await send(method, url, TEST_BEARERS.everyCode);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(problem(res).code).toBe('ERP-AUTH-0005');
        expect(problem(res).detail).toBe('custom fields are managed by administrators only');
        for (const spy of reads) expect(spy).not.toHaveBeenCalled();
        expect(ctx.logger.lines).toEqual([]);
      },
    );

    it.each(ROUTES)(
      '$method $url with a bearer holding no code is 403 ERP-AUTH-0005',
      async ({ method, url }) => {
        const res = await send(method, url, TEST_BEARERS.noPermission);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(problem(res).code).toBe('ERP-AUTH-0005');
      },
    );

    it.each(ROUTES)(
      '$method $url without a bearer is 401 ERP-AUTH-0004',
      async ({ method, url }) => {
        const res = await send(method, url);
        expect(res.statusCode).toBe(HTTP.unauthorized);
        expect(problem(res).code).toBe('ERP-AUTH-0004');
      },
    );
  });

  it('GET list answers the envelope with the value counts, and filters by fieldto', async () => {
    ctx.repo.addValue(2, 501, 'a');
    const res = await send('GET', `${LIST}?filter[fieldto][in]=items,staff`, TEST_BEARERS.admin);
    expect(res.statusCode).toBe(HTTP.ok);
    const body = customFieldsListResponseSchema.parse(JSON.parse(res.payload));
    expect(body.data.map((row) => [row.id, row.fieldto, row.active])).toEqual([
      [2, 'items', true],
      [3, 'staff', false],
    ]);
    expect(body.data[0]?.valuesCount).toBe(1);
    expect(body.meta.exportLimit).toBeGreaterThan(0);
  });

  it('a filter on another field, or an unknown entity, is a 400', async () => {
    for (const query of ['filter[name][in]=x', 'filter[fieldto][in]=nope']) {
      const res = await send('GET', `${LIST}?${query}`, TEST_BEARERS.admin);
      expect(res.statusCode, query).toBe(HTTP.bad);
    }
  });

  it('GET :id answers the record as stored with its value count, and its etag in the header and the body', async () => {
    const res = await send('GET', record(2), TEST_BEARERS.admin);
    expect(res.statusCode).toBe(HTTP.ok);
    const body = customFieldsResponseSchema.parse(JSON.parse(res.payload));
    expect(res.headers.etag).toBe(body.etag);
    expect(body).toMatchObject({
      id: 2,
      fieldto: 'items',
      type: 'select',
      slug: 'items_grade',
      options: ['a', 'b'],
      disabled: false,
      showOnPdf: true,
    });
    expect(body.valuesCount).toBeGreaterThanOrEqual(0);
    expect(ctx.logger.lines).toEqual([]);
  });

  it('GET of a missing id is 404 ERP-CORE-0004; a non-numeric :id is a 400, never a 404 probe', async () => {
    const missing = await send('GET', record(999_999), TEST_BEARERS.admin);
    expect(missing.statusCode).toBe(HTTP.notFound);
    expect(problem(missing).code).toBe('ERP-CORE-0004');
    expect((await send('GET', `${LIST}/abc`, TEST_BEARERS.admin)).statusCode).toBe(HTTP.bad);
  });

  describe('the export (ADR-0043)', () => {
    it('format=csv answers text/csv with the attachment name', async () => {
      const res = await send('GET', `${EXPORT}?format=csv`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(
        /^attachment; filename="custom-fields-\d{4}-\d{2}-\d{2}\.csv"$/,
      );
    });

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)('format=%s answers its content type', async (format, contentType, magic) => {
      const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe(contentType);
      expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
    });

    it('format=print answers JSON rows of the six columns', async () => {
      const res = await send(
        'GET',
        `${EXPORT}?format=print&filter[fieldto][in]=leads&q=source`,
        TEST_BEARERS.admin,
      );
      expect(res.statusCode).toBe(HTTP.ok);
      const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
      expect(body.headers).toEqual(['id', 'name', 'fieldto', 'type', 'slug', 'active']);
      expect(body.rows[0]?.slice(0, 5)).toEqual(['1', 'Source', 'leads', 'input', 'leads_source']);
    });

    it('key is a 400 on its path: the list has no row selection', async () => {
      const res = await send('GET', `${EXPORT}?key=1`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.bad);
      expect(problem(res).issues).toEqual([expect.objectContaining({ path: ['key'] })]);
    });
  });

  it('ADR-0030: every route is under /api/v1/ or one of UNPREFIXED_ROUTES', () => {
    const unprefixed: readonly string[] = UNPREFIXED_ROUTES.map((route) => `/${route}`);
    for (const route of ctx.routes) {
      const url = route.slice(route.indexOf(' ') + 1);
      expect(url.startsWith(`/${API_PREFIX}/`) || unprefixed.includes(url), route).toBe(true);
    }
  });
});
