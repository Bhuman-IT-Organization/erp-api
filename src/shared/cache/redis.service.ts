/**
 * The one Redis client the application exposes, plus the `redis` health probe.
 *
 * L2 cache and BullMQ arrive in 1.3+; this is the
 * cache client (`/0`) and the connectivity probe. The auth session store opens its own client on
 * `AUTH_REDIS_DB` with the same TIMINGS.redis options (ADR-0005: one client per purpose). The
 * client is created only when `REDIS_URL` is set, which the env schema allows for NODE_ENV=test
 * alone, so unit tests see no client and no probe.
 */
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfig } from '../config/app-config.js';
import { HealthService } from '../health/health.service.js';
import { TIMINGS } from '../config/timings.js';
import type { HealthCheckResult } from '../health/health.types.js';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  /** `null` when REDIS_URL is unset. */
  readonly client: Redis | null;

  constructor(
    config: AppConfig,
    private readonly health: HealthService,
  ) {
    const url = config.env.REDIS_URL;
    this.client =
      url === undefined
        ? null
        : new Redis(url, {
            // A down Redis must answer `error` in seconds, not hang /health (threat T-1.2-32).
            // connectTimeout bounds the TCP handshake; commandTimeout bounds a socket that
            // connected and then went silent (review WR-03). Both sit under the probe budget
            // (values from TIMINGS.redis, ADR-0031 §4: maxRetriesPerRequest + enableOfflineQueue
            // false so a dead Redis fails fast instead of buffering commands forever).
            lazyConnect: true,
            maxRetriesPerRequest: TIMINGS.redis.maxRetriesPerRequest,
            enableOfflineQueue: false,
            connectTimeout: TIMINGS.redis.connectTimeoutMs,
            commandTimeout: TIMINGS.redis.commandTimeoutMs,
          });
    // Without a listener ioredis logs "Unhandled error event" on every failed connect;
    // the failure is already surfaced as 'error' by ping().
    this.client?.on('error', () => undefined);
  }

  /** 'ok' when Redis answers PONG; 'error' on any failure or when no client exists. */
  async ping(): Promise<HealthCheckResult> {
    if (this.client === null) return 'error';
    try {
      if (this.client.status === 'wait') await this.client.connect();
      // ioredis types ping() as resolving to 'PONG'; anything else rejects and lands in the catch.
      await this.client.ping();
      return 'ok';
    } catch {
      return 'error';
    }
  }

  /** Registers the redis probe only when a client exists. */
  onModuleInit(): void {
    if (this.client === null) return;
    this.health.register({ name: 'redis', run: () => this.ping() });
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client?.quit();
    } catch {
      // Already disconnected or never connected: nothing to release.
    }
  }
}
