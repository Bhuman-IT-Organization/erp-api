import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CSV_BOM } from '../../../shared/http/csv.js';
import { PDF_CONTENT_TYPE } from '../../../shared/http/pdf.js';
import { XLSX_CONTENT_TYPE } from '../../../shared/http/xlsx.js';
import { ESTIMATE_REQUEST_STATUSES_ROUTES } from '../estimate-request-statuses.routes.js';
import {
  estimateRequestStatusResponseSchema,
  estimateRequestStatusesListResponseSchema,
} from '../dto/estimate-request-statuses.dto.js';
import {
  EstimateRequestStatusCreatedV1,
  EstimateRequestStatusDeletedV1,
  EstimateRequestStatusUpdatedV1,
} from '../events/published.js';
import {
  createEstimateRequestStatusesTestApp,
  TEST_BEARERS,
  type EstimateRequestStatusesTestApp,
} from './create-estimate-request-statuses-test-app.js';

interface ProblemDetails {
  readonly code?: string;
  readonly detail?: string;
  readonly issues?: readonly unknown[];
}

const LIST = `/api/v1/${ESTIMATE_REQUEST_STATUSES_ROUTES.base}`;
const EXPORT = `${LIST}/${ESTIMATE_REQUEST_STATUSES_ROUTES.export}`;
const record = (id: number | string) => `${LIST}/${String(id)}`;
const HTTP = {
  ok: 200,
  created: 201,
  noContent: 204,
  bad: 400,
  unauthorized: 401,
  forbidden: 403,
  notFound: 404,
  conflict: 409,
} as const;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const ROUTES: readonly { method: Method; url: string; payload?: object; success: number }[] = [
  { method: 'GET', url: LIST, success: HTTP.ok },
  { method: 'GET', url: EXPORT, success: HTTP.ok },
  { method: 'GET', url: record(1), success: HTTP.ok },
  { method: 'POST', url: LIST, payload: { name: 'New' }, success: HTTP.created },
  { method: 'PATCH', url: record(1), payload: { name: 'Renamed' }, success: HTTP.ok },
  { method: 'DELETE', url: record(2), success: HTTP.noContent },
];

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('EstimateRequestStatusesController (Fastify inject, production guards)', () => {
  let ctx: EstimateRequestStatusesTestApp;
  let nextName = 0;

  beforeAll(async () => {
    ctx = await createEstimateRequestStatusesTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(() => {
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    ctx.repo.reset();
    vi.restoreAllMocks();
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<EstimateRequestStatusesTestApp['app']['inject']> =>
    ctx.app.inject({
      method,
      url,
      ...(token === undefined ? {} : { headers: { authorization: `Bearer ${token}` } }),
      ...(payload === undefined ? {} : { payload }),
    });

  const created = async (payload: object = { name: `Temporary ${String(++nextName)}` }) => {
    const res = await send('POST', LIST, TEST_BEARERS.admin, payload);
    expect(res.statusCode).toBe(HTTP.created);
    ctx.events.drain();
    ctx.logger.lines.length = 0;
    return estimateRequestStatusResponseSchema.parse(JSON.parse(res.payload)).id;
  };

  it('registers all six routes under /api/v1/estimate-request-statuses', () => {
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

  describe('authentication and administrator guard', () => {
    it.each(ROUTES)('$method $url is 401 without a bearer', async ({ method, url, payload }) => {
      const res = await send(method, url, undefined, payload);
      expect(res.statusCode).toBe(HTTP.unauthorized);
      expect(problem(res).code).toBe('ERP-AUTH-0004');
    });

    it.each(ROUTES)(
      '$method $url is 403 for an authenticated non-administrator',
      async ({ method, url, payload }) => {
        const res = await send(method, url, TEST_BEARERS.everyCode, payload);
        expect(res.statusCode).toBe(HTTP.forbidden);
        expect(problem(res).code).toBe('ERP-AUTH-0005');
      },
    );

    it.each(ROUTES)('$method $url permits an administrator', async ({ method, url, payload }) => {
      const target = method === 'DELETE' ? record(await created()) : url;
      const res = await send(method, target, TEST_BEARERS.admin, payload);
      expect(res.statusCode).toBe(
        ROUTES.find((route) => route.method === method && route.url === url)?.success,
      );
    });
  });

  describe('GET list', () => {
    it('lists, sorts, searches by name and id, and pages forward with a cursor', async () => {
      const initial = await send('GET', `${LIST}?sort=id&limit=1`, TEST_BEARERS.admin);
      expect(initial.statusCode).toBe(HTTP.ok);
      const first = estimateRequestStatusesListResponseSchema.parse(JSON.parse(initial.payload));
      expect(first.data.map(({ id }) => id)).toEqual(['1']);
      expect(first.meta.nextCursor).not.toBeNull();

      const next = await send(
        'GET',
        `${LIST}?sort=id&limit=1&cursor=${encodeURIComponent(first.meta.nextCursor ?? '')}`,
        TEST_BEARERS.admin,
      );
      expect(
        estimateRequestStatusesListResponseSchema.parse(JSON.parse(next.payload)).data[0]?.id,
      ).toBe('2');

      const sorted = await send('GET', `${LIST}?sort=-id`, TEST_BEARERS.admin);
      expect(
        estimateRequestStatusesListResponseSchema
          .parse(JSON.parse(sorted.payload))
          .data.map(({ id }) => id),
      ).toEqual(['3', '2', '1']);
      const byName = await send('GET', `${LIST}?q=eady`, TEST_BEARERS.admin);
      expect(
        estimateRequestStatusesListResponseSchema
          .parse(JSON.parse(byName.payload))
          .data.map(({ id }) => id),
      ).toEqual(['2']);
      const byId = await send('GET', `${LIST}?q=1`, TEST_BEARERS.admin);
      expect(
        estimateRequestStatusesListResponseSchema
          .parse(JSON.parse(byId.payload))
          .data.map(({ id }) => id),
      ).toContain('1');
    });
  });

  describe('create and update', () => {
    it('creates with a trimmed name, blank color default, and blank order as null', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, {
        name: '  New status  ',
        color: '',
        statusorder: '',
      });
      expect(res.statusCode).toBe(HTTP.created);
      expect(res.json()).toMatchObject({
        name: 'New status',
        color: '#757575',
        statusorder: null,
      });
      const [event] = ctx.events.drain();
      expect(event).toBeInstanceOf(EstimateRequestStatusCreatedV1);
      expect(event?.payload).toMatchObject({ id: Number(res.json<{ id: string }>().id) });
      expect(Object.keys(event?.payload ?? {}).sort()).toEqual(['at', 'id']);
    });

    it('uses the row count plus one when statusorder is not sent', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, {
        name: `Ordered ${String(++nextName)}`,
      });
      expect(res.statusCode).toBe(HTTP.created);
      expect(res.json<{ statusorder: number }>().statusorder).toBe(ctx.repo.rows.size);
    });

    it('refuses flag and other undeclared write fields', async () => {
      const res = await send('POST', LIST, TEST_BEARERS.admin, { name: 'No flag', flag: 'x' });
      expect(res.statusCode).toBe(HTTP.bad);
      expect(JSON.stringify(problem(res).issues)).toContain('flag');
      const patch = await send('PATCH', record(1), TEST_BEARERS.admin, { flag: 'x' });
      expect(patch.statusCode).toBe(HTTP.bad);
    });

    it('updates writable values and publishes the update event', async () => {
      const id = await created();
      const res = await send('PATCH', record(id), TEST_BEARERS.admin, {
        name: 'Changed',
        statusorder: '7',
      });
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.json()).toMatchObject({ id, name: 'Changed', statusorder: 7 });
      const [event] = ctx.events.drain();
      expect(event).toBeInstanceOf(EstimateRequestStatusUpdatedV1);
      expect(event?.payload).toEqual({ id: Number(id), at: '2026-10-24T10:30:00.000Z' });
    });

    it('returns 404 for missing reads and updates', async () => {
      const get = await send('GET', record(99999), TEST_BEARERS.admin);
      expect(get.statusCode).toBe(HTTP.notFound);
      expect(problem(get).code).toBe('ERP-CORE-0004');
      const update = await send('PATCH', record(99999), TEST_BEARERS.admin, { name: 'Missing' });
      expect(update.statusCode).toBe(HTTP.notFound);
      expect(problem(update).code).toBe('ERP-CORE-0004');
    });
  });

  describe('DELETE', () => {
    it('answers 204 without a body and publishes the delete event', async () => {
      const id = await created();
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.noContent);
      expect(res.payload).toBe('');
      const [event] = ctx.events.drain();
      expect(event).toBeInstanceOf(EstimateRequestStatusDeletedV1);
      expect(event?.payload).toEqual({ id: Number(id), at: '2026-10-24T10:30:00.000Z' });
      expect((await send('GET', record(id), TEST_BEARERS.admin)).statusCode).toBe(HTTP.notFound);
    });

    it('returns 404 for a missing status', async () => {
      const res = await send('DELETE', record(99999), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.notFound);
      expect(problem(res).code).toBe('ERP-CORE-0004');
    });

    it('returns 409 while a status is referenced', async () => {
      const id = await created();
      ctx.repo.referenceCounts.set(Number(id), 1);
      const res = await send('DELETE', record(id), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.conflict);
      expect(problem(res).code).toBe('ERP-ESTIMATEREQUESTSTATUSES-0001');
      expect(problem(res).detail).toBe('estimate request status is still referenced');
    });

    it('returns 409 for a built-in status after checking references', async () => {
      const res = await send('DELETE', record(3), TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.conflict);
      expect(problem(res).code).toBe('ERP-ESTIMATEREQUESTSTATUSES-0002');
    });
  });

  describe('export formats', () => {
    it('exports CSV with the expected columns and BOM', async () => {
      const res = await send('GET', `${EXPORT}?format=csv`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
      expect(res.payload.startsWith(`${CSV_BOM}id,name,total_request\r\n`)).toBe(true);
    });

    it.each([
      ['xlsx', XLSX_CONTENT_TYPE, 'PK'],
      ['pdf', PDF_CONTENT_TYPE, '%PDF-'],
    ] as const)('exports %s with its content type', async (format, contentType, magic) => {
      const res = await send('GET', `${EXPORT}?format=${format}`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(res.headers['content-type']).toBe(contentType);
      expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
    });

    it('exports print rows as JSON', async () => {
      const res = await send('GET', `${EXPORT}?format=print`, TEST_BEARERS.admin);
      expect(res.statusCode).toBe(HTTP.ok);
      expect(JSON.parse(res.payload)).toMatchObject({
        headers: ['id', 'name', 'total_request'],
      });
    });
  });
});
