import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getRequestContext } from '../../logger/request-context.js';
import { registerRequestId } from '../request-id.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Throwaway handler: answers whatever the request context holds when the handler runs. */
@Controller('probe')
class ProbeController {
  @Get()
  probe(): { requestId: string | undefined; staffId: number | undefined } {
    const ctx = getRequestContext();
    return { requestId: ctx?.requestId, staffId: ctx?.staffId };
  }
}

@Module({ controllers: [ProbeController] })
class ProbeModule {}

interface ProbeBody {
  requestId?: string;
  staffId?: number;
}

describe('registerRequestId (Fastify inject, no network)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [ProbeModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    registerRequestId(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('mints a UUID when no header is sent, echoes it in x-request-id and the handler sees it', async () => {
    const res = await app.inject({ method: 'GET', url: '/probe' });
    expect(res.statusCode).toBe(200);
    const header = res.headers['x-request-id'];
    expect(header).toMatch(UUID);
    const body = JSON.parse(res.payload) as ProbeBody;
    expect(body.requestId).toBe(header);
    expect(body.staffId).toBeUndefined();
  });

  it('echoes a valid client-supplied id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'x-request-id': 'trace-42.a_b' },
    });
    expect(res.headers['x-request-id']).toBe('trace-42.a_b');
    expect((JSON.parse(res.payload) as ProbeBody).requestId).toBe('trace-42.a_b');
  });

  it('replaces an invalid id and never echoes it (T-2-01)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'x-request-id': 'bad id\n' },
    });
    const header = res.headers['x-request-id'];
    expect(header).toMatch(UUID);
    // The rejected input holds a space and a newline, which no UUID can; a bare 'bad' would
    // match the hex digits b, a, d of a minted UUID about once in 140 runs.
    expect(String(header)).not.toContain('bad id');
    expect(res.payload).not.toContain('bad id');
    expect((JSON.parse(res.payload) as ProbeBody).requestId).toBe(header);
  });

  it('replaces an over-long id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/probe',
      headers: { 'x-request-id': 'x'.repeat(65) },
    });
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('gives every request its own id', async () => {
    const [a, b] = await Promise.all([
      app.inject({ method: 'GET', url: '/probe' }),
      app.inject({ method: 'GET', url: '/probe' }),
    ]);
    expect(a.headers['x-request-id']).not.toBe(b.headers['x-request-id']);
    expect((JSON.parse(a.payload) as ProbeBody).requestId).toBe(a.headers['x-request-id']);
    expect((JSON.parse(b.payload) as ProbeBody).requestId).toBe(b.headers['x-request-id']);
  });
});
