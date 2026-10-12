/**
 * The worker entry's module against the local stack (`../erp-infra/env/local/api.host.env`), booted
 * as `worker.ts` does: an application context, no HTTP (BE-14). It registers `uploads.cleanup`,
 * upserts its hourly scheduler on Redis db 2, and closes within `TIMINGS.queue.closeTimeoutMs`.
 * The scheduler is left in place: an upsert is idempotent, and the stack's own worker owns it.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { AppConfig } from '../shared/config/app-config.js';
import { TIMINGS } from '../shared/config/timings.js';
import { producerConnection } from '../shared/queue/queue-connection.js';
import { QUEUE_PREFIX, QueueService } from '../shared/queue/queue.service.js';
import { WorkerModule } from '../worker.module.js';

describe.skipIf(!process.env.REDIS_URL)('WorkerModule against the local stack', () => {
  it('boots, registers uploads.cleanup, upserts its scheduler on db 2 and closes in time', async () => {
    const app = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    app.enableShutdownHooks();
    const connection = producerConnection(app.get(AppConfig).env);
    if (connection === null) throw new Error('REDIS_URL is not set');
    const inspect = new Queue('uploads.cleanup', { connection, prefix: QUEUE_PREFIX });
    try {
      expect(app.get(QueueService).registeredQueues()).toContain('uploads.cleanup');
      const schedulers = await inspect.getJobSchedulers();
      expect(schedulers.map((s) => s.key)).toContain('uploads.cleanup.repeat');
      expect(schedulers.find((s) => s.key === 'uploads.cleanup.repeat')?.every).toBe(
        TIMINGS.uploads.cleanupEveryMs,
      );
    } finally {
      await inspect.close();
      const started = Date.now();
      await app.close();
      expect(Date.now() - started).toBeLessThan(TIMINGS.queue.closeTimeoutMs);
    }
  });
});
