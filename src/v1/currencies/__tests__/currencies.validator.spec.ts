/**
 * CurrenciesValidator: the list grammar (one sort, default `-name`, the cursor bound to its sort,
 * `q` bounded, no filter), the strict five-field body on the shared code schema, the empty strict
 * base body, and the id parameter. Every refusal is `ERP-VALIDATION-0001` with the issue's path.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import { CURRENCIES_SEARCH_MAX, CURRENCIES_SYMBOL_MAX } from '../dto/currencies.dto.js';
import { CurrenciesValidator } from '../service/currencies.validator.js';

const validator = new CurrenciesValidator();

const BODY = {
  name: 'usd',
  symbol: '$',
  decimalSeparator: '.',
  thousandSeparator: ',',
  placement: 'before',
} as const;

/** The issue paths of a refusal, or a failure when nothing was refused. */
function refusalPaths(run: () => unknown): unknown[] {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe('ERP-VALIDATION-0001');
    const issues = (appError.extras?.issues ?? []) as { path: unknown[]; message: string }[];
    return issues.map((issue) => issue.path);
  }
  throw new Error('expected a refusal');
}

/** The issue messages of a refusal. */
function refusalMessages(run: () => unknown): string[] {
  try {
    run();
  } catch (error) {
    const issues = ((error as AppError).extras?.issues ?? []) as { message: string }[];
    return issues.map((issue) => issue.message);
  }
  throw new Error('expected a refusal');
}

describe('CurrenciesValidator: the body (D-38, the shared code schema)', () => {
  it('parses usd to USD and keeps the other four fields', () => {
    expect(validator.parseCreateBody(BODY)).toEqual({ ...BODY, name: 'USD' });
  });

  it('trims the code and upper-cases a to z only', () => {
    expect(validator.parseCreateBody({ ...BODY, name: ' eUr ' }).name).toBe('EUR');
    expect(validator.parseCreateBody({ ...BODY, name: '\u00e9ur' }).name).toBe('\u00e9UR');
  });

  it.each([
    ['ABCD', 'at most 3 characters'],
    ['', 'required'],
    ['   ', 'required'],
  ])('refuses the code %j on [name] with %j', (name, message) => {
    expect(refusalPaths(() => validator.parseCreateBody({ ...BODY, name }))).toEqual([['name']]);
    expect(refusalMessages(() => validator.parseCreateBody({ ...BODY, name }))).toEqual([message]);
  });

  it('accepts a symbol of 10 characters and refuses 11', () => {
    const ten = 'x'.repeat(CURRENCIES_SYMBOL_MAX);
    expect(validator.parseCreateBody({ ...BODY, symbol: ten }).symbol).toBe(ten);
    expect(refusalPaths(() => validator.parseCreateBody({ ...BODY, symbol: `${ten}x` }))).toEqual([
      ['symbol'],
    ]);
  });

  it('refuses an empty or all-space symbol and keeps a trailing space as sent', () => {
    const empty = refusalPaths(() => validator.parseCreateBody({ ...BODY, symbol: '' }));
    expect([...new Set(empty.map(String))]).toEqual(['symbol']);
    expect(refusalPaths(() => validator.parseCreateBody({ ...BODY, symbol: ' ' }))).toEqual([
      ['symbol'],
    ]);
    expect(validator.parseCreateBody({ ...BODY, symbol: '$ ' }).symbol).toBe('$ ');
  });

  it.each([
    ['decimalSeparator', ' '],
    ['decimalSeparator', ''],
    ['thousandSeparator', ';'],
    ['placement', 'middle'],
  ])('refuses %s %j (not one of Perfex form options)', (field, value) => {
    expect(refusalPaths(() => validator.parseCreateBody({ ...BODY, [field]: value }))).toEqual([
      [field],
    ]);
  });

  it.each([',', '.', "'", '', ' '])('accepts the thousand separator %j', (separator) => {
    expect(
      validator.parseCreateBody({ ...BODY, thousandSeparator: separator }).thousandSeparator,
    ).toBe(separator);
  });

  it.each(['isBase', 'isdefault', 'id'])('refuses the key %s (strict)', (key) => {
    const paths = refusalPaths(() => validator.parseCreateBody({ ...BODY, [key]: true }));
    expect(paths).toHaveLength(1);
  });

  it('refuses {} on update', () => {
    expect(refusalPaths(() => validator.parseUpdateBody({})).length).toBeGreaterThan(0);
  });

  it('takes the same five fields on update', () => {
    expect(validator.parseUpdateBody({ ...BODY, name: 'gbp' })).toEqual({ ...BODY, name: 'GBP' });
  });
});

