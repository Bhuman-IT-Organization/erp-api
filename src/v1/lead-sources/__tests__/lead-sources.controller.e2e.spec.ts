import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX } from '../../../shared/http/api-prefix.js';
import { CSV_BOM } from '../../../shared/http/csv.js';
import { LEAD_SOURCES_ROUTES } from '../lead-sources.routes.js';
import { leadSourcesResponseSchema } from '../dto/lead-sources.dto.js';
import {
  LeadSourcesCreatedV1,
  LeadSourcesDeletedV1,
  LeadSourcesUpdatedV1,
} from '../events/published.js';
import type { LeadSourceUsage } from '../model/lead-sources.model.js';
import {
  createLeadSourcesTestApp,
  TEST_BEARERS,
  type LeadSourcesTestApp,
} from './create-lead-sources-test-app.js';
import { ZERO_USAGE } from './fakes.js';

const LIST = `/${API_PREFIX}/${LEAD_SOURCES_ROUTES.base}`;
const EXPORT = `${LIST}/${LEAD_SOURCES_ROUTES.export}`;
const record = (id: string | number): string => `${LIST}/${String(id)}`;
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
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const ROUTES: readonly { method: Method; url: string; payload?: object; admin: number }[] = [
  { method: 'GET', url: LIST, admin: HTTP.ok },
  { method: 'GET', url: EXPORT, admin: HTTP.ok },
  { method: 'GET', url: record(1), admin: HTTP.ok },
  { method: 'POST', url: LIST, payload: { name: 'New' }, admin: HTTP.created },
  { method: 'PATCH', url: record(1), payload: { name: 'Website' }, admin: HTTP.ok },
  { method: 'DELETE', url: record(2), admin: HTTP.noContent },
];

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(response: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(response.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(response.payload) as ProblemDetails;
}

describe('LeadSourcesController (Fastify inject)', () => {
  let context: LeadSourcesTestApp;

  beforeAll(async () => {
    context = await createLeadSourcesTestApp();
  });
  afterAll(async () => {
    await context.close();
  });
  beforeEach(() => {
    context.events.drain();
    context.logger.lines.length = 0;
    context.repo.usage.clear();
    vi.restoreAllMocks();
  });

  const send = (method: Method, url: string, token?: string, payload?: object) =>
    context.app.inject({
      method,
      url,
      ...(token === undefined ? {} : { headers: bearer(token) }),
      ...(payload === undefined ? {} : { payload }),
    });

  const created = async (name: string): Promise<string> => {
    const response = await send('POST', LIST, TEST_BEARERS.admin, { name });
    expect(response.statusCode).toBe(HTTP.created);
    context.events.drain();
    context.logger.lines.length = 0;
    return leadSourcesResponseSchema.parse(JSON.parse(response.payload)).id;
  };

  it('registers all six routes, including export and DELETE', () => {
    for (const route of [
      `GET ${LIST}`,
      `GET ${EXPORT}`,
      `GET ${LIST}/:id`,
      `POST ${LIST}`,
      `PATCH ${LIST}/:id`,
      `DELETE ${LIST}/:id`,
    ]) {
      expect(context.routes).toContain(route);
    }
  });

  it.each(ROUTES)(
    '$method $url rejects a non-admin before repository access',
    async ({ method, url, payload }) => {
      const reads = [
        vi.spyOn(context.repo, 'list'),
        vi.spyOn(context.repo, 'count'),
        vi.spyOn(context.repo, 'findById'),
        vi.spyOn(context.repo, 'create'),
        vi.spyOn(context.repo, 'update'),
        vi.spyOn(context.repo, 'remove'),
        vi.spyOn(context.repo, 'usageByLeadSource'),
      ];
      const response = await send(method, url, TEST_BEARERS.everyCode, payload);
      expect(response.statusCode).toBe(HTTP.forbidden);
      expect(problem(response).code).toBe('ERP-AUTH-0005');
      expect(context.events.count).toBe(0);
      expect(context.logger.lines).toEqual([]);
      for (const read of reads) expect(read).not.toHaveBeenCalled();
    },
  );

  it.each(ROUTES)(
    '$method $url rejects unauthenticated callers',
    async ({ method, url, payload }) => {
      const response = await send(method, url, undefined, payload);
      expect(response.statusCode).toBe(HTTP.unauthorized);
      expect(problem(response).code).toBe('ERP-AUTH-0004');
    },
  );

  it('lists source usage and sends request ids', async () => {
    context.repo.usage.set(3, { ...ZERO_USAGE, leads: 2 });
    const response = await send('GET', LIST, TEST_BEARERS.admin);
    expect(response.statusCode).toBe(HTTP.ok);
    expect(response.headers['x-request-id']).toBeTruthy();
    const body = JSON.parse(response.payload) as {
      data: { id: string; usage: LeadSourceUsage }[];
    };
    expect(body.data.map((row) => row.id)).toEqual(['2', '1', '3']);
    expect(body.data[2]).toEqual({
      id: '3',
      name: 'Website',
      usage: { ...ZERO_USAGE, leads: 2 },
    });
  });

  it('creates, updates and deletes with events and expected status codes', async () => {
    const create = await send('POST', LIST, TEST_BEARERS.admin, { name: 'New source' });
    expect(create.statusCode).toBe(HTTP.created);
    const createdRecord = leadSourcesResponseSchema.parse(JSON.parse(create.payload));
    expect(context.events.drain()).toMatchObject([
      {
        name: LeadSourcesCreatedV1.NAME,
        payload: { id: 4, at: '2026-10-02T20:30:15.250Z' },
      },
    ]);

    const update = await send('PATCH', record(createdRecord.id), TEST_BEARERS.admin, {
      name: 'Updated',
    });
    expect(update.statusCode).toBe(HTTP.ok);
    expect(context.events.drain()).toMatchObject([
      {
        name: LeadSourcesUpdatedV1.NAME,
        payload: { id: 4, at: '2026-10-02T20:30:15.250Z' },
      },
    ]);

    const remove = await send('DELETE', record(createdRecord.id), TEST_BEARERS.admin);
    expect(remove.statusCode).toBe(HTTP.noContent);
    expect(context.events.drain()).toMatchObject([
      {
        name: LeadSourcesDeletedV1.NAME,
        payload: { id: 4, at: '2026-10-02T20:30:15.250Z' },
      },
    ]);
  });

  it('validates input, returns not found for missing records, and refuses used records', async () => {
    const invalid = await send('POST', LIST, TEST_BEARERS.admin, { name: '' });
    expect(invalid.statusCode).toBe(HTTP.bad);
    expect(problem(invalid).code).toBe('ERP-VALIDATION-0001');
    const absent = await send('GET', record(404), TEST_BEARERS.admin);
    expect(absent.statusCode).toBe(HTTP.notFound);
    expect(problem(absent).code).toBe('ERP-CORE-0004');
    context.repo.usage.set(1, { ...ZERO_USAGE, leads: 1 });
    const conflict = await send('DELETE', record(1), TEST_BEARERS.admin);
    expect(conflict.statusCode).toBe(HTTP.conflict);
    expect(problem(conflict).code).toBe('ERP-LEADSOURCES-0001');
  });

  it('exports all three columns as CSV', async () => {
    const response = await send('GET', EXPORT, TEST_BEARERS.admin);
    expect(response.statusCode).toBe(HTTP.ok);
    expect(response.payload.replace(CSV_BOM, '')).toContain('id,name,totalLeads');
  });

  it('an administrator can access every route with the declared status', async () => {
    for (const route of ROUTES) {
      const url = route.method === 'DELETE' ? record(await created('Disposable')) : route.url;
      const response = await send(route.method, url, TEST_BEARERS.admin, route.payload);
      expect(response.statusCode).toBe(route.admin);
    }
    expect(ZERO_USAGE).toEqual({ leads: 0, emailIntegrations: 0, webToLeadForms: 0 });
  });
});
