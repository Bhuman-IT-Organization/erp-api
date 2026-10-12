/**
 * The per-request context: an `AsyncLocalStorage` scope
 * opened by the `x-request-id` hook (`shared/http/request-id.ts`) before any other hook, guard,
 * handler or filter runs, so `LoggerService` can stamp `requestId` — and `staffId` once
 * `JwtAuthGuard` has verified the bearer — on every line without threading a parameter.
 *
 * Nothing here reads a header or touches Fastify: the hook owns the boundary, this file owns the
 * scope and the id grammar. Outside a request (boot, a job, a unit test) there is no scope and
 * every reader answers `undefined` or does nothing.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  readonly requestId: string;
  staffId?: number;
}

/** Lower-case: Fastify lower-cases incoming header names, and the response echoes the same name. */
export const REQUEST_ID_HEADER = 'x-request-id' as const;

/**
 * A client-supplied id is echoed only when it is safe to write into a header and a log line:
 * no whitespace, no CR/LF, no control characters, bounded length (threat T-2-01). A UUID
 * matches; a base64 value with `+` or `/` does not and is replaced, never echoed.
 */
const REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

export const requestContext = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn);
}

/** Called by `JwtAuthGuard` after verification; a no-op outside a request scope. */
export function bindStaffId(staffId: number): void {
  const ctx = requestContext.getStore();
  if (ctx !== undefined) ctx.staffId = staffId;
}

/** `^[A-Za-z0-9._-]{1,64}$` — anything else (arrays included) is replaced, never echoed (T-2-01). */
export function isValidRequestId(value: unknown): value is string {
  return typeof value === 'string' && REQUEST_ID.test(value);
}

export function newRequestId(): string {
  return randomUUID();
}
