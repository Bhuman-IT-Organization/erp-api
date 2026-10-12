import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import type { StaffIdentity } from '../model/auth.model.js';
import { AuthValidator } from '../service/auth.validator.js';

const staff: StaffIdentity = {
  staffId: 7,
  email: 'someone@example.test',
  firstName: 'Some',
  lastName: 'One',
  isAdmin: false,
  roleId: 2,
  active: true,
  twoFactorEnabled: false,
  passwordHash: '$2y$12$fixture-not-a-real-hash',
  locale: null,
};

function thrown(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('AuthValidator', () => {
  const validator = new AuthValidator();

  it('parses a valid body and normalises the e-mail (trimmed, lowercased)', () => {
    const dto = validator.parseLoginRequest({ email: '  Someone@Example.TEST ', password: 'pw' });
    expect(dto).toEqual({ email: 'someone@example.test', password: 'pw' });
  });

  it('rejects an invalid body with ERP-VALIDATION-0001 (400) and the zod issues', () => {
    const error = thrown(() => validator.parseLoginRequest({ email: 'x' }));
    expect(error.code).toBe('ERP-VALIDATION-0001');
    expect(error.status).toBe(400);
    expect(Array.isArray(error.extras?.issues)).toBe(true);
    expect((error.extras?.issues as unknown[]).length).toBeGreaterThan(0);
  });

  it('rejects a non-object body the same way', () => {
    expect(thrown(() => validator.parseLoginRequest('email=x')).code).toBe('ERP-VALIDATION-0001');
    expect(thrown(() => validator.parseLoginRequest(null)).code).toBe('ERP-VALIDATION-0001');
  });

  it('strips unknown keys from the parsed body', () => {
    const dto = validator.parseLoginRequest({
      email: 'a@b.test',
      password: 'pw',
      admin: true,
    });
    expect(Object.keys(dto).sort()).toEqual(['email', 'password']);
  });

  it('refuses an inactive account with the generic ERP-AUTH-0001 and reason inactive', () => {
    const inactive = { ...staff, active: false };
    const error = thrown(() => {
      validator.assertCanLogin(inactive);
    });
    expect(error.code).toBe('ERP-AUTH-0001');
    expect(error.status).toBe(401);
    expect(error.message).not.toMatch(/inactive/i);
    expect(validator.refusalReason(inactive)).toBe('inactive');
  });

  it('refuses a two-factor account with ERP-AUTH-0007 and reason two_factor', () => {
    const twoFactor = { ...staff, twoFactorEnabled: true };
    const error = thrown(() => {
      validator.assertCanLogin(twoFactor);
    });
    expect(error.code).toBe('ERP-AUTH-0007');
    expect(error.status).toBe(403);
    expect(validator.refusalReason(twoFactor)).toBe('two_factor');
  });

  it('inactive wins over two-factor (the generic refusal first)', () => {
    const both = { ...staff, active: false, twoFactorEnabled: true };
    expect(validator.refusalReason(both)).toBe('inactive');
    expect(
      thrown(() => {
        validator.assertCanLogin(both);
      }).code,
    ).toBe('ERP-AUTH-0001');
  });

  it('lets an active, non-2FA account through with reason null', () => {
    expect(() => {
      validator.assertCanLogin(staff);
    }).not.toThrow();
    expect(validator.refusalReason(staff)).toBeNull();
  });
});
