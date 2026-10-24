import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ExecutionContext } from '@nestjs/common';

import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';

import { LeadStatusesController } from '../controller/lead-statuses.controller.js';
import { LeadStatusesService } from '../service/lead-statuses.service.js';

describe('LeadStatusesController HTTP routes', () => {
  let app: NestFastifyApplication;

  const admin = {
    staffId: 5,
    sessionId: 'test-session',
    jti: 'test-jti',
    isAdmin: true,
    roleId: null,
    tokenVersion: 0,
    expiresAt: 4_102_444_800,
  };

  const status = {
    id: '3',
    name: 'Contacted',
    statusorder: 3,
    color: '#28B8DA',
    isdefault: 0,
    usage: {
      leads: 0,
      emailIntegration: 0,
    },
    isConfiguredDefault: false,
  };

  const service = {
    list: vi.fn(() =>
      Promise.resolve({
        data: [status],
        meta: {
          nextCursor: null,
          prevCursor: null,
          total: 1,
          rangeStart: 1,
          exportLimit: 1000,
          printLimit: 1000,
        },
      }),
    ),

    get: vi.fn(() => Promise.resolve(status)),

    create: vi.fn(() => Promise.resolve(status)),

    update: vi.fn(() => Promise.resolve(status)),

    remove: vi.fn(() => Promise.resolve(undefined)),

    exportCsv: vi.fn(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [LeadStatusesController],
      providers: [
        {
          provide: LeadStatusesService,
          useValue: service,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          const request = context.switchToHttp().getRequest<{
            user: typeof admin;
          }>();

          request.user = admin;
          return true;
        },
      })
      .overrideGuard(PermissionGuard)
      .useValue({
        canActivate: () => true,
      })
      .compile();

    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /lead-statuses returns the list', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/lead-statuses',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ data: (typeof status)[] }>().data).toHaveLength(1);
    expect(service.list).toHaveBeenCalled();
  });

  it('GET /lead-statuses/:id returns one status', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/lead-statuses/3',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<{ name: string }>().name).toBe('Contacted');
    expect(service.get).toHaveBeenCalled();
  });

  it('POST /lead-statuses returns 201', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/lead-statuses',
      payload: {
        name: 'Contacted',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(service.create).toHaveBeenCalled();
  });

  it('PATCH /lead-statuses/:id returns updated status', async () => {
    const response = await app.inject({
      method: 'PATCH',
      url: '/lead-statuses/3',
      payload: {
        name: 'Contacted',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(service.update).toHaveBeenCalled();
  });

  it('DELETE /lead-statuses/:id returns 204', async () => {
    const response = await app.inject({
      method: 'DELETE',
      url: '/lead-statuses/3',
    });

    expect(response.statusCode).toBe(204);
    expect(service.remove).toHaveBeenCalled();
  });
});
