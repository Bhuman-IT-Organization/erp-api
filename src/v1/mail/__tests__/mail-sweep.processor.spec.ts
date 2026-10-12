import { describe, expect, it } from 'vitest';
import { TIMINGS } from '../../../shared/config/timings.js';
import type { QueueService } from '../../../shared/queue/queue.service.js';
import { MailSweepProcessor } from '../jobs/mail-sweep.processor.js';
import type { MailRepository } from '../repository/mail.repository.js';
import { FakeMailRepository, FakeQueueService, RecordingLogger } from './fakes.js';

const NOW_MS = Date.parse('2026-10-03T08:00:00.000Z');

function harness() {
  const repo = new FakeMailRepository();
  const queue = new FakeQueueService();
  const logger = new RecordingLogger();
  const processor = new MailSweepProcessor(
    queue,
    repo as unknown as MailRepository,
    queue as unknown as QueueService,
    logger,
  );
  processor.now = () => NOW_MS;
  return { repo, queue, logger, processor };
}

describe('MailSweepProcessor', () => {
  it('is the mail.sweep queue, repeating every TIMINGS.mail.sweepEveryMs', () => {
    const { processor } = harness();
    expect(processor.queue).toBe('mail.sweep');
    expect(processor.repeatEveryMs).toBe(TIMINGS.mail.sweepEveryMs);
  });

  it('re-adds mail-<id> for each row queued before the cut-off and logs the count', async () => {
    const { repo, queue, logger, processor } = harness();
    repo.queuedIds = [3, 4];
    await processor.handle();
    expect(repo.calls[0]).toEqual({
      method: 'queuedBefore',
      args: [new Date(NOW_MS - TIMINGS.mail.sweepAfterMs), TIMINGS.mail.purgeBatchSize],
    });
    expect(queue.added).toEqual([
      { queue: 'mail.send', name: 'send', data: { sentEmailId: 3 }, options: { jobId: 'mail-3' } },
      { queue: 'mail.send', name: 'send', data: { sentEmailId: 4 }, options: { jobId: 'mail-4' } },
    ]);
    expect(logger.lines).toEqual([{ level: 'log', message: 'mail swept', meta: { requeued: 2 } }]);
  });

  it('nothing queued: nothing added, requeued 0', async () => {
    const { queue, logger, processor } = harness();
    await processor.handle();
    expect(queue.added).toEqual([]);
    expect(logger.lines).toEqual([{ level: 'log', message: 'mail swept', meta: { requeued: 0 } }]);
  });
});
