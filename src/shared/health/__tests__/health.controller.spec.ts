import 'reflect-metadata';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_PREFIX, HEALTH_ROUTES } from '../../http/api-prefix.js';
import { HealthModule } from '../health.module.js';
import { HealthService } from '../health.service.js';
import type { HealthReport } from '../health.types.js';

describe('HealthController (Fastify inject, no network)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HealthModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(API_PREFIX, { exclude: [...HEALTH_ROUTES] });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 with an empty ok report', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'ok', checks: {} });
  });

  it('GET /api/v1/health returns 200 with the same body', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.payload)).toEqual({ status: 'ok', checks: {} });
  });

  it('GET /health returns 503 when a registered probe reports error', async () => {
    app.get(HealthService).register({ name: 'fake', run: () => Promise.resolve('error') });
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload) as HealthReport;
    expect(body.status).toBe('degraded');
    expect(body.checks.fake).toBe('error');
  });
});
