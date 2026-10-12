import { Module } from '@nestjs/common';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { CacheModule } from './shared/cache/cache.module.js';
import { ConfigModule } from './shared/config/config.module.js';
import { DbModule } from './shared/db/db.module.js';
import { EventsModule } from './shared/events/events.module.js';
import { HealthModule } from './shared/health/health.module.js';
import { IdempotencyModule } from './shared/http/interceptors/idempotency.module.js';
import { LoggerModule } from './shared/logger/logger.module.js';
import { QueueModule } from './shared/queue/queue.module.js';
import { ResilienceModule } from './shared/resilience/resilience.module.js';
import { StorageModule } from './shared/storage/storage.module.js';
import { UploadsModule } from './shared/uploads/uploads.module.js';
import { V1Module } from './v1/v1.module.js';

/**
 * The shared modules both processes import: global config, logger, events, health and resilience,
 * db and cache, the idempotency store (BE-15), file storage and resumable uploads (ADR-0041).
 * `WorkerModule` (worker.ts) imports the same list.
 */
export const SHARED_IMPORTS = [
  ConfigModule,
  LoggerModule,
  EventsModule,
  HealthModule,
  ResilienceModule,
  DbModule,
  CacheModule,
  IdempotencyModule,
  StorageModule,
  UploadsModule,
];

/** Root module of the api: the shared modules, the queue as a producer only (BE-14), then the versioned API and the integrations layer. */
@Module({
  imports: [
    ...SHARED_IMPORTS,
    QueueModule.forRoot({ runWorkers: false }),
    V1Module,
    IntegrationsModule,
  ],
})
export class AppModule {}
