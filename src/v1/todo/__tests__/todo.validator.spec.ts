import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import { TODO_DEFAULT_LIMIT, TODO_DESCRIPTION_MAX } from '../dto/todo.dto.js';
import { encodeTodoCursor } from '../repository/todo.cursor.js';
import { TodoValidator } from '../service/todo.validator.js';

const validator = new TodoValidator();

describe('TodoValidator', () => {
  describe('parseListQuery', () => {
    it('defaults to 10 rows and starts without a cursor', () => {
      expect(validator.parseListQuery({ status: 'unfinished' })).toEqual({
        status: 'unfinished',
        limit: TODO_DEFAULT_LIMIT,
        cursor: null,
      });

      expect(validator.parseListQuery({ status: 'finished' }).status).toBe('finished');
    });

    it('refuses a missing or unknown status', () => {
      expect(() => validator.parseListQuery({})).toThrow(AppError);
      expect(() => validator.parseListQuery({ status: 'done' })).toThrow(AppError);
    });

    it('reads limit as a number and refuses one outside the shared bounds', () => {
      expect(validator.parseListQuery({ status: 'unfinished', limit: '5' }).limit).toBe(5);

      expect(() =>
        validator.parseListQuery({
          status: 'unfinished',
          limit: String(LIST_QUERY_LIMITS.max + 1),
        }),
      ).toThrow(AppError);

      expect(() => validator.parseListQuery({ status: 'unfinished', limit: '0' })).toThrow(
        AppError,
      );
    });

    it('decodes the keyset cursor', () => {
      const cursor = { itemOrder: 4, todoid: 40 };

      expect(
        validator.parseListQuery({
          status: 'unfinished',
          cursor: encodeTodoCursor(cursor),
        }).cursor,
      ).toEqual(cursor);
    });

    it('decodes a cursor with null item order', () => {
      const cursor = { itemOrder: null, todoid: 40 };

      expect(
        validator.parseListQuery({
          status: 'unfinished',
          cursor: encodeTodoCursor(cursor),
        }).cursor,
      ).toEqual(cursor);
    });

    it('refuses an invalid cursor', () => {
      for (const cursor of [
        'not-a-cursor',
        Buffer.from('{"itemOrder":-1,"todoid":0}').toString('base64url'),
      ]) {
        expect(() => validator.parseListQuery({ status: 'unfinished', cursor })).toThrow(AppError);
      }
    });
  });

  describe('parseParams', () => {
    it('reads a positive integer id', () => {
      expect(validator.parseParams({ id: '7' })).toEqual({ id: 7 });
    });

    it.each(['0', '-1', 'abc', '1.5', ''])('refuses the id %j (a 400, never a 404 probe)', (id) => {
      expect(() => validator.parseParams({ id })).toThrow(AppError);
    });
  });

  describe('parseCreateBody and parseUpdateBody', () => {
    it('trims the description', () => {
      expect(validator.parseCreateBody({ description: '  Call Ali  ' })).toEqual({
        description: 'Call Ali',
      });

      expect(validator.parseUpdateBody({ description: ' x ' })).toEqual({
        description: 'x',
      });
    });

    it('refuses a missing, empty or blank description', () => {
      expect(() => validator.parseCreateBody({})).toThrow(AppError);
      expect(() => validator.parseCreateBody({ description: '' })).toThrow(AppError);
      expect(() => validator.parseCreateBody({ description: '   ' })).toThrow(AppError);
    });

    it('accepts the maximum length and refuses one more', () => {
      const ok = 'a'.repeat(TODO_DESCRIPTION_MAX);

      expect(validator.parseCreateBody({ description: ok })).toEqual({
        description: ok,
      });

      expect(() => validator.parseCreateBody({ description: `${ok}a` })).toThrow(AppError);
    });

    it('is strict: any other key is a 400 (staffid, finished, ...)', () => {
      expect(() => validator.parseCreateBody({ description: 'a', staffid: 9 })).toThrow(AppError);

      expect(() => validator.parseUpdateBody({ description: 'a', finished: true })).toThrow(
        AppError,
      );
    });

    it('keeps markup as text', () => {
      expect(validator.parseCreateBody({ description: '<b>x</b>' })).toEqual({
        description: '<b>x</b>',
      });
    });
  });

  describe('parseFinishBody', () => {
    it('reads a boolean', () => {
      expect(validator.parseFinishBody({ finished: true })).toEqual({
        finished: true,
      });

      expect(validator.parseFinishBody({ finished: false })).toEqual({
        finished: false,
      });
    });

    it('refuses a non-boolean, a missing key and any other key', () => {
      expect(() => validator.parseFinishBody({ finished: 'yes' })).toThrow(AppError);
      expect(() => validator.parseFinishBody({})).toThrow(AppError);

      expect(() => validator.parseFinishBody({ finished: true, description: 'x' })).toThrow(
        AppError,
      );
    });
  });
});
