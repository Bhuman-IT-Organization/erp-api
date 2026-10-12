import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import { encodeCursor } from '../keyset.js';
import {
  FILTER_OPERATORS,
  LIST_QUERY_LIMITS,
  type FilterOperator,
  parseListQuery,
} from '../pagination.js';

const FIELDS = ['name', 'active', 'id'] as const;
type Field = (typeof FIELDS)[number];

const parse = (query: unknown) => parseListQuery<Field>(query, FIELDS);

const CODE = 'ERP-VALIDATION-0001';

/** Every rejection is the one validation code, so a caller cannot tell which layer refused. */
function rejection(query: unknown): AppError {
  const error = ((): unknown => {
    try {
      parse(query);
      return undefined;
    } catch (e: unknown) {
      return e;
    }
  })();
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe(CODE);
  expect((error as AppError).status).toBe(400);
  return error as AppError;
}

describe('BE-19 list grammar: the contract', () => {
  it('pins the eight operators and the paging bounds', () => {
    expect([...FILTER_OPERATORS]).toEqual(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'in', 'like']);
    expect(LIST_QUERY_LIMITS).toEqual({ min: 1, max: 500, default: 50 });
  });
});

describe('BE-19 list grammar: defaults', () => {
  it('defaults limit to 50, cursor to null, and no filters or sort', () => {
    expect(parse({})).toEqual({
      limit: LIST_QUERY_LIMITS.default,
      cursor: null,
      filters: [],
      sort: [],
    });
  });

  it('treats a non-object query as an empty one', () => {
    expect(parse(undefined).limit).toBe(LIST_QUERY_LIMITS.default);
    expect(parse('name=x').filters).toEqual([]);
  });
});

describe('BE-19 list grammar: paging', () => {
  it.each([
    [String(LIST_QUERY_LIMITS.min), LIST_QUERY_LIMITS.min],
    ['25', 25],
    [String(LIST_QUERY_LIMITS.max), LIST_QUERY_LIMITS.max],
  ])('accepts limit=%s', (raw, expected) => {
    expect(parse({ limit: raw }).limit).toBe(expected);
  });

  it('accepts an opaque cursor and returns it untouched', () => {
    const cursor = 'eyJpZCI6MTAwfQ.~_-';
    expect(parse({ cursor }).cursor).toBe(cursor);
  });

  it('reads the last value when a key repeats', () => {
    expect(parse({ limit: ['10', '20'] }).limit).toBe(20);
  });
});

describe('BE-19 list grammar: one case per operator', () => {
  it.each(FILTER_OPERATORS.filter((op) => op !== 'in'))(
    'filter[name][%s]=x parses to that operator',
    (op: FilterOperator) => {
      expect(parse({ [`filter[name][${op}]`]: 'x' }).filters).toEqual([
        { field: 'name', op, value: 'x' },
      ]);
    },
  );

  it('filter[id][in] splits on commas into a list', () => {
    expect(parse({ 'filter[id][in]': '1,2, 3' }).filters).toEqual([
      { field: 'id', op: 'in', value: ['1', '2', '3'] },
    ]);
  });

  it('a bare filter[field]=value means eq', () => {
    expect(parse({ 'filter[active]': '1' }).filters).toEqual([
      { field: 'active', op: 'eq', value: '1' },
    ]);
  });

  it('reads a nested filter object as well as the flat bracket keys Fastify produces', () => {
    expect(parse({ filter: { name: { like: 'ann' } } }).filters).toEqual([
      { field: 'name', op: 'like', value: 'ann' },
    ]);
    expect(parse({ filter: { active: '1' } }).filters).toEqual([
      { field: 'active', op: 'eq', value: '1' },
    ]);
  });

  it('carries several filters in the order they were read', () => {
    expect(parse({ 'filter[name][like]': 'a', 'filter[active][eq]': '1' }).filters).toEqual([
      { field: 'name', op: 'like', value: 'a' },
      { field: 'active', op: 'eq', value: '1' },
    ]);
  });
});

