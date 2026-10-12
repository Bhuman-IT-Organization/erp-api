/**
 * The worker entry beside `main.ts` (BE-14): `WorkerModule` as an application context, so no HTTP
 * listener exists (T-4.2-35). `QueueService` starts one BullMQ worker per registered processor and
 * upserts each repeatable schedule on Redis db 2; SIGTERM closes them through the shutdown hooks.
 * The database pool is the worker's (`DB_POOL_ROLE=worker`, `POOL.db.worker`, ADR-0031 §4), set by
 * the rendered env. The fatal handlers are `main.ts`'s.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { QueueService } from './shared/queue/queue.service.js';
import { LoggerService } from './shared/logger/logger.service.js';
import { WorkerModule } from './worker.module.js';

const FATAL_EXIT_CODE = 1;

// Built directly: the fatal handlers must exist before the Nest container does.
const bootLogger = new LoggerService();

process.on('unhandledRejection', (reason: unknown) => {
  bootLogger.error('fatal: unhandledRejection', {
    error: reason instanceof Error ? reason : { value: String(reason) },
  });
  process.exit(FATAL_EXIT_CODE);
});
process.on('uncaughtException', (error: Error) => {
  bootLogger.error('fatal: uncaughtException', { error });
  process.exit(FATAL_EXIT_CODE);
});

const app = await NestFactory.createApplicationContext(WorkerModule);
app.enableShutdownHooks();
app.get(LoggerService).log('erp-worker started', {
  queues: app.get(QueueService).registeredQueues(),
});
