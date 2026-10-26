/**
 * The HTTP contract of `api/v1/customer-groups`, through a real Nest + Fastify app with the
 * repository replaced by the in-memory fake: the guards, the validation, the problem-details
 * filter and the routes are the production code. Each test gets a fresh app, so none depends on
 * another.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createCustomerGroupsTestApp,
  TEST_BEARERS,
  type CustomerGroupsTestApp,
} from './create-customer-groups-test-app.js';

const BASE = '/api/v1/customer-groups';

let ctx: CustomerGroupsTestApp;

beforeEach(async () => {
  ctx = await createCustomerGroupsTestApp();
});

afterEach(async () => {
  await ctx.close();
});

function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  bearer: string | null = TEST_BEARERS.admin,
  payload?: unknown,
) {
  return ctx.app.inject({
    method,
    url,
    headers: bearer === null ? {} : { authorization: `Bearer ${bearer}` },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

interface Group {
  readonly id: string;
  readonly name: string;
}

describe('access: administrators only', () => {
  type Request = ['GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?];
  const requests: Request[] = [
    ['GET', BASE],
    ['GET', `${BASE}/1`],
    ['POST', BASE, { name: 'VIP' }],
    ['PATCH', `${BASE}/1`, { name: 'VIP' }],
    ['DELETE', `${BASE}/1`],
  ];

  it.each(requests)('%s %s without a bearer is 401', async (method, url, payload) => {
    const res = await call(method, url, null, payload);
    expect(res.statusCode).toBe(401);
  });

  it.each(requests)(
    '%s %s is 403 for a member holding every permission code',
    async (method, url, payload) => {
      const res = await call(method, url, TEST_BEARERS.everyCode, payload);
      expect(res.statusCode).toBe(403);
    },
  );

  it.each(requests)('%s %s is 403 for a member holding no code', async (method, url, payload) => {
    const res = await call(method, url, TEST_BEARERS.noPermission, payload);
    expect(res.statusCode).toBe(403);
  });

  it('a refused write changes nothing', async () => {
    await call('DELETE', `${BASE}/1`, TEST_BEARERS.everyCode);
    expect(await ctx.repo.findById(1)).not.toBeNull();
    expect(ctx.repo.links).toHaveLength(3);
  });
});

describe('GET /customer-groups', () => {
  it('lists the groups, the id descending, with the pager meta', async () => {
    const res = await call('GET', BASE);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Group[]; meta: { total: number; rangeStart: number } }>();
    expect(body.data.map((group) => group.id)).toEqual(['3', '2', '1']);
    expect(body.meta.total).toBe(3);
    expect(body.meta.rangeStart).toBe(1);
  });

  it('searches by name', async () => {
    const res = await call('GET', `${BASE}?q=silver`);
    expect(res.json<{ data: Group[] }>().data).toEqual([{ id: '2', name: 'Silver' }]);
  });

  it('refuses a bad sort with 400', async () => {
    const res = await call('GET', `${BASE}?sort=datecreated`);
    expect(res.statusCode).toBe(400);
  });
});

describe('GET /customer-groups/:id', () => {
  it('answers one group', async () => {
    const res = await call('GET', `${BASE}/1`);
    expect(res.statusCode).toBe(200);
    expect(res.json<Group>()).toEqual({ id: '1', name: 'Gold' });
  });

  it('answers 404 for a missing id', async () => {
    const res = await call('GET', `${BASE}/99`);
    expect(res.statusCode).toBe(404);
  });

  it('answers 400 for an id that is not a positive number', async () => {
    const res = await call('GET', `${BASE}/abc`);
    expect(res.statusCode).toBe(400);
  });
});

describe('POST /customer-groups', () => {
  it('creates a group with the trimmed name and logs the id only', async () => {
    const res = await call('POST', BASE, TEST_BEARERS.admin, { name: '  Platinum ' });
    expect(res.statusCode).toBe(201);
    expect(res.json<Group>()).toEqual({ id: '4', name: 'Platinum' });
    expect(ctx.logger.lines).toContainEqual({
      message: 'customer group created',
      meta: { id: 4 },
    });
  });

  it('accepts a name another group already holds (Perfex has no uniqueness check)', async () => {
    const res = await call('POST', BASE, TEST_BEARERS.admin, { name: 'Gold' });
    expect(res.statusCode).toBe(201);
  });

  it('refuses an empty name with 400', async () => {
    const res = await call('POST', BASE, TEST_BEARERS.admin, { name: '' });
    expect(res.statusCode).toBe(400);
  });

  it('refuses a name longer than 191 characters with 400', async () => {
    const res = await call('POST', BASE, TEST_BEARERS.admin, { name: 'a'.repeat(192) });
    expect(res.statusCode).toBe(400);
  });

  it('refuses any other key with 400', async () => {
    const res = await call('POST', BASE, TEST_BEARERS.admin, { name: 'VIP', id: 9 });
    expect(res.statusCode).toBe(400);
  });
});

describe('PATCH /customer-groups/:id', () => {
  it('renames the group', async () => {
    const res = await call('PATCH', `${BASE}/2`, TEST_BEARERS.admin, { name: 'Bronze' });
    expect(res.statusCode).toBe(200);
    expect(res.json<Group>()).toEqual({ id: '2', name: 'Bronze' });
  });

  it('answers 404 for a missing id', async () => {
    const res = await call('PATCH', `${BASE}/99`, TEST_BEARERS.admin, { name: 'x' });
    expect(res.statusCode).toBe(404);
  });

  it('answers 400 for an empty body', async () => {
    const res = await call('PATCH', `${BASE}/2`, TEST_BEARERS.admin, {});
    expect(res.statusCode).toBe(400);
  });
});

describe('DELETE /customer-groups/:id', () => {
  it('answers 204 and the group is gone', async () => {
    const res = await call('DELETE', `${BASE}/2`);
    expect(res.statusCode).toBe(204);
    expect((await call('GET', `${BASE}/2`)).statusCode).toBe(404);
    expect(ctx.logger.lines).toContainEqual({
      message: 'customer group deleted',
      meta: { id: 2 },
    });
  });

  it("also removes the group's customer links, and only that group's", async () => {
    const res = await call('DELETE', `${BASE}/1`);
    expect(res.statusCode).toBe(204);
    expect(ctx.repo.links.filter((link) => link.groupid === 1)).toEqual([]);
    expect(ctx.repo.links).toEqual([{ groupid: 2, customerId: 10 }]);
  });

  it('answers 404 for a missing id and leaves every link alone', async () => {
    const res = await call('DELETE', `${BASE}/99`);
    expect(res.statusCode).toBe(404);
    expect(ctx.repo.links).toHaveLength(3);
  });
});
