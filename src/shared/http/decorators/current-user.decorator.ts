import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../errors/app-error.js';
import type { AuthenticatedUser } from '../auth/access-token-verifier.js';

/** Exported so the decorator's behaviour can be unit-tested without Nest's decorator plumbing. */
export function currentUserFrom(ctx: ExecutionContext): AuthenticatedUser {
  const { user } = ctx.switchToHttp().getRequest<FastifyRequest>();
  // A handler that reads the user without JwtAuthGuard is a programming error surfaced as 401,
  // not a crash on `undefined` (threat T-1.3-09).
  if (user === undefined) throw new AppError('ERP-AUTH-0004');
  return user;
}

/** The `AuthenticatedUser` set by `JwtAuthGuard`; throws ERP-AUTH-0004 when the guard did not run. */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  currentUserFrom(ctx),
);
