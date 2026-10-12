/**
 * ADR-0049: an upstream answered "try again later" (an SMTP 4xx after the breaker, a deferred
 * refusal). Transient for `isTransientError`, so the queue retries it with the processor's policy.
 * Never an AppError: the queue stores an AppError's code as the failure reason and
 * `isTransientError` treats every AppError as final.
 */
export class RetryLaterError extends Error {
  override readonly name = 'RetryLaterError';

  constructor(
    readonly upstream: string,
    readonly reason: string,
  ) {
    super(`${upstream} asked to retry later (${reason})`);
  }
}
