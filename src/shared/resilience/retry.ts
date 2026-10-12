/**
 * Retry with exponential backoff and full jitter (ADR-0031 §2). Retries only while the policy's
 * `retryOn(error)` holds and attempts remain; the last error is rethrown unchanged.
 *
 * Precondition: the wrapped operation is idempotent or carries an idempotency key
 * (BE-15) — the caller proves this, not this function. Retry lives here and
 * nowhere else — never in the breaker library, never in an HTTP client (§6); a second retry layer
 * would silently multiply attempts.
 */
import type { RetryPolicy } from '../config/retry-policies.js';

export interface RetryDeps {
  /** Injectable for tests; the default is an unref'd setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable for tests; the default is Math.random. */
  random?: () => number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

/** Full jitter: `random() * min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1))`. Pure. */
export function backoffDelayMs(policy: RetryPolicy, attempt: number, random: () => number): number {
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  return random() * Math.min(policy.maxDelayMs, exponential);
}

export async function withRetry<T>(
  policy: RetryPolicy,
  fn: (attempt: number) => Promise<T>,
  deps: RetryDeps = {},
): Promise<T> {
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  for (let attempt = 1; ; attempt += 1) {
    try {
      // eslint-disable-next-line no-await-in-loop -- a retry is sequential by definition: the next attempt waits for this one and its backoff (ADR-0031)
      return await fn(attempt);
    } catch (error) {
      if (attempt >= policy.attempts || !policy.retryOn(error)) throw error;
      // eslint-disable-next-line no-await-in-loop -- a retry is sequential by definition: the next attempt waits for this one and its backoff (ADR-0031)
      await sleep(backoffDelayMs(policy, attempt, random));
    }
  }
}
