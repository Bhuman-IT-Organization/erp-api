/**
 * Retry policies (ADR-0031 §2): attempts, base delay, cap, and which errors are retryable —
 * exponential backoff with full jitter, applied by `shared/resilience/retry.ts` and nowhere else.
 *
 * Precondition: only idempotent operations or ones carrying an idempotency key may be wrapped
 * (BE-15). Network, timeout and 5xx errors retry; 4xx, validation and business errors
 * never do (`isTransientError`). BullMQ `attempts`/`backoff` read `queueJob` when `shared/queue/`
 * is built by the first module that needs a job, so one definition serves HTTP and queue retries
 * alike.
 */
import { isTransientError } from '../resilience/transient-error.js';

export interface RetryPolicy {
  readonly attempts: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly retryOn: (error: unknown) => boolean;
}

export const RETRY_POLICIES = Object.freeze({
  legacyHttp: Object.freeze({
    attempts: 3,
    baseDelayMs: 200,
    maxDelayMs: 2_000,
    retryOn: isTransientError,
  }),
  vendorHttp: Object.freeze({
    attempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 5_000,
    retryOn: isTransientError,
  }),
  redis: Object.freeze({
    attempts: 2,
    baseDelayMs: 50,
    maxDelayMs: 200,
    retryOn: isTransientError,
  }),
  queueJob: Object.freeze({
    attempts: 5,
    baseDelayMs: 1_000,
    maxDelayMs: 60_000,
    retryOn: isTransientError,
  }), // BullMQ attempts/backoff read this when `shared/queue/` is built by the first module that needs a job
  mailSend: Object.freeze({
    attempts: 8,
    baseDelayMs: 30_000,
    maxDelayMs: 1_800_000,
    retryOn: isTransientError,
  }), // ADR-0049: the mail.send queue; 30 s, 1, 2, 4, 8, 16, 30 min (about an hour); the processor throws RetryLaterError or NonRetryableJobError
}) satisfies Readonly<Record<string, RetryPolicy>>;
