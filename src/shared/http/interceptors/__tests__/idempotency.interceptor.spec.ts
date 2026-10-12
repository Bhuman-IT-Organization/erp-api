/**
 * BE-15 Layer 1 on a probe route inside a real Nest + Fastify app: the interceptor, the decorator
 * and the global module are production code; the store is the in-memory one (or a rejecting fake),
 * and the verifier is a stub with two bearers, so the keys-per-staff case runs without Redis.
 */
import { Body, Controller, Global, HttpCode, Module, Post, UseGuards } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { LightMyRequestResponse } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppError } from '../../../errors/app-error.js';
import { ProblemDetailsFilter } from '../../../errors/problem-details.filter.js';
import { LoggerService } from '../../../logger/logger.service.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
  type AuthenticatedUser,
} from '../../auth/access-token-verifier.js';
import { JwtAuthGuard } from '../../guards/jwt-auth.guard.js';
import { IdempotencyModule } from '../idempotency.module.js';
import {
  IDEMPOTENCY_STORE,
  InMemoryIdempotencyStore,
  type IdempotencyStore,
} from '../idempotency.store.js';
import { Idempotent } from '../idempotent.decorator.js';

const BEARERS: Readonly<Record<string, number>> = { 'staff-7': 7, 'staff-8': 8 };
const KEY = 'probe-key-0123456789';
const CREATED = 201;

function userOf(staffId: number): AuthenticatedUser {
  return {
    staffId,
    sessionId: `sid-${String(staffId)}`,
    jti: `jti-${String(staffId)}`,
    isAdmin: false,
    roleId: null,
    tokenVersion: 0,
    expiresAt: 4_102_444_800,
  };
}

class StubVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    const staffId = BEARERS[token];
    return Promise.resolve(staffId === undefined ? null : userOf(staffId));
  }

  hasPermission(): Promise<boolean> {
    return Promise.resolve(true);
  }
}

@Global()
@Module({
  providers: [{ provide: ACCESS_TOKEN_VERIFIER, useValue: new StubVerifier() }],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class StubVerifierModule {}

/** Counts the handler runs; `hold` keeps a run open until the spec releases it. */
const probe = {
  calls: 0,
  hold: undefined as Promise<void> | undefined,
};

@Controller('probe')
class ProbeController {
  @Post()
  @HttpCode(CREATED)
  @UseGuards(JwtAuthGuard)
  @Idempotent()
  async create(@Body() body: { n?: number; fail?: boolean }): Promise<{ run: number; n: number }> {
    probe.calls += 1;
    const run = probe.calls;
    await probe.hold;
    if (body.fail === true) throw new AppError('ERP-VALIDATION-0001', 'probe refused');
    return { run, n: body.n ?? 0 };
  }
}

class SilentLogger extends LoggerService {
  override error(): void {
    /* silent */
  }
}

/** Every store method rejects: Redis unreachable. */
const rejectingStore: IdempotencyStore = {
  claim: () => Promise.reject(new Error('down')),
  read: () => Promise.reject(new Error('down')),
  complete: () => Promise.reject(new Error('down')),
  release: () => Promise.reject(new Error('down')),
};

async function createApp(store: IdempotencyStore): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [StubVerifierModule, IdempotencyModule],
    controllers: [ProbeController],
  })
    .overrideProvider(IDEMPOTENCY_STORE)
    .useValue(store)
    .compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  app.useGlobalFilters(new ProblemDetailsFilter(new SilentLogger()));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

function post(
  app: NestFastifyApplication,
  payload: object,
  headers: Record<string, string> = { 'idempotency-key': KEY },
  bearer = 'staff-7',
): Promise<LightMyRequestResponse> {
  return app.inject({
    method: 'POST',
    url: '/probe',
    headers: { authorization: `Bearer ${bearer}`, ...headers },
    payload,
  });
}

const codeOf = (res: LightMyRequestResponse): unknown =>
  (JSON.parse(res.payload) as { code?: unknown }).code;

/** Resolves once the probe handler has started `count` runs. */
async function untilCalls(count: number): Promise<void> {
  while (probe.calls < count) await new Promise((resolve) => setImmediate(resolve));
}

describe('@Idempotent() (BE-15 Layer 1)', () => {
  let app: NestFastifyApplication;

  beforeEach(async () => {
    probe.calls = 0;
    probe.hold = undefined;
    app = await createApp(new InMemoryIdempotencyStore());
  });

  afterEach(async () => {
    await app.close();
  });

  it('refuses a request without the key with 400 ERP-CORE-0010', async () => {
    const res = await post(app, { n: 1 }, {});
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('ERP-CORE-0010');
    expect(probe.calls).toBe(0);
  });

  it('refuses a malformed key with 400 ERP-CORE-0010', async () => {
    const res = await post(app, { n: 1 }, { 'idempotency-key': 'short' });
    expect(res.statusCode).toBe(400);
    expect(codeOf(res)).toBe('ERP-CORE-0010');
    expect(probe.calls).toBe(0);
  });

  it('runs one of two concurrent identical requests and answers the other 409 ERP-CORE-0011', async () => {
    let release = (): void => undefined;
    probe.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = post(app, { n: 1 });
    await untilCalls(1);
    const second = await post(app, { n: 1 });
    release();
    const done = await first;
    expect(done.statusCode).toBe(CREATED);
    expect(done.headers['idempotent-replayed']).toBe('false');
    expect(second.statusCode).toBe(409);
    expect(codeOf(second)).toBe('ERP-CORE-0011');
    expect(probe.calls).toBe(1);
  });

  it('replays the stored status and body with Idempotent-Replayed: true after completion', async () => {
    const first = await post(app, { n: 2 });
    const again = await post(app, { n: 2 });
    expect(first.statusCode).toBe(CREATED);
    expect(again.statusCode).toBe(CREATED);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect(JSON.parse(again.payload)).toEqual(JSON.parse(first.payload));
    expect(probe.calls).toBe(1);
  });

  it('refuses the same key with a different body with 422 ERP-CORE-0012', async () => {
    await post(app, { n: 3 });
    const res = await post(app, { n: 4 });
    expect(res.statusCode).toBe(422);
    expect(codeOf(res)).toBe('ERP-CORE-0012');
    expect(probe.calls).toBe(1);
  });

  it('keeps keys per staff member: two staff with one key both run', async () => {
    const seven = await post(app, { n: 5 });
    const eight = await post(app, { n: 5 }, { 'idempotency-key': KEY }, 'staff-8');
    expect(seven.statusCode).toBe(CREATED);
    expect(eight.statusCode).toBe(CREATED);
    expect(eight.headers['idempotent-replayed']).toBe('false');
    expect(probe.calls).toBe(2);
  });

  it('releases the key when the handler throws, so a retry runs', async () => {
    const first = await post(app, { fail: true });
    const retry = await post(app, { fail: true });
    expect(first.statusCode).toBe(400);
    expect(retry.statusCode).toBe(400);
    expect(codeOf(retry)).toBe('ERP-VALIDATION-0001');
    expect(probe.calls).toBe(2);
  });
});

describe('@Idempotent() with an unreachable store', () => {
  it('answers 503 ERP-UPSTREAM-0001 and never runs the handler', async () => {
    probe.calls = 0;
    probe.hold = undefined;
    const app = await createApp(rejectingStore);
    try {
      const res = await post(app, { n: 1 });
      expect(res.statusCode).toBe(503);
      expect(codeOf(res)).toBe('ERP-UPSTREAM-0001');
      expect(probe.calls).toBe(0);
    } finally {
      await app.close();
    }
  });
});
