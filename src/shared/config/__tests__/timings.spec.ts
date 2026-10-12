import { describe, expect, it } from 'vitest';
import { isTransientError } from '../../resilience/transient-error.js';
import { POOL } from '../pool.js';
import { RETRY_POLICIES } from '../retry-policies.js';
import { TIMINGS } from '../timings.js';

function leaves(value: unknown, path = 'TIMINGS'): [string, unknown][] {
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([k, v]) => leaves(v, `${path}.${k}`));
  }
  return [[path, value]];
}

describe('TIMINGS', () => {
  it('is frozen at the root and in every group', () => {
    for (const group of [
      TIMINGS,
      TIMINGS.auth,
      TIMINGS.breaker,
      TIMINGS.db,
      TIMINGS.redis,
      TIMINGS.http,
      TIMINGS.http.legacy,
      TIMINGS.http.vendor,
      TIMINGS.fastify,
      TIMINGS.uploads,
      TIMINGS.idempotency,
      TIMINGS.queue,
      TIMINGS.mail,
      TIMINGS.mail.smtp,
    ]) {
      expect(Object.isFrozen(group)).toBe(true);
    }
  });

  it('holds only positive integers', () => {
    for (const [path, value] of leaves(TIMINGS)) {
      expect(Number.isInteger(value), path).toBe(true);
      expect(value as number, path).toBeGreaterThan(0);
    }
  });

  it('keeps the auth and breaker values in their documented ranges', () => {
    expect(TIMINGS.auth.accessTokenTtlMs).toBe(900_000);
    expect(TIMINGS.auth.lockoutMaxMs).toBeGreaterThanOrEqual(TIMINGS.auth.lockoutBaseMs);
    expect(TIMINGS.breaker.errorThresholdPercentage).toBeGreaterThanOrEqual(1);
    expect(TIMINGS.breaker.errorThresholdPercentage).toBeLessThanOrEqual(100);
  });

  it('keeps the upload expiry at 24 h with an hourly cleanup (ADR-0041)', () => {
    expect(TIMINGS.uploads.incompleteExpiryMs).toBe(86_400_000);
    expect(TIMINGS.uploads.cleanupEveryMs).toBe(3_600_000);
    expect(TIMINGS.uploads.cleanupEveryMs).toBeLessThan(TIMINGS.uploads.incompleteExpiryMs);
  });

  it('keeps the idempotency windows: 2 min in progress, 24 h replay (BE-15)', () => {
    expect(TIMINGS.idempotency.inProgressTtlMs).toBe(120_000);
    expect(TIMINGS.idempotency.replayTtlMs).toBe(86_400_000);
    // A keyed handler must finish inside the in-progress window, and a request inside the Fastify budget.
    expect(TIMINGS.idempotency.inProgressTtlMs).toBeGreaterThan(TIMINGS.fastify.requestTimeoutMs);
    expect(TIMINGS.idempotency.replayTtlMs).toBeGreaterThan(TIMINGS.idempotency.inProgressTtlMs);
  });

  it('keeps a completed job one day, a failed one seven days, and 10 s to close (BE-14, T-4.2-18)', () => {
    expect(TIMINGS.queue.keepCompletedS).toBe(86_400);
    expect(TIMINGS.queue.keepFailedS).toBe(604_800);
    expect(TIMINGS.queue.closeTimeoutMs).toBe(10_000);
  });

  it('keeps the Fastify keep-alive above the Nginx upstream keepalive_timeout (60 s)', () => {
    expect(TIMINGS.fastify.keepAliveTimeoutMs).toBeGreaterThan(60_000);
    expect(TIMINGS.fastify.connectionTimeoutMs).toBeGreaterThan(TIMINGS.fastify.keepAliveTimeoutMs);
  });

  it('keeps the mail timings: SMTP 10/10/30/5 s, a 5 min sweep, 12 months of log, 5 tests a window (ADR-0049)', () => {
    expect(TIMINGS.mail.smtp).toEqual({
      connectionTimeoutMs: 10_000,
      greetingTimeoutMs: 10_000,
      socketTimeoutMs: 30_000,
      dnsTimeoutMs: 5_000,
    });
    expect(TIMINGS.mail.sweepEveryMs).toBe(300_000);
    expect(TIMINGS.mail.sweepAfterMs).toBe(300_000);
    expect(TIMINGS.mail.serverStateTtlMs).toBe(86_400_000);
    expect(TIMINGS.mail.purgeEveryMs).toBe(86_400_000);
    expect(TIMINGS.mail.purgeBatchSize).toBe(1_000);
    expect(TIMINGS.mail.logRetentionMonths).toBe(12);
    expect(TIMINGS.mail.testWindowMs).toBe(600_000);
    expect(TIMINGS.mail.testMaxPerWindow).toBe(5);
    expect(TIMINGS.mail.serverReplyMaxChars).toBe(1_000);
  });
});

describe('RETRY_POLICIES.mailSend and POOL.smtp (ADR-0049)', () => {
  it('retries a send 8 times from 30 s up to a 30 min cap, on transient errors only', () => {
    expect(RETRY_POLICIES.mailSend.attempts).toBe(8);
    expect(RETRY_POLICIES.mailSend.baseDelayMs).toBe(30_000);
    expect(RETRY_POLICIES.mailSend.maxDelayMs).toBe(1_800_000);
    expect(RETRY_POLICIES.mailSend.retryOn).toBe(isTransientError);
    expect(Object.isFrozen(RETRY_POLICIES.mailSend)).toBe(true);
  });

  it('pools two SMTP connections of 100 messages each per worker replica', () => {
    expect(POOL.smtp).toEqual({ maxConnections: 2, maxMessages: 100 });
    expect(Object.isFrozen(POOL.smtp)).toBe(true);
  });
});
