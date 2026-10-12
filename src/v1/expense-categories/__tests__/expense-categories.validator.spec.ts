/**
 * ExpenseCategoriesValidator: the list and export queries (BE-19's grammar through
 * `shared/http/pagination.ts`, one keyset sort defaulting to the name as Perfex's list does, the
 * opaque cursor bound to it, `q`), the path id and the two strict bodies. The bodies accept exactly
 * what Perfex accepts (D-19): a trimmed name of 1 to 191 characters with no character refused, and
 * a description with no Node cap. Every refusal is a 400 `ERP-VALIDATION-0001` whose issue names the
 * path the caller got wrong (BE-09).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import {
  EXPENSE_CATEGORIES_NAME_MAX,
  EXPENSE_CATEGORIES_SEARCH_MAX,
} from '../dto/expense-categories.dto.js';
import {
  EXPENSE_CATEGORIES_SORT_FIELDS,
  ExpenseCategoriesValidator,
} from '../service/expense-categories.validator.js';

function thrown(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

/** The first issue's path of a refusal, after asserting it is the one validation code. */
function refusedOn(fn: () => unknown): unknown {
  const error = thrown(fn);
  expect(error.code).toBe('ERP-VALIDATION-0001');
  expect(error.status).toBe(400);
  const issues = error.extras?.issues;
  expect(Array.isArray(issues)).toBe(true);
  return (issues as readonly { path: readonly unknown[] }[])[0]?.path;
}

describe('ExpenseCategoriesValidator: the list query (BE-19)', () => {
  const validator = new ExpenseCategoriesValidator();

  it("defaults to the name ascending (Perfex's order), the default limit, no cursor and no search", () => {
    expect(EXPENSE_CATEGORIES_SORT_FIELDS).toEqual(['name', 'id']);
    expect(validator.parseListQuery({})).toEqual({
      search: null,
      sortField: 'name',
      order: 'asc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.default,
    });
  });

  it('reads q, one sort segment (leading - is descending) and a cursor minted for that sort', () => {
    const cursor = encodeCursor('name', ['Beta', 2], 'after');
    expect(validator.parseListQuery({ q: 'be', sort: '-name', limit: '25', cursor })).toEqual({
      search: 'be',
      sortField: 'name',
      order: 'desc',
      cursor: { sort: 'name', key: ['Beta', 2], direction: 'after' },
      limit: 25,
    });
  });

  it('an empty q is no search', () => {
    expect(validator.parseListQuery({ q: '' }).search).toBeNull();
  });

  it.each([
    ['limit 0', { limit: '0' }, ['limit']],
    ['limit 501', { limit: String(LIST_QUERY_LIMITS.max + 1) }, ['limit']],
    ['a page key (paging is keyset)', { page: '2' }, ['page']],
    ['sort=description (not a keyset key)', { sort: 'description' }, ['sort']],
    ['sort=name,id (one field at a time)', { sort: 'name,id' }, ['sort']],
    ['q of 101 characters', { q: 'x'.repeat(EXPENSE_CATEGORIES_SEARCH_MAX + 1) }, ['q']],
    ['filter[name] (this list takes no filter)', { 'filter[name]': 'Alpha' }, ['filter']],
  ])('%s gives 400 on the named path', (_label, input, path) => {
    expect(refusedOn(() => validator.parseListQuery(input))).toEqual(path);
  });

  it('a cursor minted for name sent with sort=id gives 400 on cursor', () => {
    const cursor = encodeCursor('name', ['Alpha', 1], 'after');
    expect(refusedOn(() => validator.parseListQuery({ sort: 'id', cursor }))).toEqual(['cursor']);
  });

  it('a cursor carrying a string for id gives 400 on cursor (never a type error further down)', () => {
    const cursor = encodeCursor('id', ['1', 1], 'after');
    expect(refusedOn(() => validator.parseListQuery({ sort: 'id', cursor }))).toEqual(['cursor']);
  });

  it('a cursor carrying a number for the default name sort gives 400 on cursor', () => {
    const cursor = encodeCursor('name', [1, 1], 'after');
    expect(refusedOn(() => validator.parseListQuery({ cursor }))).toEqual(['cursor']);
  });

  it('a tampered cursor gives 400 on cursor', () => {
    expect(refusedOn(() => validator.parseListQuery({ cursor: 'bm90LWpzb24' }))).toEqual([
      'cursor',
    ]);
  });
});

