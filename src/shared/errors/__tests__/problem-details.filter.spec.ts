import { ServiceUnavailableException, type ArgumentsHost } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { LoggerService } from '../../logger/logger.service.js';
import { AppError } from '../app-error.js';
import { ERROR_CODES, type ErrorCode } from '../error-codes.js';
import {
  ProblemDetailsFilter,
  problemBodyOf,
  type ProblemDetails,
} from '../problem-details.filter.js';
import { UpstreamUnavailableError } from '../upstream-unavailable.error.js';

/** A recording Fastify reply: enough of the chainable surface for the filter. */
function recordingReply() {
  const reply = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status(code: number) {
      reply.statusCode = code;
      return reply;
    },
    header(name: string, value: string) {
      reply.headers[name.toLowerCase()] = value;
      return reply;
    },
    send(payload: unknown) {
      reply.body = payload;
      return reply;
    },
  };
  return reply;
}

class SilentLogger extends LoggerService {
  readonly errors: { message: string; meta: unknown }[] = [];
  override error(message: string, meta?: Record<string, unknown>): void {
    this.errors.push({ message, meta });
  }
}

function run(exception: unknown) {
  const reply = recordingReply();
  const host = {
    switchToHttp: () => ({
      getResponse: () => reply,
      getRequest: () => ({ url: '/api/v1/x', method: 'GET' }),
    }),
  } as unknown as ArgumentsHost;
  const logger = new SilentLogger();
  new ProblemDetailsFilter(logger).catch(exception, host);
  return { reply, logger, body: reply.body as ProblemDetails };
}

