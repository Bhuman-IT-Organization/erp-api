import type { ExecutionContext } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { EstimateRequestStatusesController } from '../controller/estimate-request-statuses.controller.js';
import { EstimateRequestStatusesService } from '../service/estimate-request-statuses.service.js';

const ADMIN: AuthenticatedUser = {
  staffId: 1,
  sessionId: 'admin-session',
  jti: 'admin-jti',
  isAdmin: true,
  roleId: null,
  tokenVersion: 0,
  expiresAt: 4_102_444_800,
};

describe('EstimateRequestStatusesController HTTP routes', () => {
  let app: NestFastifyApplication | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('serves the prefixed list and create endpoints through the real controller', async () => {
    const response = {
      id: '5',
      name: 'Ready',
      color: '#757575',
      statusorder: null,
      flag: null,
      total_request: 0,
    };
    const service = {
      list: vi.fn().mockResolvedValue({
        data: [response],
        meta: {
          nextCursor: null,
          prevCursor: null,
          total: 1,
          rangeStart: 1,
          exportLimit: 10000,
          printLimit: 1000,
        },
      }),
      create: vi.fn().mockResolvedValue(response),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [EstimateRequestStatusesController],
      providers: [{ provide: EstimateRequestStatusesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext) {
          context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user = ADMIN;
          return true;
        },
      })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(API_PREFIX, { exclude: [...UNPREFIXED_ROUTES] });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const list = await app.inject({ method: 'GET', url: '/api/v1/estimate-request-statuses' });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({ data: [response] });
    expect(service.list).toHaveBeenCalledWith(ADMIN, {});

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/estimate-request-statuses',
      payload: { name: 'Ready', color: '', statusorder: null },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual(response);
    expect(service.create).toHaveBeenCalledWith(ADMIN, {
      name: 'Ready',
      color: '',
      statusorder: null,
    });
  });
});
