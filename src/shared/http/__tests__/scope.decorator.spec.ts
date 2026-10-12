/**
 * `scopeFrom` — the plain function `@Scope()` wraps — against a fake `ExecutionContext`, so the
 * behaviour is proven without Nest's decorator plumbing (the `current-user.decorator.ts` idiom).
 * It reads what `PermissionGuard` resolved and nothing else: it never consults the verifier and
 * never widens (threat T-3.1-12).
 */
import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import type { AuthenticatedUser } from '../auth/access-token-verifier.js';
import { READ_SCOPES, scopeFrom, type ReadScope } from '../decorators/scope.decorator.js';

const user: AuthenticatedUser = {
  staffId: 7,
  sessionId: 's1',
  jti: 'j1',
  isAdmin: false,
  roleId: 2,
  tokenVersion: 1,
  expiresAt: 2_000_000_000,
};

function context(request: {
  user?: AuthenticatedUser;
  erpReadScope?: ReadScope;
}): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('READ_SCOPES', () => {
  it('lists the two scopes widest first, matching the any-of declaration order', () => {
    expect(READ_SCOPES).toEqual(['all', 'own']);
  });
});

describe('scopeFrom', () => {
  it('returns own when the guard resolved own', () => {
    expect(scopeFrom(context({ user, erpReadScope: 'own' }))).toBe('own');
  });

  it('returns all when the guard resolved all', () => {
    expect(scopeFrom(context({ user, erpReadScope: 'all' }))).toBe('all');
  });

  it('defaults to all when no any-of form narrowed the request', () => {
    expect(scopeFrom(context({ user }))).toBe('all');
  });

  it('throws ERP-AUTH-0004 when no user was attached (JwtAuthGuard did not run)', () => {
    let thrown: unknown;
    try {
      scopeFrom(context({ erpReadScope: 'own' }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(AppError);
    expect((thrown as AppError).code).toBe('ERP-AUTH-0004');
  });
});
