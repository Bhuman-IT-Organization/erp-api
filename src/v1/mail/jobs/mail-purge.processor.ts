/**
 * The `mail.purge` job (BE-14, ADR-0049, D-09, B12): every `TIMINGS.mail.purgeEveryMs` it deletes the
 * sent-email log rows queued more than `TIMINGS.mail.logRetentionMonths` calendar months (UTC) ago,
 * in batches of `TIMINGS.mail.purgeBatchSize` until a batch comes back short, so no single delete
 * holds a long lock. A repeatable processor on the 04.2-04 seam (`repeatEveryMs`); Node owns the
 * schedule (D-45), not a cron in Perfex. It logs the count only.
 */
import { Injectable } from '@nestjs/common';
import { TIMINGS } from '../../../shared/config/timings.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { BaseProcessor, ProcessorRegistry } from '../../../shared/queue/base.processor.js';
import { MailRepository } from '../repository/mail.repository.js';
import { MAIL_PURGE_QUEUE } from './mail-send.job.js';

@Injectable()
export class MailPurgeProcessor extends BaseProcessor<Record<string, never>> {
  readonly queue = MAIL_PURGE_QUEUE;
  readonly repeatEveryMs = TIMINGS.mail.purgeEveryMs;

  /** Constructor-assigned (not DI) so a spec can fix the clock. */
  now: () => number = () => Date.now();

  constructor(
    queues: ProcessorRegistry,
    private readonly repository: MailRepository,
    private readonly logger: LoggerService,
  ) {
    super(queues);
  }

  async handle(): Promise<void> {
    const cutoff = new Date(this.now());
    cutoff.setUTCMonth(cutoff.getUTCMonth() - TIMINGS.mail.logRetentionMonths);
    const size = TIMINGS.mail.purgeBatchSize;
    let removed = 0;
    let batch: number;
    do {
      // eslint-disable-next-line no-await-in-loop, erp/no-query-in-loop -- each batch's delete must finish before the next is chosen (BE-19)
      batch = await this.repository.purgeBefore(cutoff, size);
      removed += batch;
    } while (batch === size);
    this.logger.log('mail purged', { removed });
  }
}
