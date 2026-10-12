/**
 * PaymentModesValidator: the list and export queries (BE-19's grammar through
 * `shared/http/pagination.ts`, one keyset sort defaulting to the name ascending as Perfex's DataTable
 * does, the opaque cursor bound to it, `q`), the path id, the strict seven-field body and the active
 * switch's body. The body keeps Perfex's outcomes (D-34, D-29): a trimmed name of 1 to 100
 * characters, every character kept (`<` and `>` included), the description and the five boxes
 * optional (an absent box saves 0), both "only" boxes together accepted, and nothing else (D-35: no
 * show-to-client). Every refusal is a 400 `ERP-VALIDATION-0001` whose issue names the path (BE-09).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import { PAYMENT_MODES_NAME_MAX, PAYMENT_MODES_SEARCH_MAX } from '../dto/payment-modes.dto.js';
import {
  PAYMENT_MODES_SORT_FIELDS,
  PaymentModesValidator,
} from '../service/payment-modes.validator.js';

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

/** The five boxes of Perfex's form (`paymentmode.php`). */
const BOXES = ['active', 'showOnPdf', 'selectedByDefault', 'invoicesOnly', 'expensesOnly'] as const;

describe('PaymentModesValidator: the list query (BE-19)', () => {
  const validator = new PaymentModesValidator();

  it("defaults to the name ascending (Perfex's [1, 'asc']), the default limit, no cursor and no search", () => {
    expect(PAYMENT_MODES_SORT_FIELDS).toEqual(['name', 'id', 'active']);
    expect(validator.parseListQuery({})).toEqual({
      search: null,
      sortField: 'name',
      order: 'asc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.default,
    });
  });

  it('reads q, one sort segment (leading - is descending) and a cursor minted for that sort', () => {
    const cursor = encodeCursor('name', ['Bank', 3], 'after');
    expect(validator.parseListQuery({ q: 'bank', sort: 'name', limit: '25', cursor })).toEqual({
      search: 'bank',
      sortField: 'name',
      order: 'asc',
      cursor: { sort: 'name', key: ['Bank', 3], direction: 'after' },
      limit: 25,
    });
    expect(validator.parseListQuery({ sort: 'id' })).toMatchObject({
      sortField: 'id',
      order: 'asc',
    });
    expect(validator.parseListQuery({ sort: '-id' })).toMatchObject({
      sortField: 'id',
      order: 'desc',
    });
    expect(validator.parseListQuery({ sort: 'active' })).toMatchObject({
      sortField: 'active',
      order: 'asc',
    });
    expect(validator.parseListQuery({ sort: '-active' })).toMatchObject({
      sortField: 'active',
      order: 'desc',
    });
  });

  it('reads an active cursor whose key is a boolean', () => {
    const cursor = encodeCursor('active', [true, 4], 'before');
    expect(validator.parseListQuery({ sort: '-active', cursor }).cursor).toEqual({
      sort: 'active',
      key: [true, 4],
      direction: 'before',
    });
  });

  it('reads the last of a repeated q, and an empty q is no search', () => {
    expect(validator.parseListQuery({ q: ['a', 'b'] }).search).toBe('b');
    expect(validator.parseListQuery({ q: '' }).search).toBeNull();
    expect(validator.parseListQuery({ q: [7] }).search).toBeNull();
  });

  it.each([
    ['description, a nullable MEDIUMTEXT, is no sort', { sort: 'description' }, ['sort']],
    ['showOnPdf is no sort', { sort: 'showOnPdf' }, ['sort']],
    ['two sort segments', { sort: 'name,-id' }, ['sort']],
    ['a filter', { 'filter[name]': 'x' }, ['filter']],
    ['page paging', { page: '2' }, ['page']],
    [
      `q over ${String(PAYMENT_MODES_SEARCH_MAX)} characters`,
      { q: 'x'.repeat(PAYMENT_MODES_SEARCH_MAX + 1) },
      ['q'],
    ],
    [
      'a cursor of the other sort',
      { cursor: encodeCursor('id', [3, 3], 'after'), sort: 'name' },
      ['cursor'],
    ],
    [
      'a number cursor under the default name sort',
      { cursor: encodeCursor('name', [3, 3], 'after') },
      ['cursor'],
    ],
    [
      'a text cursor under the active sort',
      { cursor: encodeCursor('active', ['1', 3], 'after'), sort: 'active' },
      ['cursor'],
    ],
  ])('refuses %s', (_label, query, path) => {
    expect(refusedOn(() => validator.parseListQuery(query))).toEqual(path);
  });

  it('accepts q of exactly the maximum', () => {
    const q = 'x'.repeat(PAYMENT_MODES_SEARCH_MAX);
    expect(validator.parseListQuery({ q }).search).toBe(q);
  });

  it('the export list reads every row from the first: no cursor, the list maximum', () => {
    expect(validator.parseExportList({ q: 'a', sort: '-active' })).toEqual({
      search: 'a',
      sortField: 'active',
      order: 'desc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.max,
    });
  });
});

