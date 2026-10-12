import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../errors/app-error.js';
import type { AccessTokenVerifier, AuthenticatedUser } from '../../auth/access-token-verifier.js';
import { getRequestContext, runWithRequestContext } from '../../../logger/request-context.js';
import { currentUserFrom } from '../../decorators/current-user.decorator.js';
import { JwtAuthGuard } from '../jwt-auth.guard.js';

const user: AuthenticatedUser = {
  staffId: 7,
  sessionId: 's1',
  jti: 'j1',
  isAdmin: false,
  roleId: 2,
  tokenVersion: 1,
  expiresAt: 2_000_000_000,
};

function context(headers: Record<string, string>) {
  const request: { headers: Record<string, string>; user?: AuthenticatedUser } = { headers };
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  return { ctx, request };
}

function verifier(result: AuthenticatedUser | null) {
  const calls: string[] = [];
  const port: AccessTokenVerifier = {
    verifyAccessToken: (token) => {
      calls.push(token);
      return Promise.resolve(result);
    },
    hasPermission: () => Promise.resolve(true),
  };
  return { port, calls };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error.code : 'not-an-AppError';
  }
}

describe('JwtAuthGuard', () => {
  it('rejects a request without an Authorization header with ERP-AUTH-0004', async () => {
    const { port, calls } = verifier(user);
    const { ctx } = context({});
    expect(await codeOf(new JwtAuthGuard(port).canActivate(ctx))).toBe('ERP-AUTH-0004');
    expect(calls).toEqual([]);
  });

  it('rejects a non-bearer scheme with ERP-AUTH-0004 without calling the verifier', async () => {
    const { port, calls } = verifier(user);
    const { ctx } = context({ authorization: 'Basic dXNlcjpwdw==' });
    expect(await codeOf(new JwtAuthGuard(port).canActivate(ctx))).toBe('ERP-AUTH-0004');
    expect(calls).toEqual([]);
  });

  it('rejects a token the verifier answers null for with ERP-AUTH-0004', async () => {
    const { port } = verifier(null);
    const { ctx, request } = context({ authorization: 'Bearer abc.def.ghi' });
    expect(await codeOf(new JwtAuthGuard(port).canActivate(ctx))).toBe('ERP-AUTH-0004');
    expect(request.user).toBeUndefined();
  });

  it('accepts a valid bearer token, hands the bare token to the verifier and sets request.user', async () => {
    const { port, calls } = verifier(user);
    const { ctx, request } = context({ authorization: 'bearer   abc.def.ghi' });
    await expect(new JwtAuthGuard(port).canActivate(ctx)).resolves.toBe(true);
    expect(calls).toEqual(['abc.def.ghi']);
    expect(request.user).toBe(user);
  });

  it('binds the verified staffId to the request context (T-2-03)', async () => {
    const { port } = verifier(user);
    const { ctx } = context({ authorization: 'Bearer abc.def.ghi' });
    await runWithRequestContext({ requestId: 'r1' }, async () => {
      await expect(new JwtAuthGuard(port).canActivate(ctx)).resolves.toBe(true);
      expect(getRequestContext()?.staffId).toBe(user.staffId);
    });
    expect(getRequestContext()).toBeUndefined();
  });

  it('rejects a bearer header with trailing garbage', async () => {
    const { port, calls } = verifier(user);
    const { ctx } = context({ authorization: 'Bearer abc def' });
    expect(await codeOf(new JwtAuthGuard(port).canActivate(ctx))).toBe('ERP-AUTH-0004');
    expect(calls).toEqual([]);
  });
});

describe('CurrentUser', () => {
  it('returns request.user when the guard ran and throws ERP-AUTH-0004 when it did not', () => {
    const { ctx, request } = context({});
    expect(() => currentUserFrom(ctx)).toThrow(AppError);
    request.user = user;
    expect(currentUserFrom(ctx)).toBe(user);
  });
});
