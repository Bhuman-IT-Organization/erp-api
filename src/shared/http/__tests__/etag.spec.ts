import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import { ifMatchFrom } from '../decorators/if-match.decorator.js';
import { assertBatchFresh, assertFresh, canonicalJson, etagOf } from '../etag.js';

/** The error a call throws, or a failure when it returns. */
function thrown(call: () => unknown): AppError {
  try {
    call();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

/** A Nest context whose request carries only the given headers. */
function contextWith(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext;
}

const ITEM = { id: 7, description: 'Bolt', rate: '1.50', tags: [3, 1] };

describe('canonicalJson', () => {
  it('sorts keys, keeps array order and writes undefined and null as null', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: undefined }] })).toBe(
      '{"a":[2,{"c":null,"d":null}],"b":1}',
    );
  });

  it('serialises a Date and a Prisma-like decimal through toJSON', () => {
    expect(canonicalJson({ at: new Date('2026-09-29T00:00:00.000Z') })).toBe(
      '{"at":"2026-09-29T00:00:00.000Z"}',
    );
    expect(canonicalJson({ rate: { toJSON: () => '1.50' } })).toBe('{"rate":"1.50"}');
  });

  it('writes a bigint as the JSON string of its decimal', () => {
    expect(canonicalJson({ n: 12n })).toBe('{"n":"12"}');
  });
});

describe('etagOf', () => {
  it('is a quoted base64url sha-256 of 43 characters', () => {
    expect(etagOf(ITEM)).toMatch(/^"[A-Za-z0-9_-]{43}"$/);
  });

  it('does not change with key order', () => {
    expect(etagOf({ rate: '1.50', id: 7, tags: [3, 1], description: 'Bolt' })).toBe(etagOf(ITEM));
  });

  it('changes with array order', () => {
    expect(etagOf({ ...ITEM, tags: [1, 3] })).not.toBe(etagOf(ITEM));
  });
});

describe('assertFresh', () => {
  it('returns when the fingerprint matches', () => {
    expect(() => {
      assertFresh(etagOf(ITEM), { ...ITEM });
    }).not.toThrow();
  });

  it('refuses a changed shown column with ERP-CORE-0013', () => {
    const error = thrown(() => {
      assertFresh(etagOf(ITEM), { ...ITEM, rate: '2.00' });
    });
    expect(error.code).toBe('ERP-CORE-0013');
    expect(error.status).toBe(412);
  });
});

describe('assertBatchFresh', () => {
  const one = { id: 1, name: 'a' };
  const two = { id: 2, name: 'b' };
  const three = { id: 3, name: 'c' };

  it('names every stale row in issues, once', () => {
    const error = thrown(() => {
      assertBatchFresh([
        { id: 1, etag: etagOf(one), current: one },
        { id: 2, etag: etagOf(two), current: { ...two, name: 'B' } },
        { id: 3, etag: etagOf(three), current: { ...three, name: 'C' } },
      ]);
    });
    expect(error.code).toBe('ERP-CORE-0013');
    expect(error.message).toBe('2 rows changed since they were read');
    expect(error.extras?.issues).toEqual([{ id: '2' }, { id: '3' }]);
  });

  it('returns when every row is fresh', () => {
    expect(() => {
      assertBatchFresh([
        { id: 1, etag: etagOf(one), current: one },
        { id: 2, etag: etagOf(two), current: two },
      ]);
    }).not.toThrow();
  });
});

describe('IfMatch', () => {
  it.each([
    ['no header', {}],
    ['an empty header', { 'if-match': '' }],
    ['a blank header', { 'if-match': '  ' }],
    ['a wildcard', { 'if-match': '*' }],
  ])('refuses %s with 428 ERP-CORE-0014', (_label, headers: Record<string, string>) => {
    const error = thrown(() => ifMatchFrom(contextWith(headers)));
    expect(error.code).toBe('ERP-CORE-0014');
    expect(error.status).toBe(428);
  });

  it('answers the trimmed header', () => {
    expect(ifMatchFrom(contextWith({ 'if-match': ' "abc" ' }))).toBe('"abc"');
  });
});
