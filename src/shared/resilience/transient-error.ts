/**
 * The one predicate that decides whether an error is worth retrying (ADR-0031 §2): network and
 * timeout failures and upstream 5xx are transient; 4xx, validation and business errors never are,
 * and an open breaker is never retried. `RETRY_POLICIES.*.retryOn` points here.
 */
import { AppError } from '../errors/app-error.js';
import { RetryLaterError } from '../errors/retry-later.error.js';
import { UpstreamUnavailableError } from '../errors/upstream-unavailable.error.js';

/** Node system-error codes (and undici's) that mean "the peer was not reached", not "the peer said no". */
const TRANSIENT_CODES: ReadonlySet<string> = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENOTFOUND',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** An upstream answered with an HTTP status the caller treats as a failure. `status >= 500` is transient. */
export class UpstreamHttpError extends Error {
  override readonly name = 'UpstreamHttpError';

  constructor(
    readonly upstream: string,
    readonly status: number,
  ) {
    super(`${upstream} answered ${String(status)}`);
  }
}

const HTTP_SERVER_ERROR_FLOOR = 500;

/** Error names of an aborted or timed-out call (`AbortSignal.timeout`, `AbortController.abort`). */
const ABORT_NAMES: ReadonlySet<string> = new Set(['TimeoutError', 'AbortError']);

function codeOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const code = (value as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof RetryLaterError) return true; // the upstream asked to try again later (ADR-0049)
  if (error instanceof UpstreamUnavailableError) return false; // an open breaker is never retried
  if (error instanceof AppError) return false; // business or 4xx: never transient
  if (error instanceof UpstreamHttpError) return error.status >= HTTP_SERVER_ERROR_FLOOR;
  if (error instanceof Error && ABORT_NAMES.has(error.name)) return true;
  const code = codeOf(error) ?? codeOf((error as { cause?: unknown } | null)?.cause);
  return code !== undefined && TRANSIENT_CODES.has(code);
}
