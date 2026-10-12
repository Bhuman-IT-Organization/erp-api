import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { HealthService } from '../../health/health.service.js';
import { RedisService } from '../redis.service.js';

describe('RedisService without REDIS_URL', () => {
  it('creates no client, registers no probe, and ping() reports error', async () => {
    const config = {
      env: {
        NODE_ENV: 'test',
        PORT: 3000,
        DATABASE_URL: 'mysql://u:p@127.0.0.1:1/none',
        OWNERSHIP_GUARD: 'enforce',
      },
    } as AppConfig;
    const health = new HealthService();
    const service = new RedisService(config, health);

    service.onModuleInit();

    expect(service.client).toBeNull();
    await expect(service.ping()).resolves.toBe('error');
    await expect(health.report()).resolves.toEqual({ status: 'ok', checks: {} });
    await service.onModuleDestroy();
  });
});