describe('ProblemDetailsFilter', () => {
  it('maps an AppError to its status, title, detail and code', () => {
    const { reply, body } = run(new AppError('ERP-AUTH-0001', 'bad login'));
    expect(reply.statusCode).toBe(401);
    expect(reply.headers['content-type']).toBe('application/problem+json');
    expect(body).toEqual({
      type: 'about:blank',
      status: 401,
      title: 'Invalid credentials',
      detail: 'bad login',
      code: 'ERP-AUTH-0001',
    });
  });

  it('sets Retry-After from extras.retryAfterS', () => {
    const { reply } = run(new AppError('ERP-AUTH-0006', undefined, { retryAfterS: 42 }));
    expect(reply.statusCode).toBe(429);
    expect(reply.headers['retry-after']).toBe('42');
  });

  it('maps UpstreamUnavailableError to 503 + Retry-After without a URL in the detail', () => {
    const { reply, body } = run(new UpstreamUnavailableError('legacy', 10));
    expect(reply.statusCode).toBe(503);
    expect(body.code).toBe('ERP-UPSTREAM-0001');
    expect(reply.headers['retry-after']).toBe('10');
    expect(body.detail).toBe('legacy is unavailable');
    expect(body.detail).not.toMatch(/https?:\/\//);
  });

  it('turns an unknown error into a 500 whose body never carries the message', () => {
    const { reply, body, logger } = run(new Error('db password is hunter2'));
    expect(reply.statusCode).toBe(500);
    expect(body.code).toBe('ERP-INTERNAL-0001');
    expect(body.detail).toBe('Internal error');
    expect(JSON.stringify(body)).not.toContain('hunter2');
    expect(logger.errors).toHaveLength(1);
  });

  it('passes a structured HttpException body through unchanged (health 503 report)', () => {
    const report = { status: 'degraded', checks: { db: 'error' } };
    const { reply } = run(new ServiceUnavailableException(report));
    expect(reply.statusCode).toBe(503);
    expect(reply.body).toEqual(report);
  });

  it('maps a string HttpException to ERP-HTTP-<status>', () => {
    const { reply, body } = run(new ServiceUnavailableException('draining'));
    expect(reply.statusCode).toBe(503);
    expect(body.code).toBe('ERP-HTTP-503');
    expect(body.detail).toBe('draining');
  });

  it('maps a @fastify/csrf-protection error to 403 ERP-AUTH-0008', () => {
    const { reply, body } = run({ code: 'FST_CSRF_INVALID_TOKEN' });
    expect(reply.statusCode).toBe(403);
    expect(body.code).toBe('ERP-AUTH-0008');
  });

  it('includes issues for ERP-VALIDATION-0001 and ERP-CORE-0013 (ADR-0040) and for no other code', () => {
    const issues = [{ path: ['name'] }];
    const carrying = Object.keys(ERROR_CODES)
      .filter((code) => run(new AppError(code as ErrorCode, undefined, { issues })).body.issues)
      .sort();
    expect(carrying).toEqual(['ERP-CORE-0013', 'ERP-VALIDATION-0001']);
    expect(run(new AppError('ERP-CORE-0013', undefined, { issues })).body.issues).toEqual(issues);
    expect(run(new AppError('ERP-CORE-0004', undefined, { issues })).body.issues).toBeUndefined();
  });
});

describe('problemBodyOf (the body tus answers for an upload hook refusal, ADR-0041)', () => {
  it.each([
    ['ERP-VALIDATION-0001', 400],
    ['ERP-AUTH-0004', 401],
    ['ERP-AUTH-0005', 403],
    ['ERP-CORE-0004', 404],
    ['ERP-FILES-0002', 413],
    ['ERP-FILES-0001', 422],
    ['ERP-INTERNAL-0001', 500],
    ['ERP-UPSTREAM-0001', 503],
  ] as const)('returns the body the filter writes for %s (%i)', (code, status) => {
    const error = new AppError(code, 'refused', { issues: [{ path: ['x'] }] });
    const body = problemBodyOf(error);
    expect(body).toEqual(run(error).body);
    expect(body.status).toBe(status);
    expect(body.code).toBe(code);
  });

  it('drops issues for a code outside ISSUE_CODES, such as ERP-CURRENCIES-0001', () => {
    const issues = [{ path: ['name'] }];
    expect(problemBodyOf(new AppError('ERP-CURRENCIES-0001', 'refused', { issues })).issues).toBe(
      undefined,
    );
  });
});

/**
 * The catalogue the filter reads: every key has the `ERP-<AREA>-NNNN` shape, and the shared codes
 * plan 04.2-02 allocated for W1 (ADR-0040, ADR-0041, the 04.2 UI-SPEC § Errors) carry exactly the
 * status the handler plans and erp-web map on. A code is never renumbered (BE-09), so a changed
 * status here is a contract break, not a refactor.
 */
const CODE_SHAPE = /^ERP-[A-Z]+-\d{4}$/;
const EM_DASH = String.fromCodePoint(0x2014);

/** The shared codes of plan 04.2-02's `<interfaces>`, with their statuses. */
const W1_CODES: Readonly<Record<string, number>> = {
  'ERP-CORE-0013': 412,
  'ERP-CORE-0014': 428,
  'ERP-FILES-0001': 422,
  'ERP-FILES-0002': 413,
};

const catalogue: Readonly<Record<string, { readonly status: number; readonly title: string }>> =
  ERROR_CODES;

describe('ERROR_CODES', () => {
  it('names every code ERP-<AREA>-NNNN', () => {
    const malformed = Object.keys(catalogue).filter((code) => !CODE_SHAPE.test(code));
    expect(malformed).toEqual([]);
  });

  it('writes no title with an em dash', () => {
    const dashed = Object.entries(catalogue)
      .filter(([, entry]) => entry.title.includes(EM_DASH))
      .map(([code]) => code);
    expect(dashed).toEqual([]);
  });

  it.each(Object.entries(W1_CODES))('carries the W1 code %s with status %i', (code, status) => {
    expect(catalogue[code]?.status).toBe(status);
    expect(catalogue[code]?.title.length ?? 0).toBeGreaterThan(0);
  });
});
