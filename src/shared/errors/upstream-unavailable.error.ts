/**
 * ADR-0031 §7: thrown by `shared/resilience/breaker.ts` when a circuit is open; the filter maps
 * it to 503 + Retry-After; `isTransientError` returns false for it so `withRetry` never retries
 * an open breaker.
 */
import { AppError } from './app-error.js';

export class UpstreamUnavailableError extends AppError {
  override readonly name: string = 'UpstreamUnavailableError';

  constructor(
    readonly upstream: string,
    retryAfterS: number,
  ) {
    super('ERP-UPSTREAM-0001', `${upstream} is unavailable`, { retryAfterS });
  }
}
