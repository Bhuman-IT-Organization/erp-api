import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import { LEAD_SOURCES_NAME_MAX, LEAD_SOURCES_SEARCH_MAX } from '../dto/lead-sources.dto.js';
import {
  LEAD_SOURCES_SORT_FIELDS,
  LeadSourcesValidator,
} from '../service/lead-sources.validator.js';

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

describe('LeadSourcesValidator: list queries', () => {
  const validator = new LeadSourcesValidator();

  it('defaults to id descending with the default limit, no cursor, and no search', () => {
    expect(LEAD_SOURCES_SORT_FIELDS).toEqual(['id', 'name']);
    expect(validator.parseListQuery({})).toEqual({
      search: null,
      sortField: 'id',
      order: 'desc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.default,
    });
  });

  it('parses search, one sort, limit and the cursor bound to that sort', () => {
    const cursor = encodeCursor('name', ['Web site', 3], 'after');
    expect(validator.parseListQuery({ q: 'web', sort: 'name', limit: '25', cursor })).toEqual({
      search: 'web',
      sortField: 'name',
      order: 'asc',
      cursor: { sort: 'name', key: ['Web site', 3], direction: 'after' },
      limit: 25,
    });
    expect(validator.parseListQuery({ sort: '-name' })).toMatchObject({
      sortField: 'name',
      order: 'desc',
    });
  });

  it('reads the last repeated search value and treats empty search as no search', () => {
    expect(validator.parseListQuery({ q: ['first', 'last'] }).search).toBe('last');
    expect(validator.parseListQuery({ q: '' }).search).toBeNull();
    expect(validator.parseListQuery({ q: [7] }).search).toBeNull();
  });

  it.each([
    ['unsupported sort', { sort: 'created_at' }, ['sort']],
    ['multiple sort fields', { sort: 'name,-id' }, ['sort']],
    ['filter', { 'filter[name]': 'x' }, ['filter']],
    ['page pagination', { page: '2' }, ['page']],
    ['oversized search', { q: 'x'.repeat(LEAD_SOURCES_SEARCH_MAX + 1) }, ['q']],
    [
      'cursor for a different sort',
      { cursor: encodeCursor('id', [3, 3], 'after'), sort: 'name' },
      ['cursor'],
    ],
    [
      'cursor with a key of the wrong type',
      { cursor: encodeCursor('id', ['x', 3], 'after') },
      ['cursor'],
    ],
  ])('refuses %s', (_label, query, path) => {
    expect(refusedOn(() => validator.parseListQuery(query))).toEqual(path);
  });

  it('accepts search at its maximum and parses export from the first row', () => {
    const search = 'x'.repeat(LEAD_SOURCES_SEARCH_MAX);
    expect(validator.parseListQuery({ q: search }).search).toBe(search);
    expect(validator.parseExportList({ q: 'web', sort: 'name' })).toEqual({
      search: 'web',
      sortField: 'name',
      order: 'asc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.max,
    });
  });
});

describe('LeadSourcesValidator: ids and bodies', () => {
  const validator = new LeadSourcesValidator();

  it('parses positive integer ids and rejects invalid ids', () => {
    expect(validator.parseParams({ id: '7' })).toEqual({ id: 7 });
    for (const id of ['abc', '0', '-1', '1.5']) {
      expect(refusedOn(() => validator.parseParams({ id }))).toEqual(['id']);
    }
  });

  it('trims valid names and accepts the 255-character maximum', () => {
    expect(validator.parseCreateBody({ name: '  Web site  ' })).toEqual({ name: 'Web site' });
    const longest = 'n'.repeat(LEAD_SOURCES_NAME_MAX);
    expect(validator.parseCreateBody({ name: longest })).toEqual({ name: longest });
  });

  it.each(['Fuel < 50 km', '<script>alert(1)</script>', 'R&D / 2026 "east"'])(
    'keeps %s unchanged',
    (name) => {
      expect(validator.parseCreateBody({ name })).toEqual({ name });
      expect(validator.parseUpdateBody({ name })).toEqual({ name });
    },
  );

  it.each([
    ['empty name', { name: '' }],
    ['blank name', { name: '   ' }],
    ['too-long name', { name: 'n'.repeat(LEAD_SOURCES_NAME_MAX + 1) }],
    ['missing name', {}],
  ])('rejects an invalid %s', (_label, body) => {
    expect(refusedOn(() => validator.parseCreateBody(body))).toEqual(['name']);
  });

  it.each(['created_by', 'id', 'usage'])('rejects the extra field %s in strict bodies', (key) => {
    const error = thrown(() => validator.parseCreateBody({ name: 'Web', [key]: 1 }));
    expect(error.code).toBe('ERP-VALIDATION-0001');
    expect(JSON.stringify(error.extras?.issues)).toContain(key);
  });

  it('rejects an empty update body', () => {
    expect(refusedOn(() => validator.parseUpdateBody({}))).toEqual(['name']);
  });
});
