/**
 * `RedisMailStateStore` against the local Redis (REDIS_URL from ../erp-infra/env/local/api.host.env),
 * on the cache database 0. The contract runs with a 200 ms test window (the store's `testWindowMs`
 * field, set by this spec only) and a real wait. Deletes the two keys it writes by exact name
 * before each case and after the run, never a FLUSH.
 */
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisService } from '../../../shared/cache/redis.service.js';
import { AppConfig } from '../../../shared/config/app-config.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { mailKeys } from '../repository/mail-state.store.js';
import { RedisMailStateStore } from '../repository/redis-mail-state.store.js';
import { mailStateStoreContract } from './fakes.js';

const WINDOW_MS = 200;

describe.skipIf(!process.env.REDIS_URL)('RedisMailStateStore against the local Redis', () => {
  const redis = new RedisService(new AppConfig(), new HealthService());
  const store = new RedisMailStateStore(redis);
  store.testWindowMs = WINDOW_MS;
  const keys = [mailKeys.serverUnreachableSince(), mailKeys.testCount(7)];

  beforeEach(async () => {
    await store.clearServerUnreachable();
    await redis.client?.del(keys);
  });

  afterAll(async () => {
    try {
      await redis.client?.del(keys);
    } finally {
      await redis.onModuleDestroy();
    }
  });

  mailStateStoreContract(() => ({
    store,
    testWindowMs: WINDOW_MS,
    elapse: (ms) => sleep(ms),
    has: async (key) => (await redis.client?.exists(key)) === 1,
  }));

  it('writes the server flag on db 0 with a TTL of at most TIMINGS.mail.serverStateTtlMs', async () => {
    const info = String(await redis.client?.call('CLIENT', 'INFO'));
    expect(info.split(' ')).toContain('db=0');
    await store.markServerUnreachable(new Date());
    const pttl = (await redis.client?.pttl(mailKeys.serverUnreachableSince())) ?? -1;
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(TIMINGS.mail.serverStateTtlMs);
  });

  it('refuses when REDIS_URL is not set', async () => {
    const offline = new RedisMailStateStore({ client: null } as unknown as RedisService);
    await expect(offline.serverUnreachableSince()).rejects.toThrow(
      'mail state: REDIS_URL is not set',
    );
  });
});
