/**
 * The two Redis connections of `shared/queue/` (BE-14), both on `QUEUE_REDIS_DB` (db 2): never
 * the cache's database nor auth's (ADR-0005, T-4.2-33). BullMQ opens and closes the clients from
 * these options; `null` when `REDIS_URL` is unset (the unit suite), so nothing connects.
 *
 * The producer (the api enqueuing) fails fast like every other client (`TIMINGS.redis`, no
 * offline queue). The worker connection must have `maxRetriesPerRequest: null` and keeps the
 * offline queue, BullMQ's own requirement for its blocking reads (04.2-RESEARCH Pitfall 4).
 */
import type { RedisOptions } from 'bullmq';
import type { Env } from '../config/env.schema.js';
import { TIMINGS } from '../config/timings.js';

type QueueEnv = Pick<Env, 'REDIS_URL' | 'QUEUE_REDIS_DB'>;

/** REDIS_URL with its database path set to `db`: ioredis lets the URL's path win over a `db` option. */
export function queueRedisUrl(redisUrl: string, db: number): string {
  const url = new URL(redisUrl);
  url.pathname = `/${String(db)}`;
  return url.toString();
}

/** The api's (enqueueing) connection options. */
export function producerConnection(env: QueueEnv): RedisOptions | null {
  if (env.REDIS_URL === undefined) return null;
  return {
    url: queueRedisUrl(env.REDIS_URL, env.QUEUE_REDIS_DB),
    db: env.QUEUE_REDIS_DB,
    lazyConnect: true,
    maxRetriesPerRequest: TIMINGS.redis.maxRetriesPerRequest,
    enableOfflineQueue: false,
    connectTimeout: TIMINGS.redis.connectTimeoutMs,
  };
}

/** The worker's connection options (blocking reads: `maxRetriesPerRequest: null`, Pitfall 4). */
export function workerConnection(env: QueueEnv): RedisOptions | null {
  if (env.REDIS_URL === undefined) return null;
  return {
    url: queueRedisUrl(env.REDIS_URL, env.QUEUE_REDIS_DB),
    db: env.QUEUE_REDIS_DB,
    maxRetriesPerRequest: null,
    connectTimeout: TIMINGS.redis.connectTimeoutMs,
  };
}
