/**
 * Global exception filter for the Fastify adapter. Every error
 * leaves the api as an RFC 9457 problem-details body with a stable `ERP-*` code:
 *
 * - `AppError` → its code's status and title, `detail` from the message, `Retry-After` when set,
 *   `issues` for the codes of `ISSUE_CODES` only
 * - Nest's unknown-route 404 (`Cannot <METHOD> <url>`) → ERP-CORE-0004 with no path or method, so
 *   a secret in a mistyped URL (a public shipment hash, plan 04.7-10) is never echoed back
 * - Nest `HttpException` → its status, `code: ERP-HTTP-<status>`; an object response (the health
 *   controller's `ServiceUnavailableException(report)`) is returned unchanged
 * - `@fastify/csrf-protection` errors (`code` starts with `FST_CSRF`) → ERP-AUTH-0008 (403)
 * - anything else → ERP-INTERNAL-0001 (500) with the fixed detail `Internal error`; the original
 *   message and stack go to the logger only (threat T-1.3-06)
 *
 * Controllers never catch (approved plan): this filter is the one place an error becomes HTTP.
 */
import {
  Catch,
  HttpException,
  NotFoundException,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { LoggerService } from '../logger/logger.service.js';
import { AppError } from './app-error.js';
import { ERROR_CODES, type ErrorCode } from './error-codes.js';

/** RFC 9457 subset the api emits; `code` is the ERP-* catalog entry (or ERP-HTTP-<status>). */
export interface ProblemDetails {
  readonly type: 'about:blank';
  readonly status: number;
  readonly title: string;
  readonly detail: string;
  readonly code: string;
  readonly issues?: unknown;
}

export const PROBLEM_CONTENT_TYPE = 'application/problem+json';
const INTERNAL: ErrorCode = 'ERP-INTERNAL-0001';
const CSRF: ErrorCode = 'ERP-AUTH-0008';
const NOT_FOUND: ErrorCode = 'ERP-CORE-0004';

/**
 * The codes whose `issues` reach the client, and why each names rows or paths:
 * - ERP-VALIDATION-0001: the failing paths of a validation error;
 * - ERP-CORE-0013: a stale save (ADR-0040), a batch naming its stale rows.
 * Every other code answers without `issues`, whatever the thrower attached.
 */
const ISSUE_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'ERP-VALIDATION-0001',
  'ERP-CORE-0013',
]);

function codeOf(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

/**
 * The message of a Nest-built exception body: a plain string, or Nest's standard
 * `{ statusCode, message, error }` object. Any other object is a controller's own body.
 */
function nestMessage(response: unknown): string | undefined {
  if (typeof response === 'string') return response;
  if (typeof response !== 'object' || response === null) return undefined;
  const { statusCode, message } = response as { statusCode?: unknown; message?: unknown };
  if (typeof statusCode !== 'number') return undefined;
  if (typeof message === 'string') return message;
  if (Array.isArray(message)) return message.map(String).join('; ');
  return undefined;
}

function problem(code: ErrorCode, detail?: string, issues?: unknown): ProblemDetails {
  const { status, title } = ERROR_CODES[code];
  return {
    type: 'about:blank',
    status,
    title,
    detail: detail ?? title,
    code,
    ...(issues === undefined ? {} : { issues }),
  };
}

/**
 * The body this filter answers for an `AppError`, as a pure function: the tus upload hooks
 * (`shared/uploads`, ADR-0041) answer outside Nest's filter chain and send the same body through
 * tus, so a refused upload reads exactly like any other refusal.
 */
export function problemBodyOf(error: AppError): ProblemDetails {
  const carriesIssues = ISSUE_CODES.has(error.code);
  return problem(error.code, error.message, carriesIssues ? error.extras?.issues : undefined);
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();

    if (exception instanceof AppError) {
      const retryAfterS = exception.extras?.retryAfterS;
      if (retryAfterS !== undefined) void reply.header('Retry-After', String(retryAfterS));
      this.send(reply, exception.status, problemBodyOf(exception));
      return;
    }

    if (
      exception instanceof NotFoundException &&
      exception.message.startsWith(`Cannot ${request.method} `)
    ) {
      // Nest's router-level not-found handler, which puts the whole raw URL in the message.
      this.send(reply, ERROR_CODES[NOT_FOUND].status, problem(NOT_FOUND));
      return;
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const detail = nestMessage(response);
      if (detail === undefined && typeof response === 'object') {
        // A controller threw its own structured body (health's 503 report): pass it through as-is.
        void reply.status(status).send(response);
        return;
      }
      this.send(reply, status, {
        type: 'about:blank',
        status,
        title: exception.message,
        detail: detail ?? exception.message,
        code: `ERP-HTTP-${String(status)}`,
      });
      return;
    }

    if (codeOf(exception)?.startsWith('FST_CSRF') === true) {
      this.send(reply, ERROR_CODES[CSRF].status, problem(CSRF));
      return;
    }

    this.logger.error('unhandled error', {
      url: request.url,
      method: request.method,
      error: exception instanceof Error ? exception : { value: String(exception) },
    });
    this.send(reply, ERROR_CODES[INTERNAL].status, problem(INTERNAL, 'Internal error'));
  }

  private send(reply: FastifyReply, status: number, body: ProblemDetails): void {
    void reply.status(status).header('content-type', PROBLEM_CONTENT_TYPE).send(body);
  }
}
