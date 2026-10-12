import { describe, expect, it } from 'vitest';
import { TIMINGS } from '../../../shared/config/timings.js';
import { MailPurgeProcessor } from '../jobs/mail-purge.processor.js';
import type { MailRepository } from '../repository/mail.repository.js';
import { FakeMailRepository, FakeQueueService, RecordingLogger } from './fakes.js';

const NOW_MS = Date.parse('2026-10-03T08:00:00.000Z');

function harness(now = NOW_MS) {
  const repo = new FakeMailRepository();
  const logger = new RecordingLogger();
  const processor = new MailPurgeProcessor(
    new FakeQueueService(),
    repo as unknown as MailRepository,
    logger,
  );
  processor.now = () => now;
  return { repo, logger, processor };
}

describe('MailPurgeProcessor (D-09, B12)', () => {
  it('is the mail.purge queue, repeating every TIMINGS.mail.purgeEveryMs', () => {
    const { processor } = harness();
    expect(processor.queue).toBe('mail.purge');
    expect(processor.repeatEveryMs).toBe(TIMINGS.mail.purgeEveryMs);
  });

  it('deletes in batches until one is short: 1000, 1000, 7 is three calls, 12 calendar months back', async () => {
    const { repo, logger, processor } = harness();
    repo.purgeBatches = [1_000, 1_000, 7];
    await processor.handle();
    const cutoff = new Date('2025-10-03T08:00:00.000Z');
    expect(repo.calls).toEqual([
      { method: 'purgeBefore', args: [cutoff, 1_000] },
      { method: 'purgeBefore', args: [cutoff, 1_000] },
      { method: 'purgeBefore', args: [cutoff, 1_000] },
    ]);
    expect(logger.lines).toEqual([
      { level: 'log', message: 'mail purged', meta: { removed: 2007 } },
    ]);
  });

  it('nothing to purge: one call, removed 0', async () => {
    const { repo, logger, processor } = harness();
    await processor.handle();
    expect(repo.calls).toHaveLength(1);
    expect(logger.lines).toEqual([{ level: 'log', message: 'mail purged', meta: { removed: 0 } }]);
  });

  it('counts calendar months in UTC: 29 February 2028 cuts at 1 March 2027', async () => {
    const { repo, processor } = harness(Date.parse('2028-02-29T00:00:00.000Z'));
    await processor.handle();
    expect(repo.calls[0]?.args[0]).toEqual(new Date('2027-03-01T00:00:00.000Z'));
  });
});
