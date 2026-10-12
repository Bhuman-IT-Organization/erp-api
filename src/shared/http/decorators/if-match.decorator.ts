/**
 * `@IfMatch()`: the fingerprint an opted-in PATCH or PUT must send (ADR-0040). A missing, empty or
 * `*` header is 428 `ERP-CORE-0014`, so a client can never skip the stale check by leaving the
 * header out; the handler passes the value to the repository, which compares it with `assertFresh`
 * under the row lock. `DELETE` does not take it (ADR-0040 §6).
 */
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../errors/app-error.js';

const WILDCARD = '*';

/** Exported so the decorator's behaviour can be unit-tested without Nest's decorator plumbing. */
export function ifMatchFrom(ctx: ExecutionContext): string {
  const header = ctx.switchToHttp().getRequest<FastifyRequest>().headers['if-match'];
  const value = typeof header === 'string' ? header.trim() : '';
  if (value === '' || value === WILDCARD) throw new AppError('ERP-CORE-0014');
  return value;
}

/** The trimmed `If-Match` header; throws 428 `ERP-CORE-0014` when it is missing, empty or `*`. */
export const IfMatch = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  ifMatchFrom(ctx),
);
