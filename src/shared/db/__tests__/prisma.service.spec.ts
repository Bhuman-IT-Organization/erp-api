/**
 * The pool budget a process takes (ADR-0031 §4): `DB_POOL_ROLE` picks `POOL.db.api` or
 * `POOL.db.worker` when the rendered URL has no `connection_limit`; a URL's own value wins. Read
 * from the one `prisma pool` boot line; no database connection is opened.
 */
import { describe, expect, it, vi } from 'vitest';
import type { AppConfig } from '../../config/app-config.js';
import { POOL } from '../../config/pool.js';
import type { HealthService } from '../../health/health.service.js';
import type { LoggerService } from '../../logger/logger.service.js';
import { PrismaService } from '../prisma.service.js';

const URL_WITHOUT_LIMIT = 'mysql://unused:unused@127.0.0.1:1/unused';

function poolLine(env: Record<string, unknown>): unknown {
  const log = vi.fn();
  const logger = { log, warn: vi.fn() } as unknown as LoggerService;
  const config = { env: { NODE_ENV: 'test', OWNERSHIP_GUARD: 'enforce', ...env } } as AppConfig;
  new PrismaService(config, {} as HealthService, logger);
  return log.mock.calls.find(([message]) => message === 'prisma pool')?.[1];
}

describe('PrismaService pool role', () => {
  it('appends POOL.db.worker (5) for DB_POOL_ROLE=worker', () => {
    expect(poolLine({ DATABASE_URL: URL_WITHOUT_LIMIT, DB_POOL_ROLE: 'worker' })).toMatchObject({
      connectionLimit: POOL.db.worker,
      source: 'POOL',
    });
    expect(POOL.db.worker).toBe(5);
  });

  it('appends POOL.db.api (10) by default', () => {
    expect(poolLine({ DATABASE_URL: URL_WITHOUT_LIMIT, DB_POOL_ROLE: 'api' })).toMatchObject({
      connectionLimit: POOL.db.api,
      source: 'POOL',
    });
    expect(POOL.db.api).toBe(10);
  });

  it("keeps a URL's own connection_limit", () => {
    const url = `${URL_WITHOUT_LIMIT}?connection_limit=4`;
    expect(poolLine({ DATABASE_URL: url, DB_POOL_ROLE: 'worker' })).toMatchObject({
      connectionLimit: 4,
      source: 'env',
    });
  });
});
