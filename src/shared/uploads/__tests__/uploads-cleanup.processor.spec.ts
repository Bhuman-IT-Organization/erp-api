/**
 * The hourly `uploads.cleanup` job (P-12, ADR-0041 §7): its queue, its schedule, and that a run
 * calls `cleanUpExpired()` once and logs the count only.
 */
import { describe, expect, it, vi } from 'vitest';
import { TIMINGS } from '../../config/timings.js';
import type { LoggerService } from '../../logger/logger.service.js';
import type { ProcessorRegistry } from '../../queue/base.processor.js';
import { UploadsCleanupProcessor } from '../uploads-cleanup.processor.js';
import type { UploadsService } from '../uploads.service.js';

function build() {
  const registry = { registerProcessor: vi.fn() } as unknown as ProcessorRegistry;
  const cleanUpExpired = vi.fn(() => Promise.resolve(3));
  const uploads = { cleanUpExpired } as unknown as UploadsService;
  const log = vi.fn();
  const logger = { log } as unknown as LoggerService;
  return { processor: new UploadsCleanupProcessor(registry, uploads, logger), cleanUpExpired, log };
}

describe('UploadsCleanupProcessor', () => {
  it('runs on uploads.cleanup every TIMINGS.uploads.cleanupEveryMs (hourly)', () => {
    const { processor } = build();
    expect(processor.queue).toBe('uploads.cleanup');
    expect(processor.repeatEveryMs).toBe(TIMINGS.uploads.cleanupEveryMs);
    expect(processor.retryPolicy).toBeUndefined();
  });

  it('calls cleanUpExpired once and logs the count only', async () => {
    const { processor, cleanUpExpired, log } = build();
    await processor.handle();
    expect(cleanUpExpired).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledExactlyOnceWith('uploads cleaned', { removed: 3 });
  });
});
