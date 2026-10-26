import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProblemDetails } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX } from '../../../shared/http/api-prefix.js';
import {
  predefinedRepliesListResponseSchema,
  predefinedReplyResponseSchema,
} from '../dto/predefined-replies.dto.js';
import {
  createPredefinedRepliesTestApp,
  TEST_BEARERS,
  type PredefinedRepliesTestApp,
} from './create-predefined-replies-test-app.js';

const LIST = `/${API_PREFIX}/predefined-replies`;
const record = (id: string | number): string => `${LIST}/${String(id)}`;

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

const ROUTES: readonly { method: Method; url: string; payload?: object; status: number }[] = [
  { method: 'GET', url: LIST, status: 200 },
  { method: 'GET', url: record(1), status: 200 },
  {
    method: 'POST',
    url: LIST,
    payload: { name: 'New reply', message: 'Hello there' },
    status: 201,
  },
  {
    method: 'PATCH',
    url: record(1),
    payload: { name: 'Updated reply', message: 'Updated text' },
    status: 200,
  },
  { method: 'DELETE', url: record(3), status: 200 },
];

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function problem(res: { payload: string; headers: Record<string, unknown> }): ProblemDetails {
  expect(res.headers['content-type']).toContain('application/problem+json');
  return JSON.parse(res.payload) as ProblemDetails;
}

describe('PredefinedRepliesController (Fastify inject)', () => {
  let ctx: PredefinedRepliesTestApp;

  beforeAll(async () => {
    ctx = await createPredefinedRepliesTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  const send = (
    method: Method,
    url: string,
    token?: string,
    payload?: object,
  ): ReturnType<PredefinedRepliesTestApp['app']['inject']> =>
    ctx.app.inject({
      method,
      url,
      ...(token === undefined ? {} : { headers: bearer(token) }),
      ...(payload === undefined ? {} : { payload }),
    });

  it('registers all five API routes, including DELETE', () => {
    for (const route of [
      `GET ${LIST}`,
      `GET ${LIST}/:id`,
      `POST ${LIST}`,
      `PATCH ${LIST}/:id`,
      `DELETE ${LIST}/:id`,
    ]) {
      expect(ctx.routes).toContain(route);
    }
  });

  describe('administrator-only access', () => {
    it.each(ROUTES)(
      '$method $url rejects non-admins with every permission code',
      async ({ method, url, payload }) => {
        const res = await send(method, url, TEST_BEARERS.everyCode, payload);
        expect(res.statusCode).toBe(403);
        expect(problem(res).code).toBe('ERP-AUTH-0005');
      },
    );

    it.each(ROUTES)(
      '$method $url rejects users without permissions',
      async ({ method, url, payload }) => {
        const res = await send(method, url, TEST_BEARERS.noPermission, payload);
        expect(res.statusCode).toBe(403);
        expect(problem(res).code).toBe('ERP-AUTH-0005');
      },
    );

    it.each(ROUTES)(
      '$method $url rejects unauthenticated requests',
      async ({ method, url, payload }) => {
        const res = await send(method, url, undefined, payload);
        expect(res.statusCode).toBe(401);
        expect(problem(res).code).toBe('ERP-AUTH-0004');
      },
    );

    it.each(ROUTES)(
      '$method $url is accessible to an administrator',
      async ({ method, url, payload, status }) => {
        const target =
          method === 'DELETE' || method === 'PATCH'
            ? record(await createReply(`Route check ${method}`))
            : url;
        const res = await send(method, target, TEST_BEARERS.admin, payload);
        expect(res.statusCode).toBe(status);
      },
    );
  });

  const createReply = async (name: string): Promise<string> => {
    const res = await send('POST', LIST, TEST_BEARERS.admin, {
      name,
      message: 'Temporary message',
    });
    expect(res.statusCode).toBe(201);
    return predefinedReplyResponseSchema.parse(JSON.parse(res.payload)).id;
  };

  it('lists replies in the expected response envelope', async () => {
    const res = await send('GET', LIST, TEST_BEARERS.admin);
    expect(res.statusCode).toBe(200);
    const body = predefinedRepliesListResponseSchema.parse(JSON.parse(res.payload));
    expect(body.data.length).toBeGreaterThanOrEqual(3);
    expect(body.data).toContainEqual(
      expect.objectContaining({
        id: '1',
        name: 'First',
        message: 'First reply message',
      }),
    );
    expect(body.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('searches by name or message', async () => {
    const res = await send('GET', `${LIST}?q=Second%20reply`, TEST_BEARERS.admin);
    expect(res.statusCode).toBe(200);
    const body = predefinedRepliesListResponseSchema.parse(JSON.parse(res.payload));
    expect(body.data.map((reply) => reply.name)).toEqual(['Second']);
  });

  it('creates, reads, updates, and deletes a reply', async () => {
    const created = await send('POST', LIST, TEST_BEARERS.admin, {
      name: 'New reply',
      message: 'Original message',
    });
    expect(created.statusCode).toBe(201);
    const dto = predefinedReplyResponseSchema.parse(JSON.parse(created.payload));

    const read = await send('GET', record(dto.id), TEST_BEARERS.admin);
    expect(read.statusCode).toBe(200);
    expect(JSON.parse(read.payload)).toEqual(dto);

    const updated = await send('PATCH', record(dto.id), TEST_BEARERS.admin, {
      name: 'Updated reply',
      message: 'Updated message',
    });
    expect(updated.statusCode).toBe(200);
    expect(JSON.parse(updated.payload)).toMatchObject({
      id: dto.id,
      name: 'Updated reply',
      message: 'Updated message',
    });

    const deleted = await send('DELETE', record(dto.id), TEST_BEARERS.admin);
    expect(deleted.statusCode).toBe(200);
    expect(JSON.parse(deleted.payload)).toEqual({ success: true });

    const missing = await send('GET', record(dto.id), TEST_BEARERS.admin);
    expect(missing.statusCode).toBe(404);
    expect(problem(missing).code).toBe('ERP-CORE-0004');
  });

  it('rejects an invalid create body', async () => {
    const res = await send('POST', LIST, TEST_BEARERS.admin, {
      name: ' ',
      message: 'Message',
    });
    expect(res.statusCode).toBe(400);
    expect(problem(res).code).toBe('ERP-VALIDATION-0001');
  });

  it('rejects invalid identifiers', async () => {
    const res = await send('GET', record('not-a-number'), TEST_BEARERS.admin);
    expect(res.statusCode).toBe(400);
    expect(problem(res).code).toBe('ERP-VALIDATION-0001');
  });

  it('includes a request id on responses', async () => {
    const res = await send('GET', LIST, TEST_BEARERS.admin);
    expect(res.headers['x-request-id']).toBeTruthy();
  });
});
