/**
 * The `mail.sweep` job (BE-14, ADR-0049 decision 5, RESEARCH R2 step 3): every
 * `TIMINGS.mail.sweepEveryMs` it re-adds the job `mail-<id>` of each non-test row still `queued`
 * `TIMINGS.mail.sweepAfterMs` after it was written, so a row whose add was lost (the api process died,
 * Redis refused) is still sent. The job id makes a re-add of a live job a no-op. A repeatable
 * processor on the 04.2-04 seam (`repeatEveryMs`, the `UploadsCleanupProcessor` form); it logs the
 * count only.
 *
 * ponytail: a row whose job sits in BullMQ's failed set (kept `TIMINGS.queue.keepFailedS`) is not
 * re-added until that record expires; upgrade path: remove the failed job before re-adding.
 */
import { Injectable } from '@nestjs/common';
import { TIMINGS } from '../../../shared/config/timings.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { BaseProcessor, ProcessorRegistry } from '../../../shared/queue/base.processor.js';
import { QueueService } from '../../../shared/queue/queue.service.js';
import { MailRepository } from '../repository/mail.repository.js';
import { enqueueMailSend, MAIL_SWEEP_QUEUE } from './mail-send.job.js';

@Injectable()
export class MailSweepProcessor extends BaseProcessor<Record<string, never>> {
  readonly queue = MAIL_SWEEP_QUEUE;
  readonly repeatEveryMs = TIMINGS.mail.sweepEveryMs;

  /** Constructor-assigned (not DI) so a spec can fix the clock. */
  now: () => number = () => Date.now();

  constructor(
    queues: ProcessorRegistry,
    private readonly repository: MailRepository,
    private readonly jobs: QueueService,
    private readonly logger: LoggerService,
  ) {
    super(queues);
  }

  async handle(): Promise<void> {
    const ids = await this.repository.queuedBefore(
      new Date(this.now() - TIMINGS.mail.sweepAfterMs),
      TIMINGS.mail.purgeBatchSize,
    );
    await Promise.all(ids.map((id) => enqueueMailSend(this.jobs, { sentEmailId: id })));
    this.logger.log('mail swept', { requeued: ids.length });
  }
}
