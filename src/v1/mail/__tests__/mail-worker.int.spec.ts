/**
 * The worker process registers the mail queues (Pitfall 12): `WorkerModule` booted as `worker.ts`
 * does, against the local stack (`../erp-infra/env/local/api.host.env`), registers `mail.send`,
 * `mail.sweep` and `mail.purge`, upserts the two mail schedulers on Redis db 2 with their cadence,
 * and closes in time. Asserted the way `src/__tests__/worker.int.spec.ts` asserts `uploads.cleanup`;
 * the schedulers are left in place (an upsert is idempotent and the stack's own worker owns them).
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Queue } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import { producerConnection } from '../../../shared/queue/queue-connection.js';
import { QUEUE_PREFIX, QueueService } from '../../../shared/queue/queue.service.js';
import { WorkerModule } from '../../../worker.module.js';
import { MAIL_PURGE_QUEUE, MAIL_SEND_QUEUE, MAIL_SWEEP_QUEUE } from '../jobs/mail-send.job.js';

describe.skipIf(!process.env.REDIS_URL)('WorkerModule and the mail queues', () => {
  it('registers mail.send, mail.sweep and mail.purge, upserts the two mail schedulers and closes', async () => {
    const app = await NestFactory.createApplicationContext(WorkerModule, { logger: false });
    app.enableShutdownHooks();
    const connection = producerConnection(app.get(AppConfig).env);
    if (connection === null) throw new Error('REDIS_URL is not set');
    const sweep = new Queue(MAIL_SWEEP_QUEUE, { connection, prefix: QUEUE_PREFIX });
    const purge = new Queue(MAIL_PURGE_QUEUE, { connection, prefix: QUEUE_PREFIX });
    try {
      expect(app.get(QueueService).registeredQueues()).toEqual(
        expect.arrayContaining([MAIL_SEND_QUEUE, MAIL_SWEEP_QUEUE, MAIL_PURGE_QUEUE]),
      );
      const everyOf = async (queue: Queue, key: string) =>
        (await queue.getJobSchedulers()).find((scheduler) => scheduler.key === key)?.every;
      expect(await everyOf(sweep, 'mail.sweep.repeat')).toBe(TIMINGS.mail.sweepEveryMs);
      expect(await everyOf(purge, 'mail.purge.repeat')).toBe(TIMINGS.mail.purgeEveryMs);
    } finally {
      await sweep.close();
      await purge.close();
      const started = Date.now();
      await app.close();
      expect(Date.now() - started).toBeLessThan(TIMINGS.queue.closeTimeoutMs);
    }
  });
});
