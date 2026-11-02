/**
 * The HTTP contract of `api/v1/customer-groups`, through a real Nest + Fastify app with the
 * repository replaced by the in-memory fake: the guards, the validation, the problem-details
 * filter and the routes are the production code. Each test gets a fresh app, so none depends on
 * another.
 */
import { CSV_BOM } from '../../../shared/http/csv.js';
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
    ['GET', `${BASE}/export?format=csv`],
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
  it('lists the groups, the name descending (Perfex order), with the pager meta', async () => {
    const res = await call('GET', BASE);
    expect(res.statusCode).toBe(200);
    const body = res.json<{ data: Group[]; meta: { total: number; rangeStart: number } }>();
    expect(body.data.map((group) => group.id)).toEqual(['2', '3', '1']);
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
  it('answers 204 and the group is gone, for a group no customer is in', async () => {
    const res = await call('DELETE', `${BASE}/3`);
    expect(res.statusCode).toBe(204);
    expect((await call('GET', `${BASE}/3`)).statusCode).toBe(404);
    expect(ctx.logger.lines).toContainEqual({
      message: 'customer group deleted',
      meta: { id: 3 },
    });
  });

  it('answers 409 ERP-CUSTOMERGROUPS-0001 while a customer is in the group, and deletes nothing', async () => {
    const res = await call('DELETE', `${BASE}/1`);
    expect(res.statusCode).toBe(409);
    expect((await call('GET', `${BASE}/1`)).statusCode).toBe(200);
    expect(ctx.repo.links).toHaveLength(3);
    expect(ctx.logger.lines).not.toContainEqual({
      message: 'customer group deleted',
      meta: { id: 1 },
    });
  });

  it('answers 404 for a missing id and leaves every link alone', async () => {
    const res = await call('DELETE', `${BASE}/99`);
    expect(res.statusCode).toBe(404);
    expect(ctx.repo.links).toHaveLength(3);
  });
});
describe('GET /customer-groups/export', () => {
  it('csv answers id and name, the attachment name, no-store and a BOM, in the list order (-name)', async () => {
    const res = await call('GET', `${BASE}/export?format=csv`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toMatch(
      /^attachment; filename="customer-groups-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.payload.startsWith(`${CSV_BOM}id,name\r\n2,Silver\r\n3,Gold\r\n1,Gold\r\n`)).toBe(
      true,
    );
  });

  it.each([
    ['xlsx', 'spreadsheetml.sheet', 'PK'],
    ['pdf', 'pdf', '%PDF-'],
  ] as const)(
    'format=%s answers its content type and customer-groups-<date>.<ext>',
    async (format, type, magic) => {
      const res = await call('GET', `${BASE}/export?format=${format}`);
      expect(res.statusCode).toBe(200);
      expect(String(res.headers['content-type'])).toContain(type);
      expect(res.headers['content-disposition']).toMatch(
        new RegExp(`^attachment; filename="customer-groups-\\d{4}-\\d{2}-\\d{2}\\.${format}"$`),
      );
      expect(res.rawPayload.subarray(0, magic.length).toString('latin1')).toBe(magic);
    },
  );

  it('format=print answers the two columns as text rows, no attachment, filtered by q', async () => {
    const res = await call('GET', `${BASE}/export?format=print&q=gold`);
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBeUndefined();
    const body = JSON.parse(res.payload) as { headers: string[]; rows: string[][] };
    expect(body.headers).toEqual(['id', 'name']);
    expect(body.rows).toEqual([
      ['3', 'Gold'],
      ['1', 'Gold'],
    ]);
  });

  it('escapes a formula in a name (CSV injection)', async () => {
    await call('POST', BASE, TEST_BEARERS.admin, { name: '=HYPERLINK("http://x","y")' });
    const res = await call('GET', `${BASE}/export?format=csv&q=hyperlink`);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toContain(`"'=HYPERLINK(""http://x"",""y"")"`);
  });

  it('key, limit and cursor are a 400 on their own key (the list has no row selection)', async () => {
    for (const [query, path] of [
      ['key=3', 'key'],
      ['limit=10', 'limit'],
      ['cursor=abc', 'cursor'],
    ] as const) {
      const res = await call('GET', `${BASE}/export?format=csv&${query}`);
      expect(res.statusCode, query).toBe(400);
      const issues = res.json<{ issues: { path: string[] }[] }>().issues;
      expect(issues, query).toEqual([expect.objectContaining({ path: [path] })]);
    }
  });

  it('column=name exports that one column', async () => {
    const res = await call('GET', `${BASE}/export?format=csv&column=name&q=silver`);
    expect(res.payload).toBe(`${CSV_BOM}name\r\nSilver\r\n`);
  });
});
