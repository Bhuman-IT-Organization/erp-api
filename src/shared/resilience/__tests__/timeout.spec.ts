import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTimeoutError, timeoutSignal } from '../timeout.js';

/** A fetch-shaped fake: settles only when its signal aborts, the way undici does. */
function fakeFetch(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    signal.addEventListener('abort', () => {
      reject(signal.reason as Error);
    });
  });
}

describe('timeoutSignal', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('aborts the call with a TimeoutError once ms has elapsed', async () => {
    vi.useFakeTimers();
    const outcome = fakeFetch(timeoutSignal(1_000)).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(1_000);
    const error = await outcome;
    expect(isTimeoutError(error)).toBe(true);
    expect((error as Error).name).toBe('TimeoutError');
  });

  it('propagates a parent abort through AbortSignal.any before the timeout', async () => {
    vi.useFakeTimers();
    const parent = new AbortController();
    const outcome = fakeFetch(timeoutSignal(10_000, parent.signal)).catch((e: unknown) => e);
    parent.abort();
    const error = await outcome;
    expect(isTimeoutError(error)).toBe(true);
    expect((error as Error).name).toBe('AbortError');
  });

  it('isTimeoutError is false for other errors and non-errors', () => {
    expect(isTimeoutError(new Error('boom'))).toBe(false);
    expect(isTimeoutError('TimeoutError')).toBe(false);
  });
});
