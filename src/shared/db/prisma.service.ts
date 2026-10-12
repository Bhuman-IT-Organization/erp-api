/**
 * The one Prisma client the application exposes. It is wrapped by the ownership guard unless
 * `OWNERSHIP_GUARD=off`, which the env schema accepts only in production.
 *
 * ADR-0031 §4: the pool is explicit, never Prisma's `cpus × 2 + 1`. `withPoolParams` appends
 * `connection_limit` (`POOL.db[DB_POOL_ROLE]`: `api` for main.ts, `worker` for worker.ts) and
 * the TIMINGS.db timeouts when the rendered DATABASE_URL lacks them; a value rendered by erp-infra
 * wins. The boot line names the numbers, never the URL.
 */
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import { POOL } from '../config/pool.js';
import { TIMINGS } from '../config/timings.js';
import { HealthService } from '../health/health.service.js';
import { LoggerService } from '../logger/logger.service.js';
import { describePool, withPoolParams } from './database-url.js';
import { PrismaClient } from './generated/client.js';
import { loadCoWrites, type CoWriteMap } from './ownership-cowrites.js';
import { NODE_OWNER, createOwnershipExtension } from './ownership-guard.js';
import { loadModelTableMap, loadOwnership, type OwnershipMap } from './ownership.js';

/** The guard over both ownership registers and the recorded co-writes (ADR-0035, ADR-0050). */
function buildGuardedClient(base: PrismaClient, ownership: OwnershipMap, coWrites: CoWriteMap) {
  return base.$extends(createOwnershipExtension(ownership, loadModelTableMap(), coWrites));
}

/** The guarded client type. The extension adds no members, so an unguarded client has the same shape. */
export type ExtendedPrismaClient = ReturnType<typeof buildGuardedClient>;

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly client: ExtendedPrismaClient;
  readonly guardEnabled: boolean;

  /** The logger defaults so the int specs can build the service by hand; Nest injects the global one. */
  constructor(
    private readonly config: AppConfig,
    private readonly health: HealthService,
    logger: LoggerService = new LoggerService(),
  ) {
    const { env } = this.config;
    const datasourceUrl = withPoolParams(env.DATABASE_URL, POOL.db[env.DB_POOL_ROLE], TIMINGS.db);
    const { connectionLimit, poolTimeoutS } = describePool(datasourceUrl);
    logger.log('prisma pool', {
      connectionLimit,
      poolTimeoutS,
      source: describePool(env.DATABASE_URL).connectionLimit === null ? 'POOL' : 'env',
    });
    const base = new PrismaClient({
      datasourceUrl,
      log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
    this.guardEnabled = env.OWNERSHIP_GUARD === 'enforce';
    if (this.guardEnabled) {
      const ownership = loadOwnership();
      const nodeOwned = [...ownership.values()].filter((o) => o === NODE_OWNER).length;
      const coWrites = loadCoWrites(ownership);
      // A count, never a table list (ADR-0050).
      const coWriteRecords = [...coWrites.values()].reduce((n, records) => n + records.length, 0);
      logger.warn('ownership guard: enforce', {
        tables: ownership.size,
        nodeOwned,
        coWrites: coWriteRecords,
      });
      this.client = buildGuardedClient(base, ownership, coWrites);
    } else {
      // The extension only intercepts queries; the base client has the same members.
      this.client = base as unknown as ExtendedPrismaClient;
    }
  }

  /** Registers the db probe. No eager $connect(): the first query connects. */
  onModuleInit(): void {
    this.health.register({
      name: 'db',
      run: async () => {
        await this.client.$queryRaw`SELECT 1`;
        return 'ok';
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
