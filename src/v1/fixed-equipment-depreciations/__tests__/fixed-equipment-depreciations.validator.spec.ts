import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import {
  createFixedEquipmentDepreciationsBodySchema,
  FIXED_EQUIPMENT_DEPRECIATIONS_NAME_MAX,
  FIXED_EQUIPMENT_DEPRECIATIONS_SEARCH_MAX,
  fixedEquipmentDepreciationsListResponseSchema,
  fixedEquipmentDepreciationsParamsSchema,
  updateFixedEquipmentDepreciationsBodySchema,
} from '../dto/fixed-equipment-depreciations.dto.js';
import {
  FIXED_EQUIPMENT_DEPRECIATIONS_SORT_FIELDS,
  FixedEquipmentDepreciationsValidator,
} from '../service/fixed-equipment-depreciations.validator.js';

function thrown(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

function firstIssue(fn: () => unknown): { path: readonly unknown[]; message: string } | undefined {
  const error = thrown(fn);
  expect(error.code).toBe('ERP-VALIDATION-0001');
  expect(error.status).toBe(400);
  const issues = error.extras?.issues;
  expect(Array.isArray(issues)).toBe(true);
  return (issues as readonly { path: readonly unknown[]; message: string }[])[0];
}

const refusedOn = (fn: () => unknown): unknown => firstIssue(fn)?.path;

const META = {
  nextCursor: null,
  prevCursor: null,
  total: 1,
  rangeStart: 1,
  exportLimit: 1000,
  printLimit: 500,
};

describe('fixedEquipmentDepreciationsParamsSchema', () => {
  it('coerces a numeric string to a number', () => {
    expect(fixedEquipmentDepreciationsParamsSchema.parse({ id: '5' })).toEqual({ id: 5 });
  });

  it.each(['abc', '0', '-1', '1.5', ''])('rejects id=%s', (id) => {
    expect(fixedEquipmentDepreciationsParamsSchema.safeParse({ id }).success).toBe(false);
  });
});

describe('createFixedEquipmentDepreciationsBodySchema', () => {
  const ok = (body: unknown): boolean =>
    createFixedEquipmentDepreciationsBodySchema.safeParse(body).success;

  it('accepts a name and a number of months, and trims the name', () => {
    expect(
      createFixedEquipmentDepreciationsBodySchema.parse({ name: '  Depreciation 1  ', term: 12 }),
    ).toEqual({ name: 'Depreciation 1', term: 12 });
  });

  it('rejects an empty or blank name', () => {
    expect(ok({ name: '', term: 12 })).toBe(false);
    expect(ok({ name: '   ', term: 12 })).toBe(false);
  });

  it('accepts 200 characters and rejects 201 (the column is a VARCHAR(200))', () => {
    expect(ok({ name: 'a'.repeat(200), term: 12 })).toBe(true);
    expect(ok({ name: 'a'.repeat(201), term: 12 })).toBe(false);
  });

  it('rejects a missing or non-string name', () => {
    expect(ok({ term: 12 })).toBe(false);
    expect(ok({ name: 5, term: 12 })).toBe(false);
  });

  it('requires the number of months as a number greater than 0', () => {
    expect(ok({ name: 'Straight line' })).toBe(false);
    expect(ok({ name: 'Straight line', term: '12' })).toBe(false);
    expect(ok({ name: 'Straight line', term: 0 })).toBe(false);
    expect(ok({ name: 'Straight line', term: -6 })).toBe(false);
    expect(ok({ name: 'Straight line', term: 1 })).toBe(true);
    expect(ok({ name: 'Straight line', term: 1.5 })).toBe(false);
  });

  it('refuses a key Perfex never posts, the creator included', () => {
    expect(ok({ name: 'Straight line', term: 12, creator_id: 9 })).toBe(false);
    expect(ok({ name: 'Straight line', term: 12, id: 3 })).toBe(false);
  });
});

describe('updateFixedEquipmentDepreciationsBodySchema', () => {
  it('still enforces the length limit and the number of months', () => {
    const ok = (body: unknown): boolean =>
      updateFixedEquipmentDepreciationsBodySchema.safeParse(body).success;
    expect(ok({ name: 'a'.repeat(201), term: 12 })).toBe(false);
    expect(ok({ name: 'Renamed' })).toBe(false);
  });
});

describe('fixedEquipmentDepreciationsListResponseSchema', () => {
  it('accepts the keyset envelope, a term or null', () => {
    const result = fixedEquipmentDepreciationsListResponseSchema.safeParse({
      data: [
        { id: '1', name: 'Depreciation 1', term: 12 },
        { id: '4', name: 'Legacy', term: null },
      ],
      meta: META,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a numeric id', () => {
    expect(
      fixedEquipmentDepreciationsListResponseSchema.safeParse({
        data: [{ id: 1, name: 'Depreciation 1', term: 12 }],
        meta: META,
      }).success,
    ).toBe(false);
  });
});

describe('FixedEquipmentDepreciationsValidator: list queries', () => {
  const validator = new FixedEquipmentDepreciationsValidator();

  it("defaults to the id descending (Perfex's newest first) with the default limit, no cursor and no search", () => {
    expect(FIXED_EQUIPMENT_DEPRECIATIONS_SORT_FIELDS).toEqual(['id', 'name']);
    expect(validator.parseListQuery({})).toEqual({
      search: null,
      sortField: 'id',
      order: 'desc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.default,
    });
  });

  it('parses search, one sort, limit and the cursor bound to that sort; -name is name descending', () => {
    const cursor = encodeCursor('name', ['Straight line', 3], 'after');
    expect(validator.parseListQuery({ q: 'line', sort: 'name', limit: '25', cursor })).toEqual({
      search: 'line',
      sortField: 'name',
      order: 'asc',
      cursor: { sort: 'name', key: ['Straight line', 3], direction: 'after' },
      limit: 25,
    });
    expect(validator.parseListQuery({ sort: '-name' })).toMatchObject({
      sortField: 'name',
      order: 'desc',
    });
  });

  it('reads the last repeated search value and treats an empty search as no search', () => {
    expect(validator.parseListQuery({ q: ['first', 'last'] }).search).toBe('last');
    expect(validator.parseListQuery({ q: '' }).search).toBeNull();
    expect(validator.parseListQuery({ q: [7] }).search).toBeNull();
  });

  it.each([
    ['an unsupported sort', { sort: 'term' }, ['sort']],
    ['two sort fields', { sort: 'name,-id' }, ['sort']],
    ['a filter', { 'filter[name]': 'x' }, ['filter']],
    ['page pagination', { page: '2' }, ['page']],
    ['an oversized search', { q: 'x'.repeat(FIXED_EQUIPMENT_DEPRECIATIONS_SEARCH_MAX + 1) }, ['q']],
    [
      'a cursor for another sort (foreign to the default id sort)',
      { cursor: encodeCursor('name', ['x', 3], 'after') },
      ['cursor'],
    ],
    [
      'a cursor whose key has the wrong type',
      { cursor: encodeCursor('id', ['x', 3], 'after') },
      ['cursor'],
    ],
    ['a tampered cursor', { cursor: 'not-a-cursor' }, ['cursor']],
  ])('refuses %s', (_label, query, path) => {
    expect(refusedOn(() => validator.parseListQuery(query))).toEqual(path);
  });

  it('accepts a search at its maximum, and parses an export from the first row at the maximum limit', () => {
    const search = 'x'.repeat(FIXED_EQUIPMENT_DEPRECIATIONS_SEARCH_MAX);
    expect(validator.parseListQuery({ q: search }).search).toBe(search);
    expect(validator.parseExportList({ q: 'line', sort: 'name' })).toEqual({
      search: 'line',
      sortField: 'name',
      order: 'asc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.max,
    });
    expect(validator.parseExportList({})).toEqual({
      search: null,
      sortField: 'id',
      order: 'desc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.max,
    });
  });
});

describe('FixedEquipmentDepreciationsValidator: ids and bodies', () => {
  const validator = new FixedEquipmentDepreciationsValidator();

  it('parses a positive integer id and refuses an invalid one', () => {
    expect(validator.parseParams({ id: '7' })).toEqual({ id: 7 });
    for (const id of ['abc', '0', '-1', '1.5']) {
      expect(refusedOn(() => validator.parseParams({ id }))).toEqual(['id']);
    }
  });

  it('trims the name, keeps the term, and accepts the 200-character maximum', () => {
    expect(validator.parseCreateBody({ name: '  Declining  ', term: 24 })).toEqual({
      name: 'Declining',
      term: 24,
    });
    const longest = 'n'.repeat(FIXED_EQUIPMENT_DEPRECIATIONS_NAME_MAX);
    expect(validator.parseCreateBody({ name: longest, term: 12 })).toEqual({
      name: longest,
      term: 12,
    });
  });

  it.each(['Fuel < 50 km', '<script>alert(1)</script>', 'R&D / 2026 "east"', 'إهلاك ثابت'])(
    'keeps %s as typed in create and update',
    (name) => {
      expect(validator.parseCreateBody({ name, term: 12 })).toEqual({ name, term: 12 });
      expect(validator.parseUpdateBody({ name, term: 12 })).toEqual({ name, term: 12 });
    },
  );

  it.each([
    ['an empty name', { name: '', term: 12 }, ['name']],
    ['a blank name', { name: '   ', term: 12 }, ['name']],
    [
      'a too-long name',
      { name: 'n'.repeat(FIXED_EQUIPMENT_DEPRECIATIONS_NAME_MAX + 1), term: 12 },
      ['name'],
    ],
    ['a missing name', { term: 12 }, ['name']],
    ['a missing term', { name: 'Declining' }, ['term']],
    ['a zero term', { name: 'Declining', term: 0 }, ['term']],
    ['a negative term', { name: 'Declining', term: -6 }, ['term']],
    ['a decimal term', { name: 'Declining', term: 1.5 }, ['term']],
    ['a text term', { name: 'Declining', term: '12' }, ['term']],
  ])('refuses %s', (_label, body, path) => {
    expect(refusedOn(() => validator.parseCreateBody(body))).toEqual(path);
  });

  it.each(['creator_id', 'id', 'date_creator'])(
    'refuses the extra field %s in a strict body',
    (key) => {
      const error = thrown(() =>
        validator.parseCreateBody({ name: 'Declining', term: 12, [key]: 1 }),
      );
      expect(error.code).toBe('ERP-VALIDATION-0001');
      expect(JSON.stringify(error.extras?.issues)).toContain(key);
    },
  );

  it('refuses an empty update body', () => {
    expect(refusedOn(() => validator.parseUpdateBody({}))).toEqual(['name']);
  });
});
