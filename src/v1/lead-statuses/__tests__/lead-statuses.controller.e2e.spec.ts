import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createLeadStatusesTestApp,
  TEST_BEARERS,
  type LeadStatusesTestApp,
} from '../__tests__/create-lead-statuses-test-app.js';
import { LEAD_STATUSES_ROUTES } from '../lead-statuses.routes.js';
import { API_PREFIX } from '../../../shared/http/api-prefix.js';

interface ProtectedRequest {
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly url: string;
  readonly payload?: Record<string, string>;
}

function joinRoute(...parts: string[]): string {
  const path = parts
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/');

  return `/${path}`;
}

const apiRoute = (...parts: string[]): string =>
  joinRoute(API_PREFIX, LEAD_STATUSES_ROUTES.base, ...parts);

const listUrl = apiRoute(LEAD_STATUSES_ROUTES.list);
const exportUrl = apiRoute(LEAD_STATUSES_ROUTES.export);
const recordUrl = (id: string): string => apiRoute(LEAD_STATUSES_ROUTES.record.replace(':id', id));

const protectedRequests: readonly ProtectedRequest[] = [
  { method: 'GET', url: listUrl },
  { method: 'GET', url: exportUrl },
  { method: 'GET', url: recordUrl('3') },
  {
    method: 'POST',
    url: listUrl,
    payload: { name: 'Authentication Test Status' },
  },
  {
    method: 'PATCH',
    url: recordUrl('3'),
    payload: { name: 'Authentication Test Status' },
  },
  { method: 'DELETE', url: recordUrl('3') },
];

describe('Lead Statuses controller HTTP routes', () => {
  let testApp: LeadStatusesTestApp;

  beforeAll(async () => {
    testApp = await createLeadStatusesTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  describe('authentication and authorization', () => {
    for (const request of protectedRequests) {
      it(`${request.method} ${request.url} returns 401 without a token`, async () => {
        const response = await testApp.app.inject({
          method: request.method,
          url: request.url,
          ...(request.payload ? { payload: request.payload } : {}),
        });

        expect(response.statusCode).toBe(401);
      });

      it(`${request.method} ${request.url} rejects a non-admin user`, async () => {
        const response = await testApp.app.inject({
          method: request.method,
          url: request.url,
          headers: {
            authorization: `Bearer ${TEST_BEARERS.everyCode}`,
          },
          ...(request.payload ? { payload: request.payload } : {}),
        });

        expect(response.statusCode).toBe(403);
      });
    }
  });

  describe('administrator requests', () => {
    const adminHeaders = {
      authorization: `Bearer ${TEST_BEARERS.admin}`,
    };

    let createdId: string;

    it('GET list returns lead statuses', async () => {
      const response = await testApp.app.inject({
        method: 'GET',
        url: listUrl,
        headers: adminHeaders,
      });

      expect(response.statusCode).toBe(200);

      const body = response.json<{
        data: { id: string; name: string }[];
      }>();

      expect(body.data.length).toBeGreaterThan(0);
      expect(body.data.some((item) => item.name === 'Customer')).toBe(true);
    });

    it('GET record returns a status by ID', async () => {
      const response = await testApp.app.inject({
        method: 'GET',
        url: recordUrl('3'),
        headers: adminHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ name: string }>().name).toBe('Qualified');
    });

    it('GET export returns a successful response', async () => {
      const response = await testApp.app.inject({
        method: 'GET',
        url: exportUrl,
        headers: adminHeaders,
      });

      expect(response.statusCode).toBe(200);
    });

    it('POST creates a lead status', async () => {
      const response = await testApp.app.inject({
        method: 'POST',
        url: listUrl,
        headers: adminHeaders,
        payload: {
          name: 'E2E Created Status',
        },
      });

      expect(response.statusCode).toBe(201);

      const body = response.json<{ id: string; name: string }>();
      expect(body.name).toBe('E2E Created Status');
      expect(body.id).toBeTruthy();

      createdId = body.id;
    });

    it('PATCH updates the created status', async () => {
      expect(createdId).toBeTruthy();

      const response = await testApp.app.inject({
        method: 'PATCH',
        url: recordUrl(createdId),
        headers: adminHeaders,
        payload: {
          name: 'E2E Updated Status',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ name: string }>().name).toBe('E2E Updated Status');
    });

    it('DELETE removes the created status', async () => {
      expect(createdId).toBeTruthy();

      const response = await testApp.app.inject({
        method: 'DELETE',
        url: recordUrl(createdId),
        headers: adminHeaders,
      });

      expect(response.statusCode).toBe(204);
    });
  });
});
