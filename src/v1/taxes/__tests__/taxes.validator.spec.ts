/**
 * TaxesValidator: the list and export queries (BE-19's grammar through `shared/http/pagination.ts`,
 * one keyset sort defaulting to the rate as Perfex's list does, the opaque cursor bound to it, `q`),
 * the path id and the two strict bodies. The bodies accept exactly what Perfex accepts, made safe
 * as D-19 does: a trimmed name of 1 to 100 characters with `<` and `>` kept, `|` refused (Perfex's
 * `name|rate` separator), and a rate as decimal text. Every refusal is a 400 `ERP-VALIDATION-0001`
 * whose issue names the path the caller got wrong (BE-09).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import { TAXES_NAME_MAX, TAXES_SEARCH_MAX } from '../dto/taxes.dto.js';
import { TAXES_SORT_FIELDS, TaxesValidator } from '../service/taxes.validator.js';

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

describe('TaxesValidator: the list query (BE-19)', () => {
  const validator = new TaxesValidator();

  it("defaults to the rate ascending (Perfex's [2, 'asc']), the default limit, no cursor and no search", () => {
    expect(TAXES_SORT_FIELDS).toEqual(['rate', 'name', 'id']);
    expect(validator.parseListQuery({})).toEqual({
      search: null,
      sortField: 'rate',
      order: 'asc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.default,
    });
  });

  it('reads q, one sort segment (leading - is descending) and a cursor minted for that sort', () => {
    const cursor = encodeCursor('rate', [10, 2], 'after');
    expect(validator.parseListQuery({ q: 'va', sort: '-rate', limit: '25', cursor })).toEqual({
      search: 'va',
      sortField: 'rate',
      order: 'desc',
      cursor: { sort: 'rate', key: [10, 2], direction: 'after' },
      limit: 25,
    });
    expect(validator.parseListQuery({ sort: 'name' }).sortField).toBe('name');
    expect(validator.parseListQuery({ sort: '-id' })).toMatchObject({
      sortField: 'id',
      order: 'desc',
    });
  });

  it('an empty q is no search; a repeated q reads its last value', () => {
    expect(validator.parseListQuery({ q: '' }).search).toBeNull();
    expect(validator.parseListQuery({ q: ['a', 'vat'] }).search).toBe('vat');
  });

  it.each([
    ['limit 0', { limit: '0' }, ['limit']],
    ['a page key (paging is keyset)', { page: '2' }, ['page']],
    ['sort=taxrate (the column is not the field)', { sort: 'taxrate' }, ['sort']],
    ['sort=rate,id (one field at a time)', { sort: 'rate,id' }, ['sort']],
    ['q of 101 characters', { q: 'x'.repeat(TAXES_SEARCH_MAX + 1) }, ['q']],
    ['filter[name] (this list takes no filter)', { 'filter[name]': 'VAT' }, ['filter']],
  ])('%s gives 400 on the named path', (_label, input, path) => {
    expect(refusedOn(() => validator.parseListQuery(input))).toEqual(path);
  });

  it('a cursor minted for the rate sent with sort=name gives 400 on cursor', () => {
    const cursor = encodeCursor('rate', [5, 1], 'after');
    expect(refusedOn(() => validator.parseListQuery({ sort: 'name', cursor }))).toEqual(['cursor']);
  });

  it('a rate cursor carrying a string gives 400 on cursor (the key is the number)', () => {
    const cursor = encodeCursor('rate', ['5.00', 1], 'after');
    expect(refusedOn(() => validator.parseListQuery({ cursor }))).toEqual(['cursor']);
  });
});

describe('TaxesValidator: the export list request', () => {
  const validator = new TaxesValidator();

  it("is the list's request from the first row in batches of the list maximum", () => {
    expect(validator.parseExportList({ q: 'a', sort: '-name', format: 'pdf' })).toEqual({
      search: 'a',
      sortField: 'name',
      order: 'desc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.max,
    });
  });
});

describe('TaxesValidator: the path id and the bodies', () => {
  const validator = new TaxesValidator();

  it('coerces a numeric :id; a non-numeric or non-positive one is a 400, never a 404 probe', () => {
    expect(validator.parseParams({ id: '7' })).toEqual({ id: 7 });
    expect(refusedOn(() => validator.parseParams({ id: 'abc' }))).toEqual(['id']);
    expect(refusedOn(() => validator.parseParams({ id: '0' }))).toEqual(['id']);
  });

  it('a create body is { name, rate }: both trimmed, both required', () => {
    expect(validator.parseCreateBody({ name: '  VAT ', rate: ' 12.5 ' })).toEqual({
      name: 'VAT',
      rate: '12.5',
    });
    expect(refusedOn(() => validator.parseCreateBody({ name: '   ', rate: '1' }))).toEqual([
      'name',
    ]);
    expect(refusedOn(() => validator.parseCreateBody({ rate: '1' }))).toEqual(['name']);
    expect(refusedOn(() => validator.parseCreateBody({ name: 'VAT' }))).toEqual(['rate']);
  });

  it('the name bound is the VARCHAR(100) column: 100 characters accepted, 101 refused', () => {
    expect(TAXES_NAME_MAX).toBe(100);
    const longest = 'x'.repeat(TAXES_NAME_MAX);
    expect(validator.parseCreateBody({ name: longest, rate: '1' }).name).toHaveLength(100);
    expect(refusedOn(() => validator.parseCreateBody({ name: `${longest}x`, rate: '1' }))).toEqual([
      'name',
    ]);
    expect(validator.parseCreateBody({ name: `  ${longest}  `, rate: '1' }).name).toBe(longest);
  });

  it.each(['Fuel < 50 km', '<script>alert(1)</script>'])(
    'the name %s is accepted unchanged: markup is rendered as text, never refused (D-19)',
    (name) => {
      expect(validator.parseCreateBody({ name, rate: '1' })).toEqual({ name, rate: '1' });
      expect(validator.parseUpdateBody({ name })).toEqual({ name });
    },
  );

  it.each(['VAT|5', '|', 'a|b|c'])(
    "the name %s is refused on ['name']: | is Perfex's name|rate separator",
    (name) => {
      const issue = firstIssue(() => validator.parseCreateBody({ name, rate: '1' }));
      expect(issue?.path).toEqual(['name']);
      expect(issue?.message).toBe('the name may not contain |');
      expect(refusedOn(() => validator.parseUpdateBody({ name }))).toEqual(['name']);
    },
  );

  it.each(['12.5', '15', '-0.004', '.5', '12.', '007.1'])(
    'the rate %s is accepted as text',
    (rate) => {
      expect(validator.parseCreateBody({ name: 'VAT', rate }).rate).toBe(rate);
    },
  );

  it.each(['abc', '1,000.5', '1e3', '', '-', '+5', '5%'])(
    "the rate %j is refused on ['rate']",
    (rate) => {
      const issue = firstIssue(() => validator.parseCreateBody({ name: 'VAT', rate }));
      expect(issue?.path).toEqual(['rate']);
    },
  );

  it("a JSON number as the rate is refused on ['rate']: the rate is decimal text", () => {
    expect(refusedOn(() => validator.parseCreateBody({ name: 'VAT', rate: 12.5 }))).toEqual([
      'rate',
    ]);
    expect(refusedOn(() => validator.parseUpdateBody({ rate: 5 }))).toEqual(['rate']);
  });

  it.each(['id', 'usage', 'isDefault', 'taxrate'])(
    'a create body carrying %s is refused, and the issue names the key (mass assignment)',
    (key) => {
      const error = thrown(() => validator.parseCreateBody({ name: 'VAT', rate: '1', [key]: 'x' }));
      expect(error.code).toBe('ERP-VALIDATION-0001');
      expect(JSON.stringify(error.extras?.issues)).toContain(key);
    },
  );

  it('an update body is any part of the create body; an empty one is a 400 on the body (path [])', () => {
    expect(validator.parseUpdateBody({ name: 'GST' })).toEqual({ name: 'GST' });
    expect(validator.parseUpdateBody({ rate: '7' })).toEqual({ rate: '7' });
    expect(refusedOn(() => validator.parseUpdateBody({}))).toEqual([]);
  });
});
