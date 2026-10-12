import { describe, expect, it } from 'vitest';
import { REDACT_KEYS, redact } from '../redact.js';

describe('redact', () => {
  it('replaces password, authorization and cookie values at any depth and keeps siblings', () => {
    const out = redact({
      body: { password: 'x', email: 'a@b.c' },
      headers: { authorization: 'Bearer abc', cookie: 'erp_refresh=1' },
    }) as { body: Record<string, unknown>; headers: Record<string, unknown> };
    expect(out.body.password).toBe('[REDACTED]');
    expect(out.body.email).toBe('a@b.c');
    expect(out.headers.authorization).toBe('[REDACTED]');
    expect(out.headers.cookie).toBe('[REDACTED]');
  });

  it('walks arrays and masks bearer strings wherever they appear', () => {
    const out = redact({ items: [{ token: 't' }, 'Bearer eyJhbGci.x.y', 'plain'] }) as {
      items: unknown[];
    };
    expect(out.items[0]).toEqual({ token: '[REDACTED]' });
    expect(out.items[1]).toBe('Bearer [REDACTED]');
    expect(out.items[2]).toBe('plain');
  });

  it('does not throw on a cyclic object', () => {
    const cyclic: Record<string, unknown> = { name: 'n' };
    cyclic.self = cyclic;
    expect(() => redact(cyclic)).not.toThrow();
    expect((redact(cyclic) as { self: unknown }).self).toBe('[Circular]');
  });

  it('redacts a bcrypt hash under passwordHash and matches keys case-insensitively', () => {
    const out = redact({ passwordHash: '$2y$12$abcdefghijklmnopqrstuv', PEM: 'x' }) as Record<
      string,
      unknown
    >;
    expect(out.passwordHash).toBe('[REDACTED]');
    expect(out.PEM).toBe('[REDACTED]');
    expect(REDACT_KEYS.test('Set-Cookie')).toBe(true);
    expect(REDACT_KEYS.test('email')).toBe(false);
  });

  it('does not mutate the input', () => {
    const input = { password: 'x' };
    redact(input);
    expect(input.password).toBe('x');
  });

  it("redacts nodemailer's auth.pass and SMTP_PASSWORD at any depth and keeps the user (ADR-0049, T-4.3-06)", () => {
    const out = redact({
      options: { auth: { user: 'u', pass: 'pw-not-a-secret' } },
      env: { SMTP_PASSWORD: 'pw-not-a-secret' },
      deep: [{ nested: { smtpPassword: 'pw-not-a-secret' } }],
    });
    expect(JSON.stringify(out)).not.toContain('pw-not-a-secret');
    const typed = out as {
      options: { auth: Record<string, unknown> };
      env: Record<string, unknown>;
    };
    expect(typed.options.auth.pass).toBe('[REDACTED]');
    expect(typed.options.auth.user).toBe('u');
    expect(typed.env.SMTP_PASSWORD).toBe('[REDACTED]');
  });
  it('redacts the public shipment hash header at any depth, in any letter case (ADR-0051 decision 3)', () => {
    const out = redact({
      headers: { 'x-shipment-hash': 'abc', host: 'h' },
      deep: [{ request: { 'X-Shipment-Hash': 'abc' } }],
    });
    expect(JSON.stringify(out)).not.toContain('abc');
    const typed = out as { headers: Record<string, unknown> };
    expect(typed.headers['x-shipment-hash']).toBe('[REDACTED]');
    expect(typed.headers.host).toBe('h');
    expect(REDACT_KEYS.test('X-Shipment-Hash')).toBe(true);
    expect(REDACT_KEYS.test('x-shipment-hashes')).toBe(false);
  });
});
