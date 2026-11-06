import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_VERIFIER } from '../../../shared/http/auth/access-token-verifier.js';
import { AuthFacade } from '../facade/auth.facade.js';
import { createAuthTestApp, type AuthTestApp } from './create-auth-test-app.js';

/**
 * These tests start a Nest app, hash with bcrypt or scan the whole source tree, so they can pass
 * the 5 s default on a busy machine. TEST-06: a slow test gets its own timeout and a reason.
 */
const SLOW_TEST_TIMEOUT_MS = 30_000;

describe('AuthFacade', () => {
  let ctx: AuthTestApp;

  beforeAll(async () => {
    ctx = await createAuthTestApp();
  }, SLOW_TEST_TIMEOUT_MS);

  afterAll(async () => {
    await ctx.close();
  });

  it(
    'resolves through the module with every layer injected',
    () => {
      expect(ctx.moduleRef.get(AuthFacade).describe()).toEqual({ module: 'auth', version: 1 });
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'is the ACCESS_TOKEN_VERIFIER instance the shared guards resolve',
    () => {
      expect(ctx.moduleRef.get(ACCESS_TOKEN_VERIFIER)).toBe(ctx.moduleRef.get(AuthFacade));
    },
    SLOW_TEST_TIMEOUT_MS,
  );

  it(
    'verifyAccessToken answers null for garbage and hasPermission false for an unknown staff id',
    async () => {
      const facade = ctx.moduleRef.get(AuthFacade);
      expect(await facade.verifyAccessToken('not.a.jwt')).toBeNull();
      expect(await facade.hasPermission(999_999, 'invoices.view')).toBe(false);
    },
    SLOW_TEST_TIMEOUT_MS,
  );
});
