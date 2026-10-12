/**
 * DepartmentsValidator: the list grammar (one sort, default `name` ascending, the cursor bound to
 * its sort and to the kind of value, a NULL calendar id's cursor carrying `false`; `q` bounded; no
 * filter) and the id parameter. There is no body to parse: the module has no write route. Every
 * refusal is `ERP-VALIDATION-0001` with the issue's path.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import { DEPARTMENTS_SEARCH_MAX } from '../dto/departments.dto.js';
import { DepartmentsValidator } from '../service/departments.validator.js';

const validator = new DepartmentsValidator();

interface Issue {
  readonly path: readonly unknown[];
  readonly message: string;
  readonly keys?: readonly string[];
}

/** The issues of a refusal, or a failure when nothing was refused. */
function refusal(run: () => unknown): readonly Issue[] {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    const appError = error as AppError;
    expect(appError.code).toBe('ERP-VALIDATION-0001');
    return (appError.extras?.issues ?? []) as Issue[];
  }
  throw new Error('expected a refusal');
}

const paths = (run: () => unknown): unknown[] => refusal(run).map((issue) => issue.path);

describe('DepartmentsValidator: the list query', () => {
  it("defaults to the name ascending (manage.php:153, [1, 'asc'])", () => {
    expect(validator.parseListQuery({})).toMatchObject({
      sortField: 'name',
      order: 'asc',
      cursor: null,
      search: null,
    });
  });

  it.each([
    ['-name', 'name', 'desc'],
    ['id', 'id', 'asc'],
    ['-id', 'id', 'desc'],
    ['calendarId', 'calendarId', 'asc'],
    ['-calendarId', 'calendarId', 'desc'],
  ])('sort=%s reads %s %s', (sort, field, order) => {
    expect(validator.parseListQuery({ sort })).toMatchObject({ sortField: field, order });
  });

  it.each(['managerId', 'parentId', 'hideFromClient', 'email'])('refuses sort=%s', (sort) => {
    expect(() => validator.parseListQuery({ sort })).toThrow(AppError);
  });

  it('refuses two sort segments and any filter', () => {
    expect(paths(() => validator.parseListQuery({ sort: 'name,id' }))).toEqual([['sort']]);
    expect(() => validator.parseListQuery({ 'filter[name]': 'Sales' })).toThrow(AppError);
  });

  it('refuses q over 100 characters and reads an empty q as no search', () => {
    expect(
      paths(() => validator.parseListQuery({ q: 'x'.repeat(DEPARTMENTS_SEARCH_MAX + 1) })),
    ).toEqual([['q']]);
    expect(validator.parseListQuery({ q: 'x'.repeat(DEPARTMENTS_SEARCH_MAX) }).search).toHaveLength(
      DEPARTMENTS_SEARCH_MAX,
    );
    expect(validator.parseListQuery({ q: '' }).search).toBeNull();
  });

  it('binds the cursor to its sort and to the kind of value', () => {
    const cursor = encodeCursor('name', ['Sales', 1], 'after');
    expect(validator.parseListQuery({ cursor }).cursor?.key).toEqual(['Sales', 1]);
    expect(() => validator.parseListQuery({ sort: 'id', cursor })).toThrow(AppError);
    const wrongKind = encodeCursor('id', ['1', 1], 'after');
    expect(paths(() => validator.parseListQuery({ sort: 'id', cursor: wrongKind }))).toEqual([
      ['cursor'],
    ]);
  });

  it('a calendar id cursor carries text, or false for a NULL row, and nothing else', () => {
    const text = encodeCursor('calendarId', ['cal', 4], 'after');
    const nullRow = encodeCursor('calendarId', [false, 4], 'after');
    const truthy = encodeCursor('calendarId', [true, 4], 'after');
    const number = encodeCursor('calendarId', [4, 4], 'after');
    expect(validator.parseListQuery({ sort: 'calendarId', cursor: text }).cursor?.key).toEqual([
      'cal',
      4,
    ]);
    expect(validator.parseListQuery({ sort: 'calendarId', cursor: nullRow }).cursor?.key).toEqual([
      false,
      4,
    ]);
    expect(paths(() => validator.parseListQuery({ sort: 'calendarId', cursor: truthy }))).toEqual([
      ['cursor'],
    ]);
    expect(paths(() => validator.parseListQuery({ sort: 'calendarId', cursor: number }))).toEqual([
      ['cursor'],
    ]);
  });

  it('an export reads every row from the first: no cursor, the list maximum', () => {
    expect(validator.parseExportList({ sort: '-id' })).toMatchObject({
      sortField: 'id',
      order: 'desc',
      cursor: null,
      limit: LIST_QUERY_LIMITS.max,
    });
  });
});

describe('DepartmentsValidator: the id parameter', () => {
  it('parses a positive integer and refuses anything else', () => {
    expect(validator.parseParams({ id: '7' })).toEqual({ id: 7 });
    expect(paths(() => validator.parseParams({ id: '0' }))).toEqual([['id']]);
    expect(paths(() => validator.parseParams({ id: 'x' }))).toEqual([['id']]);
  });
});
