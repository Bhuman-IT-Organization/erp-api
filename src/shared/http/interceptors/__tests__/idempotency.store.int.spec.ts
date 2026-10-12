/**
 * `RedisIdempotencyStore` against the local Redis (REDIS_URL from
 * ../erp-infra/env/local/api.host.env), on the cache database 0 (BE-15). Uses a staff id no real
 * row has and a random key; deletes the one key it created by exact name in afterAll, never a FLUSH.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { RedisService } from '../../../cache/redis.service.js';
import { AppConfig } from '../../../config/app-config.js';
import { HealthService } from '../../../health/health.service.js';
import { RedisIdempotencyStore, idempotencyRedisKey } from '../idempotency.store.js';

const STAFF = 999_998;
const TTL = 60_000;

describe.skipIf(!process.env.REDIS_URL)('RedisIdempotencyStore against the local Redis', () => {
  const redis = new RedisService(new AppConfig(), new HealthService());
  const store = new RedisIdempotencyStore(redis);
  const key = idempotencyRedisKey(STAFF, randomUUID());

  afterAll(async () => {
    try {
      await redis.client?.del(key);
    } finally {
      await redis.onModuleDestroy();
    }
  });

  it('names the key idem:<staff>:<key>', () => {
    expect(key.startsWith(`idem:${String(STAFF)}:`)).toBe(true);
  });

  it('claims once: true, then false', async () => {
    await expect(store.claim(key, 'fp', TTL)).resolves.toBe(true);
    await expect(store.claim(key, 'fp', TTL)).resolves.toBe(false);
    await expect(store.read(key)).resolves.toEqual({ state: 'in-progress', fingerprint: 'fp' });
    const pttl = await redis.client?.pttl(key);
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(TTL);
  });

  it('completes, then reads the done record with a TTL at most the one set', async () => {
    const done = { state: 'done', fingerprint: 'fp', status: 201, body: { id: 1 } } as const;
    await store.complete(key, done, TTL);
    await expect(store.read(key)).resolves.toEqual(done);
    const pttl = await redis.client?.pttl(key);
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(TTL);
  });

  it('releases: the key is gone', async () => {
    await store.release(key);
    await expect(store.read(key)).resolves.toBeNull();
    await expect(redis.client?.exists(key)).resolves.toBe(0);
  });
});
