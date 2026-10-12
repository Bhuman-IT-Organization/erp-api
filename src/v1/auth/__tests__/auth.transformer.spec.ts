import { describe, expect, it } from 'vitest';
import type { IssuedTokens, PermissionSnapshot, StaffIdentity } from '../model/auth.model.js';
import { AuthTransformer } from '../service/auth.transformer.js';

const staff: StaffIdentity = {
  staffId: 12,
  email: 'someone@example.test',
  firstName: 'Some',
  lastName: 'One',
  isAdmin: false,
  roleId: 2,
  active: true,
  twoFactorEnabled: false,
  passwordHash: '$2y$12$fixture-not-a-real-hash-value-of-sixty-characters-xxxxxxx',
  locale: 'ar',
};

const tokens: IssuedTokens = {
  accessToken: 'header.payload.signature',
  expiresIn: 900,
  refreshToken: '12.sid-value.secret-value-base64url',
  jti: 'jti-value',
  sid: 'sid-value',
};

const snapshot: PermissionSnapshot = {
  v: 1,
  staffId: 12,
  isAdmin: false,
  roleId: 2,
  codes: ['invoices.view', 'tasks.create'],
  builtAt: '2026-09-19T10:00:00.000Z',
};

/** Substrings that must never appear in a serialised DTO (T-1.3-43). */
const FORBIDDEN = [
  'passwordHash',
  '$2',
  'refreshToken',
  tokens.refreshToken,
  'secret-value',
  'jti',
  'sid-value',
];

describe('AuthTransformer', () => {
  const transformer = new AuthTransformer();

  it('toLoginResponse carries the bearer token, expiry, csrf token and the public user fields', () => {
    const dto = transformer.toLoginResponse(tokens, staff, 'csrf-value');
    expect(dto.tokenType).toBe('Bearer');
    expect(dto.accessToken).toBe(tokens.accessToken);
    expect(dto.expiresIn).toBe(900);
    expect(dto.csrfToken).toBe('csrf-value');
    expect(dto.user).toEqual({
      staffId: 12,
      email: 'someone@example.test',
      firstName: 'Some',
      lastName: 'One',
      isAdmin: false,
      locale: 'ar',
    });
  });

  it('carries locale null on both DTOs when the staff row has no mapped language', () => {
    const unmapped: StaffIdentity = { ...staff, locale: null };
    expect(transformer.toLoginResponse(tokens, unmapped, 'csrf-value').user.locale).toBeNull();
    expect(transformer.toMeResponse(unmapped, snapshot, []).locale).toBeNull();
  });

  it('toLoginResponse leaks no hash, refresh token, jti or sid', () => {
    const dto = transformer.toLoginResponse(tokens, staff, 'csrf-value');
    const serialised = JSON.stringify(dto);
    for (const needle of FORBIDDEN) expect(serialised).not.toContain(needle);
    expect(Object.keys(dto).sort()).toEqual([
      'accessToken',
      'csrfToken',
      'expiresIn',
      'tokenType',
      'user',
    ]);
  });

  it('toMeResponse carries roleId and the snapshot codes as permissions', () => {
    const dto = transformer.toMeResponse(staff, snapshot, []);
    expect(dto).toEqual({
      staffId: 12,
      email: 'someone@example.test',
      firstName: 'Some',
      lastName: 'One',
      isAdmin: false,
      roleId: 2,
      permissions: ['invoices.view', 'tasks.create'],
      locale: 'ar',
      disabledModules: [],
    });
  });

  it('toMeResponse names the switched-off modules (ADR-0042)', () => {
    expect(transformer.toMeResponse(staff, snapshot, ['example']).disabledModules).toEqual([
      'example',
    ]);
  });

  it('toMeResponse leaks no hash and no session material', () => {
    const serialised = JSON.stringify(transformer.toMeResponse(staff, snapshot, []));
    for (const needle of FORBIDDEN) expect(serialised).not.toContain(needle);
  });

  it('strips an extra field smuggled through a wider identity object', () => {
    const wider = { ...staff, token: 'legacy-api-token', google_auth_secret: 'x' } as StaffIdentity;
    const serialised = JSON.stringify(transformer.toMeResponse(wider, snapshot, []));
    expect(serialised).not.toContain('legacy-api-token');
    expect(serialised).not.toContain('google_auth_secret');
  });
});
