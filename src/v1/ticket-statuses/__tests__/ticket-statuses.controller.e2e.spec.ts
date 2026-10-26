import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { API_PREFIX } from '../../../shared/http/api-prefix.js';
import { TicketStatusesController } from '../controller/ticket-statuses.controller.js';
import { TICKET_STATUSES_ROUTES } from '../ticket-statuses.routes.js';
import { TicketStatusesService } from '../service/ticket-statuses.service.js';

const ADMIN: AuthenticatedUser = {
  staffId: 1,
  sessionId: 'sid',
  jti: 'jti',
  isAdmin: true,
  roleId: null,
  tokenVersion: 0,
  expiresAt: 4_102_444_800,
};
const STATUS = {
  ticketstatusid: '2',
  name: 'Open',
  isdefault: 0,
  statuscolor: '#03a9f4',
  statusorder: 1,
};

describe('TicketStatusesController HTTP contract', () => {
  let app: NestFastifyApplication;
  const service = {
    list: vi.fn().mockResolvedValue({ data: [STATUS] }),
    exportCsv: vi.fn().mockResolvedValue({
      filename: 'ticket-statuses-2026-10-26.csv',
      contentType: 'text/csv; charset=utf-8',
      body: 'id,name\r\n11,Open\r\n',
    }),
    get: vi.fn().mockResolvedValue(STATUS),
    create: vi.fn().mockResolvedValue(STATUS),
    update: vi.fn().mockResolvedValue(STATUS),
    remove: vi.fn().mockResolvedValue(undefined),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TicketStatusesController],
      providers: [{ provide: TicketStatusesService, useValue: service }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate(context: ExecutionContext): boolean {
          context.switchToHttp().getRequest<{ user: AuthenticatedUser }>().user = ADMIN;
          return true;
        },
      })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(API_PREFIX);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => app.close());

  const base = `/${API_PREFIX}/${TICKET_STATUSES_ROUTES.base}`;

  it('serves list, export, get, create, update and delete on the declared paths and statuses', async () => {
    const list = await app.inject({ method: 'GET', url: base });
    expect(list.statusCode).toBe(200);
    expect(JSON.parse(list.payload)).toEqual({ data: [STATUS] });

    const exported = await app.inject({ method: 'GET', url: `${base}/export?format=csv` });
    expect(exported.statusCode).toBe(200);
    expect(exported.payload).toBe('id,name\r\n11,Open\r\n');
    expect(exported.headers['content-disposition']).toContain('ticket-statuses-2026-10-26.csv');

    expect((await app.inject({ method: 'GET', url: `${base}/2` })).statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: base,
          payload: { name: 'Open' },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `${base}/2`,
          payload: { statusorder: 2 },
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ method: 'DELETE', url: `${base}/2` })).statusCode).toBe(204);

    expect(service.list).toHaveBeenCalledWith(ADMIN, {});
    expect(service.exportCsv).toHaveBeenCalledWith(ADMIN, { format: 'csv' });
    expect(service.get).toHaveBeenCalledWith(ADMIN, { id: '2' });
    expect(service.create).toHaveBeenCalledWith(ADMIN, { name: 'Open' });
    expect(service.update).toHaveBeenCalledWith(ADMIN, { id: '2' }, { statusorder: 2 });
    expect(service.remove).toHaveBeenCalledWith(ADMIN, { id: '2' });
  });
});
