import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../errors/app-error.js';
import type { AccessTokenVerifier, AuthenticatedUser } from '../../auth/access-token-verifier.js';
import {
  PERMISSIONS_ANY_KEY,
  PERMISSIONS_KEY,
  Permissions,
  PermissionsAny,
} from '../../decorators/permissions.decorator.js';
import type { ReadScope } from '../../decorators/scope.decorator.js';
import { PermissionGuard } from '../permission.guard.js';

const user: AuthenticatedUser = {
  staffId: 7,
  sessionId: 's1',
  jti: 'j1',
  isAdmin: false,
  roleId: 2,
  tokenVersion: 1,
  expiresAt: 2_000_000_000,
};

/** A handler carrying the metadata `@Permissions(...)` writes (same key, same shape). */
function handlerWith(...codes: string[]): () => void {
  const handler = (): void => undefined;
  if (codes.length > 0) Reflect.defineMetadata(PERMISSIONS_KEY, codes, handler);
  return handler;
}

/** A handler carrying what `@PermissionsAny(...)` writes, optionally beside an all-of list. */
function handlerWithAny(anyCodes: string[], allCodes: string[] = []): () => void {
  const handler = handlerWith(...allCodes);
  if (anyCodes.length > 0) Reflect.defineMetadata(PERMISSIONS_ANY_KEY, anyCodes, handler);
  return handler;
}

class Controller {
  handle(): void {
    return undefined;
  }
}

interface GuardedRequest {
  user?: AuthenticatedUser;
  erpReadScope?: ReadScope;
}

/** The context plus the request object, so a case can read the scope the guard resolved. */
function requestContext(handler: () => void, withUser: boolean) {
  const request: GuardedRequest = withUser ? { user } : {};
  const ctx = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => handler,
    getClass: () => Controller,
  } as unknown as ExecutionContext;
  return { ctx, request };
}

function context(handler: () => void, withUser: boolean) {
  return requestContext(handler, withUser).ctx;
}

function verifier(granted: Record<string, boolean>) {
  const calls: [number, string][] = [];
  const port: AccessTokenVerifier = {
    verifyAccessToken: () => Promise.resolve(user),
    hasPermission: (staffId, code) => {
      calls.push([staffId, code]);
      return Promise.resolve(granted[code] ?? false);
    },
  };
  return { port, calls };
}

/** ADR-0033 decision 4: the verifier answers true for every code when the caller is an admin. */
function adminVerifier() {
  const calls: [number, string][] = [];
  const port: AccessTokenVerifier = {
    verifyAccessToken: () => Promise.resolve(user),
    hasPermission: (staffId, code) => {
      calls.push([staffId, code]);
      return Promise.resolve(true);
    },
  };
  return { port, calls };
}

async function failure(promise: Promise<unknown>): Promise<AppError | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return error instanceof AppError ? error : undefined;
  }
}

describe('Permissions decorator', () => {
  it('stores the codes under PERMISSIONS_KEY on the decorated class', () => {
    class Own {
      handle(): void {
        return undefined;
      }
    }
    Permissions('a.read', 'a.write')(Own);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, Own)).toEqual(['a.read', 'a.write']);
  });
});

describe('PermissionsAny decorator', () => {
  it('stores the codes under its own key, leaving PERMISSIONS_KEY untouched (T-3.1-10)', () => {
    class Own {
      handle(): void {
        return undefined;
      }
    }
    PermissionsAny('a.view', 'a.viewOwn')(Own);
    expect(Reflect.getMetadata(PERMISSIONS_ANY_KEY, Own)).toEqual(['a.view', 'a.viewOwn']);
    expect(Reflect.getMetadata(PERMISSIONS_KEY, Own)).toBeUndefined();
  });
});

