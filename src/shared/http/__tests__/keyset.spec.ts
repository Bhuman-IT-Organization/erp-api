/**
 * The keyset seam of BE-19 lists: the opaque cursor, the Prisma-shaped "strictly after/before"
 * predicate, the in-memory comparator the fakes order with, and the list meta both identity lists
 * answer. One `describe` per contract section; every refusal is `ERP-VALIDATION-0001` (400) on the
 * `cursor` path, the same code and shape `pagination.ts` refuses with.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import {
  compareKeys,
  decodeCursor,
  encodeCursor,
  keysetWhere,
  listPageMetaSchema,
  type DecodedCursor,
} from '../keyset.js';

const CODE = 'ERP-VALIDATION-0001';
const BASE64URL_NO_PADDING = /^[A-Za-z0-9_-]+$/;

/** A cursor built by hand, so the refusals can name exactly the part that is wrong. */
function rawCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/** Every rejection is the one validation code on the `cursor` path, so no layer is told apart. */
function rejection(raw: string, expectedSort: string): AppError {
  const error = ((): unknown => {
    try {
      decodeCursor(raw, expectedSort);
      return undefined;
    } catch (e: unknown) {
      return e;
    }
  })();
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(CODE);
  expect((error as AppError).status).toBe(400);
  expect((error as AppError).extras?.issues).toEqual([
    { path: ['cursor'], message: 'cursor is not a cursor of this list' },
  ]);
  return error as AppError;
}

function cursorOf(key: DecodedCursor<string>['key'], direction: 'after' | 'before') {
  return { sort: 'firstName', key, direction } as const;
}

describe('keyset: encodeCursor / decodeCursor', () => {
  it('round-trips the sort, the [value, id] key and the direction', () => {
    const raw = encodeCursor('firstName', ['Jane', 12], 'after');
    expect(decodeCursor(raw, 'firstName')).toEqual({
      sort: 'firstName',
      key: ['Jane', 12],
      direction: 'after',
    });
  });

  it('encodes base64url without padding, so the pagination.ts cursor pattern admits it', () => {
    const raw = encodeCursor('email', ['a@example.invalid', 1], 'before');
    expect(raw).toMatch(BASE64URL_NO_PADDING);
    expect(raw).not.toContain('=');
  });

  it('round-trips a numeric and a boolean sort value', () => {
    expect(decodeCursor(encodeCursor('staffId', [7, 7], 'before'), 'staffId')?.key).toEqual([7, 7]);
    expect(decodeCursor(encodeCursor('active', [true, 3], 'after'), 'active')?.key).toEqual([
      true,
      3,
    ]);
  });

  it('answers null for a null cursor (the first page)', () => {
    expect(decodeCursor(null, 'staffId')).toBeNull();
  });

  it('refuses a string that is not base64url JSON', () => {
    expect(rejection('not-base64!!', 'staffId').code).toBe(CODE);
    expect(rejection('abc', 'staffId').code).toBe(CODE);
    expect(rejection('12', 'staffId').code).toBe(CODE);
  });

  it('refuses a cursor minted for another sort', () => {
    expect(
      rejection(encodeCursor('email', ['a@example.invalid', 1], 'after'), 'firstName').code,
    ).toBe(CODE);
  });

  it.each([
    ['no key', { s: 'staffId', d: 'after' }],
    ['a non-integer id', { s: 'staffId', k: [1, 1.5], d: 'after' }],
    ['a string id', { s: 'staffId', k: [1, '1'], d: 'after' }],
    ['a key of the wrong length', { s: 'staffId', k: [1], d: 'after' }],
    ['an object sort value', { s: 'staffId', k: [{ gt: 1 }, 1], d: 'after' }],
    ['a direction other than after/before', { s: 'staffId', k: [1, 1], d: 'sideways' }],
    ['no sort', { k: [1, 1], d: 'after' }],
    ['a JSON array', [1, 1]],
    ['JSON null', null],
  ])('refuses a cursor with %s', (_case, payload) => {
    expect(rejection(rawCursor(payload), 'staffId').code).toBe(CODE);
  });
});

