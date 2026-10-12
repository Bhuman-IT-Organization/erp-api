/**
 * CustomFieldsValidator: the list grammar (one sort of five, the `fieldto` filter only, `q` bounded),
 * the export's list request and the `:id` parameter. Every refusal is ERP-VALIDATION-0001 with its
 * path. The module takes no body (read routes only).
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import { CustomFieldsValidator } from '../service/custom-fields.validator.js';

const validator = new CustomFieldsValidator();

function pathsOf(run: () => unknown): unknown[] {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe('ERP-VALIDATION-0001');
    return ((error as AppError).extras?.issues as { path: unknown[] }[]).map((issue) => issue.path);
  }
  throw new Error('expected a refusal');
}

describe('CustomFieldsValidator.parseListQuery', () => {
  it('defaults to id ascending with no search and no filter', () => {
    expect(validator.parseListQuery({})).toMatchObject({
      sortField: 'id',
      order: 'asc',
      search: null,
      fieldto: null,
      cursor: null,
    });
  });

  it('reads the fieldto filter and every sort field', () => {
    expect(validator.parseListQuery({ 'filter[fieldto][in]': 'items,leads' }).fieldto).toEqual([
      'items',
      'leads',
    ]);
    for (const field of ['id', 'name', 'fieldto', 'type', 'fieldOrder']) {
      expect(validator.parseListQuery({ sort: `-${field}` })).toMatchObject({
        sortField: field,
        order: 'desc',
      });
    }
  });

  it('refuses another filter, an unknown entity, two sorts and a long q', () => {
    expect(pathsOf(() => validator.parseListQuery({ 'filter[name][eq]': 'x' }))).toContainEqual([
      'filter',
    ]);
    expect(pathsOf(() => validator.parseListQuery({ 'filter[fieldto][in]': 'nope' }))).toEqual([
      ['filter'],
    ]);
    expect(pathsOf(() => validator.parseListQuery({ sort: 'name,id' }))).toEqual([['sort']]);
    expect(pathsOf(() => validator.parseListQuery({ q: 'x'.repeat(101) }))).toEqual([['q']]);
  });
});

describe('CustomFieldsValidator.parseExportList and parseParams', () => {
  it('the export reads the list query from the first row in batches of the list maximum', () => {
    expect(validator.parseExportList({ sort: 'name', limit: '5' })).toMatchObject({
      sortField: 'name',
      cursor: null,
      limit: LIST_QUERY_LIMITS.max,
    });
  });

  it(':id is a positive number; anything else is refused on id', () => {
    expect(validator.parseParams({ id: '7' })).toEqual({ id: 7 });
    expect(pathsOf(() => validator.parseParams({ id: 'abc' }))).toEqual([['id']]);
    expect(pathsOf(() => validator.parseParams({ id: '0' }))).toEqual([['id']]);
  });
});
