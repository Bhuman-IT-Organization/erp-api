import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ACCESS_TOKEN_VERIFIER } from '../../../shared/http/auth/access-token-verifier.js';
import { AuthFacade } from '../facade/auth.facade.js';
import { createAuthTestApp, type AuthTestApp } from './create-auth-test-app.js';

describe('AuthFacade', () => {
  let ctx: AuthTestApp;

  beforeAll(async () => {
    ctx = await createAuthTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('resolves through the module with every layer injected', () => {
    expect(ctx.moduleRef.get(AuthFacade).describe()).toEqual({ module: 'auth', version: 1 });
  });

  it('is the ACCESS_TOKEN_VERIFIER instance the shared guards resolve', () => {
    expect(ctx.moduleRef.get(ACCESS_TOKEN_VERIFIER)).toBe(ctx.moduleRef.get(AuthFacade));
  });

  it('verifyAccessToken answers null for garbage and hasPermission false for an unknown staff id', async () => {
    const facade = ctx.moduleRef.get(AuthFacade);
    expect(await facade.verifyAccessToken('not.a.jwt')).toBeNull();
    expect(await facade.hasPermission(999_999, 'invoices.view')).toBe(false);
  });
});
