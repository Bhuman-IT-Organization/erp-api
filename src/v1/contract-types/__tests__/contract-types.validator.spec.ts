/**
 * ContractTypesValidator: the list and export queries (BE-19's grammar through
 * `shared/http/pagination.ts`, one keyset sort defaulting to the name descending as Perfex
 * does, the opaque cursor bound to it, `q`), the path id and the strict body. The body keeps
 * Perfex's outcomes (D-29): a trimmed name with no length limit (LONGTEXT column), every character kept (`<` and
 * `>` included), and nothing but the name (D-26). Every refusal is a 400 `ERP-VALIDATION-0001`
 * whose issue names the path the caller got wrong (BE-09).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import { CONTRACT_TYPES_SEARCH_MAX } from '../dto/contract-types.dto.js';
import {
  CONTRACT_TYPES_SORT_FIELDS,
  ContractTypesValidator,
} from '../service/contract-types.validator.js';

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

describe('ContractTypesValidator: the list query (BE-19)', () => {
  const validator = new ContractTypesValidator();

  it("defaults to the name descending (Perfex's order), the default limit, no cursor and no search", () => {
    expect(CONTRACT_TYPES_SORT_FIELDS).toEqual(['id', 'name']);
    expect(validator.parseListQuery({})).toEqual({
      search: null,
      sortField: 'name',
      order: 'desc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.default,
    });
  });

  it('reads q, one sort segment (leading - is descending) and a cursor minted for that sort', () => {
    const cursor = encodeCursor('name', ['Fixed-Term', 3], 'after');
    expect(validator.parseListQuery({ q: 'fixed', sort: 'name', limit: '25', cursor })).toEqual({
      search: 'fixed',
      sortField: 'name',
      order: 'asc',
      cursor: { sort: 'name', key: ['Fixed-Term', 3], direction: 'after' },
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
      `q over ${String(CONTRACT_TYPES_SEARCH_MAX)} characters`,
      { q: 'x'.repeat(CONTRACT_TYPES_SEARCH_MAX + 1) },
      ['q'],
    ],
    [
      'a cursor of the other sort',
      { cursor: encodeCursor('name', ['x', 3], 'after'), sort: 'id' },
      ['cursor'],
    ],
    [
      'an id cursor under the default name sort',
      { cursor: encodeCursor('id', [3, 3], 'after') },
      ['cursor'],
    ],
  ])('refuses %s', (_label, query, path) => {
    expect(refusedOn(() => validator.parseListQuery(query))).toEqual(path);
  });

  it('accepts q of exactly the maximum', () => {
    const q = 'x'.repeat(CONTRACT_TYPES_SEARCH_MAX);
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

describe('ContractTypesValidator: the path id', () => {
  const validator = new ContractTypesValidator();

  it('reads a positive integer id', () => {
    expect(validator.parseParams({ id: '7' })).toEqual({ id: 7 });
  });

  it.each([['abc'], ['0'], ['-1'], ['1.5']])('refuses %s on id', (id) => {
    expect(refusedOn(() => validator.parseParams({ id }))).toEqual(['id']);
  });
});

describe('ContractTypesValidator: the body (D-26, D-29)', () => {
  const validator = new ContractTypesValidator();

  it('trims the name and accepts very long names (LONGTEXT)', () => {
    expect(validator.parseCreateBody({ name: '  Fixed-Term  ' })).toEqual({
      name: 'Fixed-Term',
    });
    const longName = 'n'.repeat(5000);
    expect(validator.parseCreateBody({ name: longName })).toEqual({ name: longName });
  });

  it.each(['Fixed < 6 months', '<script>alert(1)</script>', 'R&D / 2026 "east"'])(
    'keeps %s exactly as sent (stored and shown as text)',
    (name) => {
      expect(validator.parseCreateBody({ name })).toEqual({ name });
      expect(validator.parseUpdateBody({ name })).toEqual({ name });
    },
  );

  it.each([
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