describe('CurrenciesValidator: the base body (D-39)', () => {
  it('accepts {} and no body', () => {
    expect(validator.parseBaseBody({})).toEqual({});
    expect(validator.parseBaseBody(undefined)).toEqual({});
  });

  it('refuses any key', () => {
    expect(refusalPaths(() => validator.parseBaseBody({ isBase: true }))).toHaveLength(1);
  });
});

describe('CurrenciesValidator: the list query', () => {
  it('defaults to the code descending (Perfex initDataTable default [[0, desc]])', () => {
    expect(validator.parseListQuery({})).toMatchObject({
      sortField: 'name',
      order: 'desc',
      cursor: null,
      search: null,
    });
  });

  it.each([
    ['name', 'name', 'asc'],
    ['-symbol', 'symbol', 'desc'],
    ['id', 'id', 'asc'],
    ['-id', 'id', 'desc'],
  ])('sort=%s reads %s %s', (sort, field, order) => {
    expect(validator.parseListQuery({ sort })).toMatchObject({ sortField: field, order });
  });

  it.each(['placement', 'decimalSeparator', 'isBase'])('refuses sort=%s', (sort) => {
    expect(() => validator.parseListQuery({ sort })).toThrow(AppError);
  });

  it('refuses two sort segments and any filter', () => {
    expect(refusalPaths(() => validator.parseListQuery({ sort: 'name,id' }))).toEqual([['sort']]);
    expect(() => validator.parseListQuery({ 'filter[name]': 'USD' })).toThrow(AppError);
  });

  it('refuses q over 100 characters and reads an empty q as no search', () => {
    expect(
      refusalPaths(() => validator.parseListQuery({ q: 'x'.repeat(CURRENCIES_SEARCH_MAX + 1) })),
    ).toEqual([['q']]);
    expect(validator.parseListQuery({ q: 'x'.repeat(CURRENCIES_SEARCH_MAX) }).search).toHaveLength(
      CURRENCIES_SEARCH_MAX,
    );
    expect(validator.parseListQuery({ q: '' }).search).toBeNull();
    expect(validator.parseListQuery({ q: ['a', 'US'] }).search).toBe('US');
  });

  it('binds the cursor to its sort and to the kind of value', () => {
    const cursor = encodeCursor('name', ['USD', 1], 'after');
    expect(validator.parseListQuery({ sort: '-name', cursor }).cursor?.key).toEqual(['USD', 1]);
    expect(() => validator.parseListQuery({ sort: 'id', cursor })).toThrow(AppError);
    const wrongKind = encodeCursor('id', ['1', 1], 'after');
    expect(refusalPaths(() => validator.parseListQuery({ sort: 'id', cursor: wrongKind }))).toEqual(
      [['cursor']],
    );
  });

  it('an export reads every row from the first: no cursor, the list maximum', () => {
    expect(validator.parseExportList({ sort: 'symbol' })).toMatchObject({
      sortField: 'symbol',
      cursor: null,
      limit: LIST_QUERY_LIMITS.max,
    });
  });
});

describe('CurrenciesValidator: the id parameter', () => {
  it('parses a positive integer and refuses anything else', () => {
    expect(validator.parseParams({ id: '7' })).toEqual({ id: 7 });
    expect(refusalPaths(() => validator.parseParams({ id: '0' }))).toEqual([['id']]);
    expect(refusalPaths(() => validator.parseParams({ id: 'x' }))).toEqual([['id']]);
  });
});
