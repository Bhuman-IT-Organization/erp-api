/**
 * An unknown route answers the standard ERP-CORE-0004 problem body and never echoes the request
 * path or method (finding from plan 04.7-10: a shipment hash in a mistyped public URL came back in
 * Nest's default `Cannot GET /...` detail). A known route's 404 keeps its own body.
 */
import { Controller, Get, NotFoundException } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoggerService } from '../../logger/logger.service.js';
import { AppError } from '../app-error.js';
import { ProblemDetailsFilter } from '../problem-details.filter.js';

const NOT_FOUND = 404;
const TOKEN = '0123456789abcdef0123456789abcdef';

@Controller('probe')
class ProbeController {
  @Get('missing')
  missing(): never {
    throw new AppError('ERP-CORE-0004', 'Shipment not found');
  }

  @Get('nest-missing')
  nestMissing(): never {
    throw new NotFoundException('Item not found');
  }
}

describe('unknown route 404 (plan 04.7-10 finding)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new ProblemDetailsFilter(new LoggerService()));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['GET', 'POST'] as const)(
    'answers %s on an unknown path with ERP-CORE-0004 and no path or token',
    async (method) => {
      const url = `/api/v1/public/shipments/${TOKEN}/nope?h=${TOKEN}`;
      const res = await app.inject({ method, url });
      expect(res.statusCode).toBe(NOT_FOUND);
      expect(res.headers['content-type']).toContain('application/problem+json');
      expect(res.json()).toEqual({
        type: 'about:blank',
        status: NOT_FOUND,
        title: 'Resource not found',
        detail: 'Resource not found',
        code: 'ERP-CORE-0004',
      });
      expect(res.body).not.toContain(TOKEN);
      expect(res.body).not.toContain('/api/v1');
      expect(res.body).not.toContain(method);
    },
  );

  it('keeps a known route AppError 404 unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/probe/missing' });
    expect(res.statusCode).toBe(NOT_FOUND);
    expect(res.json()).toEqual({
      type: 'about:blank',
      status: NOT_FOUND,
      title: 'Resource not found',
      detail: 'Shipment not found',
      code: 'ERP-CORE-0004',
    });
  });

  it('keeps a known route NotFoundException 404 unchanged', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/probe/nest-missing' });
    expect(res.statusCode).toBe(NOT_FOUND);
    expect(res.json()).toEqual({
      type: 'about:blank',
      status: NOT_FOUND,
      title: 'Item not found',
      detail: 'Item not found',
      code: 'ERP-HTTP-404',
    });
  });
});
