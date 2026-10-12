/**
 * CostCentersValidator: the list and export queries (BE-19's grammar through
 * `shared/http/pagination.ts`, one keyset sort defaulting to the id descending as Perfex's inline
 * table does, the opaque cursor bound to it, `q`), the path id and the strict body. The body keeps
 * Perfex's outcomes (D-29): a trimmed name of 1 to 255 characters, every character kept (`<` and
 * `>` included), and nothing but the name (D-26). Every refusal is a 400 `ERP-VALIDATION-0001`
 * whose issue names the path the caller got wrong (BE-09).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import { COST_CENTERS_NAME_MAX, COST_CENTERS_SEARCH_MAX } from '../dto/cost-centers.dto.js';
import {
  COST_CENTERS_SORT_FIELDS,
  CostCentersValidator,
} from '../service/cost-centers.validator.js';

function thrown(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

/** The first issue of a refusal, after asserting it is the one validation code. */
function firstIssue(fn: () => unknown): { path: readonly unknown[]; message: string } | undefined {
  const error = thrown(fn);
  expect(error.code).toBe('ERP-VALIDATION-0001');
  expect(error.status).toBe(400);
  const issues = error.extras?.issues;
  expect(Array.isArray(issues)).toBe(true);
  return (issues as readonly { path: readonly unknown[]; message: string }[])[0];
}

const refusedOn = (fn: () => unknown): unknown => firstIssue(fn)?.path;

describe('CostCentersValidator: the list query (BE-19)', () => {
  const validator = new CostCentersValidator();

  it("defaults to the id descending (Perfex's [0, 'desc']), the default limit, no cursor and no search", () => {
    expect(COST_CENTERS_SORT_FIELDS).toEqual(['id', 'name']);
    expect(validator.parseListQuery({})).toEqual({
      search: null,
      sortField: 'id',
      order: 'desc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.default,
    });
  });

  it('reads q, one sort segment (leading - is descending) and a cursor minted for that sort', () => {
    const cursor = encodeCursor('name', ['Head Office', 3], 'after');
    expect(validator.parseListQuery({ q: 'head', sort: 'name', limit: '25', cursor })).toEqual({
      search: 'head',
      sortField: 'name',
      order: 'asc',
      cursor: { sort: 'name', key: ['Head Office', 3], direction: 'after' },
      limit: 25,
    });
    expect(validator.parseListQuery({ sort: 'id' })).toMatchObject({ order: 'asc' });
    expect(validator.parseListQuery({ sort: '-name' })).toMatchObject({
      sortField: 'name',
      order: 'desc',
    });
  });

  it('reads the last of a repeated q, and an empty q is no search', () => {
    expect(validator.parseListQuery({ q: ['a', 'b'] }).search).toBe('b');
    expect(validator.parseListQuery({ q: '' }).search).toBeNull();
    expect(validator.parseListQuery({ q: [7] }).search).toBeNull();
  });

  it.each([
    ['dateCreated, which is nullable, is no sort', { sort: 'dateCreated' }, ['sort']],
    ['datecreated is no sort either', { sort: '-datecreated' }, ['sort']],
    ['two sort segments', { sort: 'name,-id' }, ['sort']],
    ['a filter', { 'filter[name]': 'x' }, ['filter']],
    ['page paging', { page: '2' }, ['page']],
    [
      `q over ${String(COST_CENTERS_SEARCH_MAX)} characters`,
      { q: 'x'.repeat(COST_CENTERS_SEARCH_MAX + 1) },
      ['q'],
    ],
    [
      'a cursor of the other sort',
      { cursor: encodeCursor('id', [3, 3], 'after'), sort: 'name' },
      ['cursor'],
    ],
    [
      'a name cursor under the default id sort',
      { cursor: encodeCursor('id', ['x', 3], 'after') },
      ['cursor'],
    ],
  ])('refuses %s', (_label, query, path) => {
    expect(refusedOn(() => validator.parseListQuery(query))).toEqual(path);
  });

  it('accepts q of exactly the maximum', () => {
    const q = 'x'.repeat(COST_CENTERS_SEARCH_MAX);
    expect(validator.parseListQuery({ q }).search).toBe(q);
  });

  it('the export list reads every row from the first: no cursor, the list maximum', () => {
    expect(validator.parseExportList({ q: 'a', sort: 'name' })).toEqual({
      search: 'a',
      sortField: 'name',
      order: 'asc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.max,
    });
  });
});

describe('CostCentersValidator: the path id', () => {
  const validator = new CostCentersValidator();

  it('reads a positive integer id', () => {
    expect(validator.parseParams({ id: '7' })).toEqual({ id: 7 });
  });

  it.each([['abc'], ['0'], ['-1'], ['1.5']])('refuses %s on id', (id) => {
    expect(refusedOn(() => validator.parseParams({ id }))).toEqual(['id']);
  });
});

describe('CostCentersValidator: the body (D-26, D-29)', () => {
  const validator = new CostCentersValidator();

  it('trims the name and accepts 255 characters', () => {
    expect(validator.parseCreateBody({ name: '  Head Office  ' })).toEqual({
      name: 'Head Office',
    });
    const longest = 'n'.repeat(COST_CENTERS_NAME_MAX);
    expect(validator.parseCreateBody({ name: longest })).toEqual({ name: longest });
    expect(COST_CENTERS_NAME_MAX).toBe(255);
  });

  it.each(['Fuel < 50 km', '<script>alert(1)</script>', 'R&D / 2026 "east"'])(
    'keeps %s exactly as sent (stored and shown as text)',
    (name) => {
      expect(validator.parseCreateBody({ name })).toEqual({ name });
      expect(validator.parseUpdateBody({ name })).toEqual({ name });
    },
  );

  it.each([
    ['256 characters', { name: 'n'.repeat(COST_CENTERS_NAME_MAX + 1) }],
    ['an empty name', { name: '' }],
    ['an all-space name', { name: '   ' }],
    ['a number', { name: 7 }],
    ['no name', {}],
  ])('refuses %s on name', (_label, body) => {
    expect(refusedOn(() => validator.parseCreateBody(body))).toEqual(['name']);
  });

  it.each([['created_by'], ['datecreated'], ['id'], ['usage']])(
    'refuses a body carrying %s (strict: Perfex saved every posted field, Node only the name)',
    (key) => {
      const issue = firstIssue(() => validator.parseCreateBody({ name: 'X', [key]: 1 }));
      expect(JSON.stringify(issue)).toContain(key);
      expect(() => validator.parseUpdateBody({ name: 'X', [key]: 1 })).toThrow(AppError);
    },
  );

  it("refuses {} on update on ['name']: the form always sends the name", () => {
    expect(refusedOn(() => validator.parseUpdateBody({}))).toEqual(['name']);
  });
});