describe('BE-19 list grammar: sorting', () => {
  it('reads -field as descending and field as ascending, in order', () => {
    expect(parse({ sort: '-name,id' }).sort).toEqual([
      { field: 'name', direction: 'desc' },
      { field: 'id', direction: 'asc' },
    ]);
  });
});

describe('BE-19 list grammar: rejections', () => {
  it('rejects an unknown filter field', () => {
    expect(rejection({ 'filter[password][eq]': 'x' }).message).toBe('Query is invalid');
  });

  it('rejects an unknown filter operator', () => {
    expect(rejection({ 'filter[name][regex]': 'x' }).code).toBe(CODE);
    expect(rejection({ filter: { name: { contains: 'x' } } }).code).toBe(CODE);
  });

  it('rejects an unknown sort field and a duplicated one', () => {
    expect(rejection({ sort: 'password' }).code).toBe(CODE);
    expect(rejection({ sort: 'name,-name' }).code).toBe(CODE);
    expect(rejection({ sort: 'name,' }).code).toBe(CODE);
  });

  it.each(['page', 'size'])('rejects the offset paging key %s', (key) => {
    const error = rejection({ [key]: '2' });
    expect(JSON.stringify(error.extras?.issues)).toContain('keyset');
  });

  it.each(['0', '501', '-1', '1.5', 'many', ''])('rejects limit=%j', (limit) => {
    if (limit === '') {
      expect(parse({ limit }).limit).toBe(LIST_QUERY_LIMITS.default);
      return;
    }
    expect(rejection({ limit }).code).toBe(CODE);
  });

  it('rejects a malformed cursor', () => {
    expect(rejection({ cursor: 'a b' }).code).toBe(CODE);
    expect(rejection({ cursor: "1' OR '1'='1" }).code).toBe(CODE);
    expect(rejection({ cursor: 'x'.repeat(4097) }).code).toBe(CODE);
  });

  it('rejects an empty member of an in list', () => {
    expect(rejection({ 'filter[id][in]': '1,,2' }).code).toBe(CODE);
  });

  it('reports every issue at once rather than the first', () => {
    const error = rejection({ page: '2', limit: '0', sort: 'nope' });
    expect(Array.isArray(error.extras?.issues)).toBe(true);
    expect((error.extras?.issues as unknown[]).length).toBe(3);
  });
});

/**
 * The cursor decision (a) recorded in 04.10-02 (the lead's planning answer 1, 2026-10-06): the
 * boundary row's sort value travels in the cursor (`keyset.ts` `encodeCursor`), so the cap is 4096
 * characters, enough for every capped name (191 characters, Arabic included). The pattern check is
 * unchanged at every length.
 */
describe('BE-19 list grammar: the cursor cap (04.10-02, the cursor decision (a))', () => {
  /** Every character the cursor pattern admits, repeated to the wanted length. */
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_.~-';
  const ofLength = (length: number): string =>
    ALPHABET.repeat(Math.ceil(length / ALPHABET.length)).slice(0, length);

  it('accepts a cursor of exactly 4096 characters of the pattern alphabet', () => {
    const cursor = ofLength(4096);
    expect(cursor).toHaveLength(4096);
    expect(parse({ cursor }).cursor).toBe(cursor);
  });

  it("refuses a cursor of 4097 characters on ['cursor'] ('cursor is malformed')", () => {
    const issues = rejection({ cursor: ofLength(4097) }).extras?.issues;
    expect(issues).toEqual([{ path: ['cursor'], message: 'cursor is malformed' }]);
  });

  it('accepts the cursor encodeCursor mints for a 191-character Arabic name (longer than 512)', () => {
    const name = '\u0628'.repeat(191);
    const cursor = encodeCursor('name', [name, 7], 'after');
    expect(cursor.length).toBeGreaterThan(512);
    expect(parse({ cursor }).cursor).toBe(cursor);
  });

  it.each([16, 512, 4096])(
    'still refuses a character outside the pattern at length %i',
    (length) => {
      const cursor = `${ofLength(length - 1)}=`;
      expect(cursor).toHaveLength(length);
      expect(JSON.stringify(rejection({ cursor }).extras?.issues)).toContain('cursor');
    },
  );
});
