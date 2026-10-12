import { describe, expect, it } from 'vitest';
import {
  REQUEST_ID_HEADER,
  bindStaffId,
  getRequestContext,
  isValidRequestId,
  newRequestId,
  runWithRequestContext,
} from '../request-context.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function tick(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('request context scope', () => {
  it('is undefined outside a scope', () => {
    expect(getRequestContext()).toBeUndefined();
  });

  it('gives two concurrent scopes their own id across interleaved awaits', async () => {
    const seen = await Promise.all([
      runWithRequestContext({ requestId: 'a' }, async () => {
        await tick(5);
        const first = getRequestContext()?.requestId;
        await tick(10);
        return [first, getRequestContext()?.requestId];
      }),
      runWithRequestContext({ requestId: 'b' }, async () => {
        await tick(1);
        const first = getRequestContext()?.requestId;
        await tick(7);
        return [first, getRequestContext()?.requestId];
      }),
    ]);
    expect(seen).toEqual([
      ['a', 'a'],
      ['b', 'b'],
    ]);
    expect(getRequestContext()).toBeUndefined();
  });

  it('bindStaffId mutates the current scope and is a no-op outside one', () => {
    expect(() => {
      bindStaffId(7);
    }).not.toThrow();
    expect(getRequestContext()).toBeUndefined();

    runWithRequestContext({ requestId: 'r1' }, () => {
      expect(getRequestContext()?.staffId).toBeUndefined();
      bindStaffId(7);
      expect(getRequestContext()).toEqual({ requestId: 'r1', staffId: 7 });
    });
  });

  it('names the header in lower case', () => {
    expect(REQUEST_ID_HEADER).toBe('x-request-id');
  });
});

describe('isValidRequestId (T-2-01)', () => {
  it('accepts letters, digits, dot, underscore, dash up to 64 characters', () => {
    expect(isValidRequestId('abc-123.x_9')).toBe(true);
    expect(isValidRequestId('a'.repeat(64))).toBe(true);
    expect(isValidRequestId(newRequestId())).toBe(true);
  });

  it('rejects empty, over-long, whitespace, newline (header injection) and non-string values', () => {
    expect(isValidRequestId('')).toBe(false);
    expect(isValidRequestId('a'.repeat(65))).toBe(false);
    expect(isValidRequestId('bad id')).toBe(false);
    expect(isValidRequestId('bad\nid')).toBe(false);
    expect(isValidRequestId('bad\r\nx-forged: 1')).toBe(false);
    expect(isValidRequestId(['abc', 'def'])).toBe(false);
    expect(isValidRequestId(undefined)).toBe(false);
    expect(isValidRequestId(42)).toBe(false);
  });
});

describe('newRequestId', () => {
  it('mints a v4 UUID, different every call', () => {
    const a = newRequestId();
    expect(a).toMatch(UUID);
    expect(newRequestId()).not.toBe(a);
  });
});