describe('ExpenseCategoriesValidator: the export list request (04.1.1-02)', () => {
  const validator = new ExpenseCategoriesValidator();

  it("is the list's request from the first row in batches of the list maximum; the export parameters are the core's", () => {
    expect(
      validator.parseExportList({ q: 'a', sort: '-name', format: 'pdf', header: ['x'] }),
    ).toEqual({
      search: 'a',
      sortField: 'name',
      order: 'desc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.max,
    });
  });

  it.each([
    ['a sort outside the list', { sort: 'description' }, ['sort']],
    ['a filter', { 'filter[name]': 'x' }, ['filter']],
  ])('%s gives 400 on the named path', (_label, input, path) => {
    expect(refusedOn(() => validator.parseExportList(input))).toEqual(path);
  });
});

describe('ExpenseCategoriesValidator: the path id and the bodies', () => {
  const validator = new ExpenseCategoriesValidator();

  it('coerces a numeric :id; a non-numeric or non-positive one is a 400, never a 404 probe', () => {
    expect(validator.parseParams({ id: '7' })).toEqual({ id: 7 });
    expect(refusedOn(() => validator.parseParams({ id: 'abc' }))).toEqual(['id']);
    expect(refusedOn(() => validator.parseParams({ id: '0' }))).toEqual(['id']);
  });

  it('a create body is { name, description? }: the name trimmed, the description kept as sent', () => {
    expect(validator.parseCreateBody({ name: '  Alpha ' })).toEqual({ name: 'Alpha' });
    expect(validator.parseCreateBody({ name: 'Alpha', description: ' two\nlines ' })).toEqual({
      name: 'Alpha',
      description: ' two\nlines ',
    });
    expect(refusedOn(() => validator.parseCreateBody({ name: '   ' }))).toEqual(['name']);
    expect(refusedOn(() => validator.parseCreateBody({}))).toEqual(['name']);
    expect(refusedOn(() => validator.parseCreateBody({ name: 'Alpha', description: 7 }))).toEqual([
      'description',
    ]);
  });

  it('the name bound is the VARCHAR(191) column: 191 characters accepted, 192 refused (D-19)', () => {
    expect(EXPENSE_CATEGORIES_NAME_MAX).toBe(191);
    const longest = 'x'.repeat(EXPENSE_CATEGORIES_NAME_MAX);
    expect(validator.parseCreateBody({ name: longest }).name).toHaveLength(191);
    expect(refusedOn(() => validator.parseCreateBody({ name: `${longest}x` }))).toEqual(['name']);
    expect(validator.parseCreateBody({ name: `  ${longest}  ` }).name).toBe(longest);
  });

  it.each(['Fuel < 50 km', '<script>alert(1)</script>'])(
    'the name %s is accepted unchanged: no character is refused (D-19, T-4.1-07)',
    (name) => {
      expect(validator.parseCreateBody({ name })).toEqual({ name });
      expect(validator.parseUpdateBody({ name })).toEqual({ name });
    },
  );

  it('a 100 000-character description is accepted: Node sets no cap (D-19)', () => {
    const description = 'd'.repeat(100_000);
    expect(validator.parseCreateBody({ name: 'Long', description }).description).toBe(description);
    expect(validator.parseUpdateBody({ description }).description).toBe(description);
  });

  it.each(['id', 'expenseCount', 'mappingCount', 'pettyCashCount', 'label'])(
    'a create body carrying %s is refused, and the issue names the key (mass assignment)',
    (key) => {
      const error = thrown(() => validator.parseCreateBody({ name: 'Alpha', [key]: 'x' }));
      expect(error.code).toBe('ERP-VALIDATION-0001');
      expect(JSON.stringify(error.extras?.issues)).toContain(key);
    },
  );

  it('an update body is any part of the create body; the same keys are refused', () => {
    expect(validator.parseUpdateBody({ name: 'Beta' })).toEqual({ name: 'Beta' });
    expect(validator.parseUpdateBody({ description: '' })).toEqual({ description: '' });
    expect(
      JSON.stringify(thrown(() => validator.parseUpdateBody({ id: 3 })).extras?.issues),
    ).toContain('id');
  });

  it('an empty update body is a 400 on the body itself (path [])', () => {
    expect(refusedOn(() => validator.parseUpdateBody({}))).toEqual([]);
  });
});
