import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX } from '../../../shared/http/api-prefix.js';
import { ticketStatusesListResponseSchema } from '../dto/ticket-statuses.dto.js';
import { TICKET_STATUSES_ROUTES } from '../ticket-statuses.routes.js';
import {
  createTicketStatusesTestApp,
  TEST_BEARERS,
  type TicketStatusesTestApp,
} from './create-ticket-statuses-test-app.js';

const LIST = `/${API_PREFIX}/${TICKET_STATUSES_ROUTES.base}`;
const record = (id: string | number): string => `${LIST}/${String(id)}`;

function bearer(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}

describe('TicketStatusesController HTTP contract', () => {
  let ctx: TicketStatusesTestApp;

  beforeAll(async () => {
    ctx = await createTicketStatusesTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('returns 401 without a bearer', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: LIST });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for an authenticated non-administrator', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: LIST,
      headers: bearer(TEST_BEARERS.everyCode),
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 400 for an invalid query key', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${LIST}?foo=bar`,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for an invalid path id', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: record('not-an-id'),
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns 404 for a missing status', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: record(999),
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 409 when deleting the built-in default status', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: record(1),
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(res.statusCode).toBe(409);
  });

  it('returns 409 when deleting a referenced status', async () => {
    ctx.repo.ticketReferences.add(2);
    try {
      const res = await ctx.app.inject({
        method: 'DELETE',
        url: record(2),
        headers: bearer(TEST_BEARERS.admin),
      });
      expect(res.statusCode).toBe(409);
    } finally {
      ctx.repo.ticketReferences.delete(2);
    }
  });

  it('returns 409 when deleting the configured default reply status', async () => {
    ctx.setDefaultReplyStatus('2');
    try {
      const res = await ctx.app.inject({
        method: 'DELETE',
        url: record(2),
        headers: bearer(TEST_BEARERS.admin),
      });
      expect(res.statusCode).toBe(409);
    } finally {
      ctx.setDefaultReplyStatus(null);
    }
  });

  it('returns 400 for an invalid create body', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: LIST,
      headers: bearer(TEST_BEARERS.admin),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('serves the list for an administrator', async () => {
    const res = await ctx.app.inject({
      method: 'GET',
      url: `${LIST}?limit=50`,
      headers: bearer(TEST_BEARERS.admin),
    });
    expect(res.statusCode).toBe(200);
    const response = ticketStatusesListResponseSchema.parse(JSON.parse(res.payload));
    expect(response).toMatchObject({
      data: [
        { ticketstatusid: '3', ticket_count: 0 },
        { ticketstatusid: '2', ticket_count: 0 },
        { ticketstatusid: '1', ticket_count: 0 },
      ],
      meta: {
        nextCursor: null,
        prevCursor: null,
        total: 3,
        rangeStart: 1,
      },
    });
    expect(response.meta.exportLimit).toBeGreaterThan(0);
    expect(response.meta.printLimit).toBeGreaterThan(0);
  });
});
