/**
 * Root of the application error hierarchy (BE-03). Throw it anywhere below the controller; the
 * `ProblemDetailsFilter` turns it into an RFC 9457 body with the `ERP-*` code. Never wrap a
 * secret or a URL in `detail`: it is sent to the client verbatim.
 */
import { ERROR_CODES, type ErrorCode } from './error-codes.js';

export interface AppErrorExtras {
  /** Seconds the client should wait; becomes the `Retry-After` header. */
  readonly retryAfterS?: number;
  /** Validation issues; included in the body only for ERP-VALIDATION-0001. */
  readonly issues?: unknown;
}

export class AppError extends Error {
  override readonly name: string = 'AppError';

  constructor(
    readonly code: ErrorCode,
    detail?: string,
    readonly extras?: AppErrorExtras,
  ) {
    super(detail ?? ERROR_CODES[code].title);
  }

  get status(): number {
    return ERROR_CODES[this.code].status;
  }

  get title(): string {
    return ERROR_CODES[this.code].title;
  }
}
