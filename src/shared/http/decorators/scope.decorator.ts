/**
 * The row scope of a read, as resolved by `PermissionGuard` (ADR-0033 decision 5): `all` when the
 * caller holds the full-view code of an `@PermissionsAny(VIEW, VIEW_OWN)` handler, `own` when only
 * the `viewOwn` code admitted. An administrator holds every code, so an admin resolves to `all`
 * through the ordinary path and the guard carries no `isAdmin` branch (ADR-0033 decision 4).
 *
 * This file deliberately decides nothing. It reads what the guard wrote onto the request and hands
 * it to the handler — the guard is the only writer, so a handler can never widen its own scope
 * (threat T-3.1-12). A handler that declares no any-of form was never narrowed and reads `all`,
 * which is what every all-of handler did before this decorator existed. What it does not do: it
 * does not consult the verifier, it does not look at `isAdmin`, and it does not filter rows —
 * the filter is the repository's job.
 */
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../errors/app-error.js';

/** The two row scopes a read guard can resolve; widest first, in the any-of declaration order. */
export const READ_SCOPES = ['all', 'own'] as const;

export type ReadScope = (typeof READ_SCOPES)[number];

declare module 'fastify' {
  interface FastifyRequest {
    /** Written by `PermissionGuard` only (ADR-0033 decision 5); read by `scopeFrom`. */
    erpReadScope?: ReadScope;
  }
}

/** Exported so the decorator's behaviour can be unit-tested without Nest's decorator plumbing. */
export function scopeFrom(ctx: ExecutionContext): ReadScope {
  const request = ctx.switchToHttp().getRequest<FastifyRequest>();
  // A handler that reads the scope without JwtAuthGuard is a programming error surfaced as 401,
  // not a crash on `undefined` (threat T-1.3-09) — the same rule as `currentUserFrom`.
  if (request.user === undefined) throw new AppError('ERP-AUTH-0004');
  return request.erpReadScope ?? 'all';
}

/** The `ReadScope` `PermissionGuard` resolved; throws ERP-AUTH-0004 when the guard did not run. */
export const Scope = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  scopeFrom(ctx),
);