describe('keyset: keysetWhere', () => {
  it('asc + after: strictly greater on the column, then on the id among ties', () => {
    expect(keysetWhere('firstname', 'staffid', cursorOf(['Jane', 12], 'after'), 'asc')).toEqual({
      OR: [{ firstname: { gt: 'Jane' } }, { firstname: 'Jane', staffid: { gt: 12 } }],
    });
  });

  it('desc + after uses lt', () => {
    expect(keysetWhere('firstname', 'staffid', cursorOf(['Jane', 12], 'after'), 'desc')).toEqual({
      OR: [{ firstname: { lt: 'Jane' } }, { firstname: 'Jane', staffid: { lt: 12 } }],
    });
  });

  it('asc + before uses lt', () => {
    expect(keysetWhere('firstname', 'staffid', cursorOf(['Jane', 12], 'before'), 'asc')).toEqual({
      OR: [{ firstname: { lt: 'Jane' } }, { firstname: 'Jane', staffid: { lt: 12 } }],
    });
  });

  it('desc + before uses gt', () => {
    expect(keysetWhere('firstname', 'staffid', cursorOf(['Jane', 12], 'before'), 'desc')).toEqual({
      OR: [{ firstname: { gt: 'Jane' } }, { firstname: 'Jane', staffid: { gt: 12 } }],
    });
  });

  it('sorting by the id itself stays correct: both branches collapse to "id strictly after"', () => {
    const where = keysetWhere('roleid', 'roleid', cursorOf([10, 10], 'after'), 'asc');
    expect(where).toEqual({ OR: [{ roleid: { gt: 10 } }, { roleid: { gt: 10 } }] });
  });

  it('takes the column names from the caller, never from the cursor', () => {
    const where = keysetWhere(
      'email',
      'staffid',
      { sort: 'x', key: ['k', 1], direction: 'after' },
      'asc',
    );
    expect(Object.keys((where.OR as Record<string, unknown>[])[1] ?? {})).toEqual([
      'email',
      'staffid',
    ]);
  });
});

describe('keyset: compareKeys', () => {
  it('orders by the value first, then by the id among ties (asc)', () => {
    expect(compareKeys(['a', 2], ['a', 1], 'asc')).toBeGreaterThan(0);
    expect(compareKeys(['a', 2], ['b', 1], 'asc')).toBeLessThan(0);
    expect(compareKeys(['a', 1], ['a', 1], 'asc')).toBe(0);
  });

  it('desc inverts both', () => {
    expect(compareKeys(['a', 2], ['a', 1], 'desc')).toBeLessThan(0);
    expect(compareKeys(['a', 2], ['b', 1], 'desc')).toBeGreaterThan(0);
  });

  it('orders numbers numerically and booleans false before true', () => {
    expect(compareKeys([10, 1], [9, 2], 'asc')).toBeGreaterThan(0);
    expect(compareKeys([false, 9], [true, 1], 'asc')).toBeLessThan(0);
  });

  it('sorts an array into the same order keysetWhere pages through', () => {
    const keys: [string, number][] = [
      ['b', 1],
      ['a', 3],
      ['a', 2],
    ];
    expect([...keys].sort((x, y) => compareKeys(x, y, 'asc'))).toEqual([
      ['a', 2],
      ['a', 3],
      ['b', 1],
    ]);
  });
});

describe('keyset: listPageMetaSchema', () => {
  it('accepts the four fields of a list page', () => {
    const meta = { nextCursor: 'abc', prevCursor: null, total: 12, rangeStart: 1 };
    expect(listPageMetaSchema.parse(meta)).toEqual(meta);
  });

  it('rejects a negative total and a fractional rangeStart', () => {
    expect(
      listPageMetaSchema.safeParse({ nextCursor: null, prevCursor: null, total: -1, rangeStart: 0 })
        .success,
    ).toBe(false);
    expect(
      listPageMetaSchema.safeParse({
        nextCursor: null,
        prevCursor: null,
        total: 3,
        rangeStart: 1.5,
      }).success,
    ).toBe(false);
  });

  it('requires both cursors, nullable', () => {
    expect(
      listPageMetaSchema.safeParse({ nextCursor: null, total: 0, rangeStart: 0 }).success,
    ).toBe(false);
  });
});