describe('PermissionGuard', () => {
  it('passes a handler without @Permissions without consulting the verifier', async () => {
    const { port, calls } = verifier({});
    const guard = new PermissionGuard(new Reflector(), port);
    await expect(guard.canActivate(context(handlerWith(), false))).resolves.toBe(true);
    expect(calls).toEqual([]);
  });

  it('throws ERP-AUTH-0004 when @Permissions is set but no user was attached (guard order)', async () => {
    const { port, calls } = verifier({ 'a.read': true });
    const guard = new PermissionGuard(new Reflector(), port);
    const error = await failure(guard.canActivate(context(handlerWith('a.read'), false)));
    expect(error?.code).toBe('ERP-AUTH-0004');
    expect(calls).toEqual([]);
  });

  it('throws ERP-AUTH-0005 naming the first missing code when one of two is denied', async () => {
    const { port } = verifier({ 'a.read': true, 'a.write': false });
    const guard = new PermissionGuard(new Reflector(), port);
    const error = await failure(guard.canActivate(context(handlerWith('a.read', 'a.write'), true)));
    expect(error?.code).toBe('ERP-AUTH-0005');
    expect(error?.message).toBe('Missing permission a.write');
  });

  it('passes when every code is granted, asking the verifier for the user staffId', async () => {
    const { port, calls } = verifier({ 'a.read': true, 'a.write': true });
    const guard = new PermissionGuard(new Reflector(), port);
    await expect(guard.canActivate(context(handlerWith('a.read', 'a.write'), true))).resolves.toBe(
      true,
    );
    expect(calls).toEqual([
      [7, 'a.read'],
      [7, 'a.write'],
    ]);
  });

  it('neither key set: the short circuit holds and no scope is written onto the request', async () => {
    const { port } = verifier({});
    const guard = new PermissionGuard(new Reflector(), port);
    const { ctx, request } = requestContext(handlerWith(), false);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.erpReadScope).toBeUndefined();
  });

  it('an all-of handler with no any-of form resolves the widest scope, all', async () => {
    const { port } = verifier({ 'a.read': true });
    const guard = new PermissionGuard(new Reflector(), port);
    const { ctx, request } = requestContext(handlerWith('a.read'), true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.erpReadScope).toBe('all');
  });
});

describe('PermissionGuard — the any-of form and the ADR-0033 decision 5 row scope', () => {
  it('admits on the first (widest) code and resolves the scope all', async () => {
    const { port, calls } = verifier({ 'a.view': true, 'a.viewOwn': false });
    const guard = new PermissionGuard(new Reflector(), port);
    const { ctx, request } = requestContext(handlerWithAny(['a.view', 'a.viewOwn']), true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.erpReadScope).toBe('all');
    // It stops at the first held code — the narrower one is never asked about.
    expect(calls).toEqual([[7, 'a.view']]);
  });

  it('admits on the second code alone and resolves the scope own', async () => {
    const { port, calls } = verifier({ 'a.view': false, 'a.viewOwn': true });
    const guard = new PermissionGuard(new Reflector(), port);
    const { ctx, request } = requestContext(handlerWithAny(['a.view', 'a.viewOwn']), true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.erpReadScope).toBe('own');
    expect(calls).toEqual([
      [7, 'a.view'],
      [7, 'a.viewOwn'],
    ]);
  });

  it('throws ERP-AUTH-0005 naming every code when none of them holds', async () => {
    const { port } = verifier({});
    const guard = new PermissionGuard(new Reflector(), port);
    const { ctx, request } = requestContext(handlerWithAny(['a.view', 'a.viewOwn']), true);
    const error = await failure(guard.canActivate(ctx));
    expect(error?.code).toBe('ERP-AUTH-0005');
    expect(error?.message).toBe('Missing permission a.view or a.viewOwn');
    expect(request.erpReadScope).toBeUndefined();
  });

  it('throws ERP-AUTH-0004 when the any-of form is set but no user was attached', async () => {
    const { port, calls } = verifier({ 'a.view': true });
    const guard = new PermissionGuard(new Reflector(), port);
    const error = await failure(guard.canActivate(context(handlerWithAny(['a.view']), false)));
    expect(error?.code).toBe('ERP-AUTH-0004');
    expect(calls).toEqual([]);
  });

  it('T-3.1-10: both forms on one handler — the all-of code is still required', async () => {
    const { port } = verifier({ 'a.write': false, 'a.view': true, 'a.viewOwn': true });
    const guard = new PermissionGuard(new Reflector(), port);
    const { ctx, request } = requestContext(
      handlerWithAny(['a.view', 'a.viewOwn'], ['a.write']),
      true,
    );
    const error = await failure(guard.canActivate(ctx));
    expect(error?.code).toBe('ERP-AUTH-0005');
    expect(error?.message).toBe('Missing permission a.write');
    expect(request.erpReadScope).toBeUndefined();
  });

  it('T-3.1-10: both forms held — the all-of passes and the any-of still decides the scope', async () => {
    const { port } = verifier({ 'a.write': true, 'a.view': false, 'a.viewOwn': true });
    const guard = new PermissionGuard(new Reflector(), port);
    const { ctx, request } = requestContext(
      handlerWithAny(['a.view', 'a.viewOwn'], ['a.write']),
      true,
    );
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.erpReadScope).toBe('own');
  });

  it('ADR-0033 d.4: an admin resolves all through the ordinary path, with no branch in the guard', async () => {
    const { port, calls } = adminVerifier();
    const guard = new PermissionGuard(new Reflector(), port);
    const { ctx, request } = requestContext(handlerWithAny(['a.view', 'a.viewOwn']), true);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.erpReadScope).toBe('all');
    expect(calls).toEqual([[7, 'a.view']]);
  });
});