describe('PaymentModesValidator: the path id', () => {
  const validator = new PaymentModesValidator();

  it('reads a positive integer id', () => {
    expect(validator.parseParams({ id: '7' })).toEqual({ id: 7 });
  });

  it.each([['abc'], ['0'], ['-1'], ['1.5']])('refuses %s on id', (id) => {
    expect(refusedOn(() => validator.parseParams({ id }))).toEqual(['id']);
  });
});

describe("PaymentModesValidator: the body (D-34's seven fields, D-35)", () => {
  const validator = new PaymentModesValidator();

  it('trims the name and accepts 100 characters', () => {
    expect(validator.parseCreateBody({ name: '  Bank transfer  ' })).toEqual({
      name: 'Bank transfer',
    });
    const longest = 'n'.repeat(PAYMENT_MODES_NAME_MAX);
    expect(validator.parseCreateBody({ name: longest })).toEqual({ name: longest });
    expect(PAYMENT_MODES_NAME_MAX).toBe(100);
  });

  it('a body with only the name parses with every box false and the description absent', () => {
    const parsed = validator.parseCreateBody({ name: 'Cash' });
    expect('description' in parsed).toBe(false);
    for (const box of BOXES) expect(parsed[box] ?? false).toBe(false);
  });

  it('reads all seven fields as sent', () => {
    const body = {
      name: 'Card',
      description: 'Line one\nline two',
      active: true,
      showOnPdf: true,
      selectedByDefault: false,
      invoicesOnly: true,
      expensesOnly: false,
    };
    expect(validator.parseCreateBody(body)).toEqual(body);
    expect(validator.parseUpdateBody(body)).toEqual(body);
  });

  it.each(['Cash < 50', '<script>alert(1)</script>', 'R&D / 2026 "east"'])(
    'keeps %s exactly as sent (stored and shown as text)',
    (name) => {
      expect(validator.parseCreateBody({ name })).toEqual({ name });
      expect(validator.parseUpdateBody({ name, description: name })).toEqual({
        name,
        description: name,
      });
    },
  );

  it('accepts both invoicesOnly and expensesOnly, as Perfex accepts them (only its form excludes one)', () => {
    expect(
      validator.parseCreateBody({ name: 'Both', invoicesOnly: true, expensesOnly: true }),
    ).toEqual({ name: 'Both', invoicesOnly: true, expensesOnly: true });
  });

  it.each([
    ['101 characters', { name: 'n'.repeat(PAYMENT_MODES_NAME_MAX + 1) }],
    ['an empty name', { name: '' }],
    ['an all-space name', { name: '   ' }],
    ['a number', { name: 7 }],
    ['no name', {}],
  ])('refuses %s on name', (_label, body) => {
    expect(refusedOn(() => validator.parseCreateBody(body))).toEqual(['name']);
  });

  it.each(BOXES.map((box) => [box]))('refuses a %s that is not a boolean', (box) => {
    expect(refusedOn(() => validator.parseCreateBody({ name: 'X', [box]: 1 }))).toEqual([box]);
  });

  it.each([['showToClient'], ['id'], ['usage'], ['isCreditExpenseMode']])(
    'refuses a body carrying %s (strict: the seven fields only, D-35)',
    (key) => {
      const issue = firstIssue(() => validator.parseCreateBody({ name: 'X', [key]: true }));
      expect(JSON.stringify(issue)).toContain(key);
      expect(() => validator.parseUpdateBody({ name: 'X', [key]: true })).toThrow(AppError);
    },
  );

  it("refuses {} on update on ['name']: Perfex's edit rewrites all seven", () => {
    expect(refusedOn(() => validator.parseUpdateBody({}))).toEqual(['name']);
  });
});

describe('PaymentModesValidator: the active switch body (D-34)', () => {
  const validator = new PaymentModesValidator();

  it('reads { active } true and false', () => {
    expect(validator.parseActiveBody({ active: false })).toEqual({ active: false });
    expect(validator.parseActiveBody({ active: true })).toEqual({ active: true });
  });

  it.each([
    ['a string', { active: 'no' }, ['active']],
    ['a number', { active: 0 }, ['active']],
    ['no active', {}, ['active']],
  ])('refuses %s', (_label, body, path) => {
    expect(refusedOn(() => validator.parseActiveBody(body))).toEqual(path);
  });

  it('refuses an extra key, naming it', () => {
    const issue = firstIssue(() => validator.parseActiveBody({ active: true, name: 'X' }));
    expect(JSON.stringify(issue)).toContain('name');
  });
});
