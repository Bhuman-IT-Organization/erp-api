import { describe, expect, it } from 'vitest';
import type { RetryPolicy } from '../../config/retry-policies.js';
import { AppError } from '../../errors/app-error.js';
import { UpstreamUnavailableError } from '../../errors/upstream-unavailable.error.js';
import { backoffDelayMs, withRetry } from '../retry.js';
import { UpstreamHttpError, isTransientError } from '../transient-error.js';

const policy: RetryPolicy = {
  attempts: 3,
  baseDelayMs: 200,
  maxDelayMs: 2_000,
  retryOn: isTransientError,
};

function harness() {
  const sleeps: number[] = [];
  const deps = {
    sleep: (ms: number) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0.5,
  };
  return { sleeps, deps };
}

function transient(): Error {
  return Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
}

/** Fails `failures` times with `error`, then resolves. Counts calls. */
function flaky(failures: number, error: () => Error) {
  let calls = 0;
  const fn = (): Promise<string> => {
    calls += 1;
    return calls <= failures ? Promise.reject(error()) : Promise.resolve('ok');
  };
  return { fn, calls: () => calls };
}

describe('withRetry', () => {
  it('returns on the first try without sleeping', async () => {
    const { sleeps, deps } = harness();
    const f = flaky(0, transient);
    await expect(withRetry(policy, f.fn, deps)).resolves.toBe('ok');
    expect(f.calls()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('retries transient errors with full-jitter delays and succeeds on the third call', async () => {
    const { sleeps, deps } = harness();
    const f = flaky(2, transient);
    await expect(withRetry(policy, f.fn, deps)).resolves.toBe('ok');
    expect(f.calls()).toBe(3);
    expect(sleeps).toEqual([100, 200]); // 0.5 * 200, 0.5 * 400
  });

  it('never retries an AppError (business / 4xx)', async () => {
    const { sleeps, deps } = harness();
    const f = flaky(5, () => new AppError('ERP-AUTH-0001'));
    await expect(withRetry(policy, f.fn, deps)).rejects.toBeInstanceOf(AppError);
    expect(f.calls()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('never retries an upstream 4xx but retries an upstream 5xx', async () => {
    const notFound = flaky(5, () => new UpstreamHttpError('legacy', 404));
    await expect(withRetry(policy, notFound.fn, harness().deps)).rejects.toBeInstanceOf(
      UpstreamHttpError,
    );
    expect(notFound.calls()).toBe(1);

    const unavailable = flaky(1, () => new UpstreamHttpError('legacy', 503));
    await expect(withRetry(policy, unavailable.fn, harness().deps)).resolves.toBe('ok');
    expect(unavailable.calls()).toBe(2);
  });

  it('never retries an open breaker (UpstreamUnavailableError)', async () => {
    const f = flaky(5, () => new UpstreamUnavailableError('legacy', 10));
    await expect(withRetry(policy, f.fn, harness().deps)).rejects.toBeInstanceOf(
      UpstreamUnavailableError,
    );
    expect(f.calls()).toBe(1);
  });

  it('stops at policy.attempts and rethrows the last error by identity', async () => {
    const errors: Error[] = [];
    const f = flaky(99, () => {
      const e = transient();
      errors.push(e);
      return e;
    });
    const outcome = await withRetry(policy, f.fn, harness().deps).catch((e: unknown) => e);
    expect(f.calls()).toBe(3);
    expect(outcome).toBe(errors[2]);
  });

  it('caps the backoff at maxDelayMs', () => {
    expect(backoffDelayMs(policy, 10, () => 1)).toBe(policy.maxDelayMs);
    expect(backoffDelayMs(policy, 1, () => 1)).toBe(200);
    expect(backoffDelayMs(policy, 3, () => 0)).toBe(0);
  });

  it('hands the attempt number to fn', async () => {
    const seen: number[] = [];
    await withRetry(
      policy,
      (attempt) => {
        seen.push(attempt);
        return attempt < 3 ? Promise.reject(transient()) : Promise.resolve(attempt);
      },
      harness().deps,
    );
    expect(seen).toEqual([1, 2, 3]);
  });
});

describe('isTransientError', () => {
  it.each([
    ['a Node system error with a transient code', transient(), true],
    [
      'a fetch failed TypeError whose cause carries the code',
      new TypeError('fetch failed', { cause: { code: 'ECONNRESET' } }),
      true,
    ],
    ['a TimeoutError DOMException', new DOMException('x', 'TimeoutError'), true],
    ['an AbortError DOMException', new DOMException('x', 'AbortError'), true],
    ['an upstream 500', new UpstreamHttpError('sap', 500), true],
    ['an upstream 429', new UpstreamHttpError('sap', 429), false],
    ['a plain Error', new Error('boom'), false],
    ['an AppError', new AppError('ERP-VALIDATION-0001'), false],
    ['an open breaker', new UpstreamUnavailableError('legacy', 10), false],
    ['a non-error value', 'ECONNREFUSED', false],
  ])('%s → %s', (_name, error, expected) => {
    expect(isTransientError(error)).toBe(expected);
  });
});
