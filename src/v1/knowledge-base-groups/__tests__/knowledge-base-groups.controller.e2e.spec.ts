import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { API_PREFIX } from '../../../shared/http/api-prefix.js';
import { KNOWLEDGE_BASE_GROUPS_ROUTES } from '../knowledge-base-groups.routes.js';
import {
  createKnowledgeBaseGroupsTestApp,
  TEST_BEARERS,
  type KnowledgeBaseGroupsTestApp,
} from './create-knowledge-base-groups-test-app.js';
import { SEED_KNOWLEDGE_BASE_GROUPS } from './fakes.js';

const BASE = `/${API_PREFIX}/${KNOWLEDGE_BASE_GROUPS_ROUTES.base}`;
const GROUPS = BASE;
const GROUPS_EXPORT = `${BASE}/${KNOWLEDGE_BASE_GROUPS_ROUTES.export}`;
const groupRecord = (id: string | number): string => `${BASE}/${String(id)}`;

function bearer(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

describe('KnowledgeBaseGroupsController E2E', () => {
  let ctx: KnowledgeBaseGroupsTestApp;

  beforeAll(async () => {
    ctx = await createKnowledgeBaseGroupsTestApp();
  });

  beforeEach(() => {
    ctx.repo.seed(SEED_KNOWLEDGE_BASE_GROUPS);
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('unauthenticated requests return 401 ERP-AUTH-0004', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: GROUPS,
    });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.payload)).toMatchObject({ code: 'ERP-AUTH-0004' });
  });

  it('unauthorized members without knowledgeBase.articles.view return 403 ERP-AUTH-0005', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: GROUPS,
      headers: bearer(TEST_BEARERS.noPermission),
    });
    expect(res.statusCode).toBe(403);
    expect(JSON.parse(res.payload)).toMatchObject({ code: 'ERP-AUTH-0005' });
  });

  it('GET /api/v1/knowledge-base-groups returns keyset list, asserts order and all meta fields', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: GROUPS,
      headers: bearer(TEST_BEARERS.viewOnly),
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload) as {
      data: { id: string; name: string; groupOrder: number }[];
      meta: {
        nextCursor: string | null;
        prevCursor: string | null;
        total: number;
        rangeStart: number;
        exportLimit: number;
        printLimit: number;
      };
    };

    // Assert order (sorted by groupOrder ascending: 1, 2, 3)
    expect(body.data.map((g) => g.groupOrder)).toEqual([1, 2, 3]);
    expect(body.data.map((g) => g.name)).toEqual(['General', 'Billing', 'Technical']);

    // Assert all meta fields
    expect(body.meta).toEqual({
      nextCursor: null,
      prevCursor: null,
      total: 3,
      rangeStart: 1,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });

  it('GET /api/v1/knowledge-base-groups/export exports groups for member with view permission', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${GROUPS_EXPORT}?format=csv`,
      headers: bearer(TEST_BEARERS.viewOnly),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });

  it('POST /api/v1/knowledge-base-groups requires create permission (viewOnly gets 403, createOnly gets 201)', async () => {
    const forbidden = await ctx.app.inject({
      method: 'POST',
      url: GROUPS,
      headers: bearer(TEST_BEARERS.viewOnly),
      payload: { name: 'Forbidden' },
    });
    expect(forbidden.statusCode).toBe(403);

    const success = await ctx.app.inject({
      method: 'POST',
      url: GROUPS,
      headers: bearer(TEST_BEARERS.createOnly),
      payload: { name: 'Support', color: '#03a9f4' },
    });
    expect(success.statusCode).toBe(201);
    expect(JSON.parse(success.payload)).toMatchObject({ name: 'Support' });
  });

  it('GET /api/v1/knowledge-base-groups/:id returns group detail or 404', async () => {
    const ok = await ctx.app.inject({
      method: 'GET',
      url: groupRecord(1),
      headers: bearer(TEST_BEARERS.viewOnly),
    });
    expect(ok.statusCode).toBe(200);
    expect(JSON.parse(ok.payload)).toMatchObject({ id: '1' });

    const notFound = await ctx.app.inject({
      method: 'GET',
      url: groupRecord(999),
      headers: bearer(TEST_BEARERS.viewOnly),
    });
    expect(notFound.statusCode).toBe(404);
  });

  it('PATCH /api/v1/knowledge-base-groups/:id requires edit permission (viewOnly gets 403, editOnly gets 200)', async () => {
    const forbidden = await ctx.app.inject({
      method: 'PATCH',
      url: groupRecord(1),
      headers: bearer(TEST_BEARERS.viewOnly),
      payload: { name: 'Renamed' },
    });
    expect(forbidden.statusCode).toBe(403);

    const success = await ctx.app.inject({
      method: 'PATCH',
      url: groupRecord(1),
      headers: bearer(TEST_BEARERS.editOnly),
      payload: { name: 'Renamed Group' },
    });
    expect(success.statusCode).toBe(200);
    expect(JSON.parse(success.payload)).toMatchObject({ name: 'Renamed Group' });
  });

  it('DELETE /api/v1/knowledge-base-groups/:id requires delete permission, refuses delete when group has articles', async () => {
    // viewOnly is refused 403
    const forbidden = await ctx.app.inject({
      method: 'DELETE',
      url: groupRecord(1),
      headers: bearer(TEST_BEARERS.viewOnly),
    });
    expect(forbidden.statusCode).toBe(403);

    // Group 2 has 3 articles -> deleteOnly gets 409 ERP-KNOWLEDGEBASEGROUPS-0001
    const inUse = await ctx.app.inject({
      method: 'DELETE',
      url: groupRecord(2),
      headers: bearer(TEST_BEARERS.deleteOnly),
    });
    expect(inUse.statusCode).toBe(409);
    expect(JSON.parse(inUse.payload)).toMatchObject({ code: 'ERP-KNOWLEDGEBASEGROUPS-0001' });

    // Group 1 has 0 articles -> deleteOnly gets 204
    const success = await ctx.app.inject({
      method: 'DELETE',
      url: groupRecord(1),
      headers: bearer(TEST_BEARERS.deleteOnly),
    });
    expect(success.statusCode).toBe(204);
  });
});
