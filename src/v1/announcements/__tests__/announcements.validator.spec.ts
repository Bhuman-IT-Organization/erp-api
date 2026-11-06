import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { encodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import {
  ANNOUNCEMENTS_MESSAGE_MAX,
  ANNOUNCEMENTS_NAME_MAX,
  ANNOUNCEMENTS_SEARCH_MAX,
} from '../dto/announcements.dto.js';
import {
  ANNOUNCEMENTS_SORT_FIELDS,
  AnnouncementsValidator,
} from '../service/announcements.validator.js';

const validator = new AnnouncementsValidator();
const BODY = {
  name: 'Fuel prices',
  message: 'Updated',
  showToUsers: true,
  showToStaff: false,
  showName: true,
};

function refused(run: () => unknown): AppError {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error('expected an AppError');
}

describe('AnnouncementsValidator: the list query', () => {
  it('sorts on name and dateadded', () => {
    expect(ANNOUNCEMENTS_SORT_FIELDS).toEqual(['name', 'dateadded']);
  });

  it('defaults to the date descending (Perfex order), no cursor and no search', () => {
    expect(validator.parseListQuery({})).toMatchObject({
      search: null,
      sortField: 'dateadded',
      order: 'desc',
      cursor: null,
    });
  });

  it.each([
    ['name', 'name', 'asc'],
    ['-name', 'name', 'desc'],
    ['dateadded', 'dateadded', 'asc'],
    ['-dateadded', 'dateadded', 'desc'],
  ])('sort=%s reads %s %s', (sort, sortField, order) => {
    expect(validator.parseListQuery({ sort })).toMatchObject({ sortField, order });
  });

  it('refuses an unknown sort field and two sort fields', () => {
    expect(() => validator.parseListQuery({ sort: 'bogus' })).toThrow(AppError);
    expect(() => validator.parseListQuery({ sort: 'id' })).toThrow(AppError);
    expect(() => validator.parseListQuery({ sort: 'name,dateadded' })).toThrow(AppError);
  });

  it('q is null when empty and bounded at the maximum (without trimming)', () => {
    expect(validator.parseListQuery({ q: '' }).search).toBeNull();
    expect(validator.parseListQuery({ q: ' fuel ' }).search).toBe(' fuel ');
    expect(
      validator.parseListQuery({ q: 'a'.repeat(ANNOUNCEMENTS_SEARCH_MAX) }).search,
    ).toHaveLength(ANNOUNCEMENTS_SEARCH_MAX);
    expect(() => validator.parseListQuery({ q: 'a'.repeat(ANNOUNCEMENTS_SEARCH_MAX + 1) })).toThrow(
      AppError,
    );
  });

  it('decodes a cursor made for the same sort', () => {
    const cursor = encodeCursor('dateadded', [1_000, 5], 'after');
    const request = validator.parseListQuery({ sort: 'dateadded', cursor });
    expect(request.cursor).toMatchObject({ direction: 'after', key: [1_000, 5] });
  });

  it('refuses a cursor made for another sort', () => {
    const cursor = encodeCursor('dateadded', [5, 5], 'after');
    expect(() => validator.parseListQuery({ sort: 'name', cursor })).toThrow(AppError);
  });

  it('refuses a date cursor whose millis cannot make a valid Date', () => {
    const cursor = encodeCursor('dateadded', [1e20, 5], 'after');
    expect(() => validator.parseListQuery({ sort: 'dateadded', cursor })).toThrow(AppError);
  });

  it('the export list drops the cursor and reads the largest page', () => {
    const request = validator.parseExportList({});
    expect(request.cursor).toBeNull();
    expect(request.limit).toBe(LIST_QUERY_LIMITS.max);
  });
});

describe('AnnouncementsValidator: params', () => {
  it('reads a positive integer id', () => {
    expect(validator.parseParams({ id: '5' })).toEqual({ id: 5 });
  });

  it.each(['0', '-1', 'abc', '1.5', '2147483648', ''])('refuses the id %j', (id) => {
    expect(refused(() => validator.parseParams({ id })).code).toBe('ERP-VALIDATION-0001');
  });
});

describe('AnnouncementsValidator: the body', () => {
  it('trims the name and the message and keeps the switches as booleans', () => {
    expect(
      validator.parseCreateBody({ ...BODY, name: '  Fuel prices  ', message: '  Updated  ' }),
    ).toEqual(BODY);
  });

  it('the message is optional on create but required on update', () => {
    const withoutMessage = Object.fromEntries(
      Object.entries(BODY).filter(([key]) => key !== 'message'),
    );
    expect(validator.parseCreateBody(withoutMessage).message).toBeUndefined();
    expect(() => validator.parseUpdateBody(withoutMessage)).toThrow(AppError);
  });

  it('accepts the longest name and message, refuses one more', () => {
    expect(
      validator.parseCreateBody({ ...BODY, name: 'a'.repeat(ANNOUNCEMENTS_NAME_MAX) }).name,
    ).toHaveLength(ANNOUNCEMENTS_NAME_MAX);
    expect(() =>
      validator.parseCreateBody({ ...BODY, name: 'a'.repeat(ANNOUNCEMENTS_NAME_MAX + 1) }),
    ).toThrow(AppError);
    expect(
      validator.parseCreateBody({ ...BODY, message: 'a'.repeat(ANNOUNCEMENTS_MESSAGE_MAX) })
        .message,
    ).toHaveLength(ANNOUNCEMENTS_MESSAGE_MAX);
    expect(() =>
      validator.parseCreateBody({ ...BODY, message: 'a'.repeat(ANNOUNCEMENTS_MESSAGE_MAX + 1) }),
    ).toThrow(AppError);
  });

  it.each(['Fuel< 50 km', '<script>alert(1)</script>', 'R&D / 2026 "east"'])(
    'keeps %s exactly as sent (stored and shown as text)',
    (name) => {
      expect(validator.parseCreateBody({ ...BODY, name }).name).toBe(name);
    },
  );

  it('refuses an empty or blank name, a missing switch and a numeric switch', () => {
    expect(() => validator.parseCreateBody({ ...BODY, name: '' })).toThrow(AppError);
    expect(() => validator.parseCreateBody({ ...BODY, name: '   ' })).toThrow(AppError);
    const withoutSwitch = Object.fromEntries(
      Object.entries(BODY).filter(([key]) => key !== 'showName'),
    );
    expect(() => validator.parseCreateBody(withoutSwitch)).toThrow(AppError);
    expect(() => validator.parseCreateBody({ ...BODY, showToUsers: 1 })).toThrow(AppError);
  });

  it.each(['id', 'userid', 'dateadded', 'announcementid'])(
    'refuses a body carrying %s (strict: only the five saved fields)',
    (key) => {
      expect(refused(() => validator.parseCreateBody({ ...BODY, [key]: 1 })).code).toBe(
        'ERP-VALIDATION-0001',
      );
      expect(() => validator.parseUpdateBody({ ...BODY, [key]: 1 })).toThrow(AppError);
    },
  );

  it('update takes the same body, and an empty one is a 400', () => {
    expect(validator.parseUpdateBody(BODY)).toEqual(BODY);
    expect(() => validator.parseUpdateBody({})).toThrow(AppError);
  });
});
