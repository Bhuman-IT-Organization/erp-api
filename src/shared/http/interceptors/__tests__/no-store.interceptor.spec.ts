/**
 * ADR-0051 decision 8 on a probe controller inside a real Nest + Fastify app: the interceptor is
 * production code, so a handler that answers and a handler that throws both carry
 * `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`, and a route without it carries
 * neither.
 */
import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../../errors/app-error.js';
import { ProblemDetailsFilter } from '../../../errors/problem-details.filter.js';
import { LoggerService } from '../../../logger/logger.service.js';
import { NoStoreInterceptor } from '../no-store.interceptor.js';

const OK = 200;
const NOT_FOUND = 404;
const INTERNAL = 500;

@Controller('probe')
@UseInterceptors(NoStoreInterceptor)
class ProbeController {
  @Get('ok')
  ok(): { ok: true } {
    return { ok: true };
  }

  @Get('missing')
  missing(): never {
    throw new AppError('ERP-CORE-0004');
  }

  @Get('broken')
  broken(): never {
    throw new Error('probe failure');
  }
}

@Controller('plain')
class PlainController {
  @Get()
  plain(): { ok: true } {
    return { ok: true };
  }
}

class SilentLogger extends LoggerService {
  override error(): void {
    /* silent */
  }
}

describe('NoStoreInterceptor (ADR-0051 decision 8)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ProbeController, PlainController],
    }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.useGlobalFilters(new ProblemDetailsFilter(new SilentLogger()));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each([
    ['/probe/ok', OK],
    ['/probe/missing', NOT_FOUND],
    ['/probe/broken', INTERNAL],
  ])('%s answers %i with no-store and noindex', async (url, status) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(status);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });

  it('a route without the interceptor carries neither header', async () => {
    const res = await app.inject({ method: 'GET', url: '/plain' });
    expect(res.statusCode).toBe(OK);
    expect(res.headers['cache-control']).toBeUndefined();
    expect(res.headers['x-robots-tag']).toBeUndefined();
  });
});
