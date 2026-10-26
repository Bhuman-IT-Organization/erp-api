import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { SERVICES_NAME_MAX } from '../dto/services.dto.js';
import { ServicesValidator } from '../service/services.validator.js';

const validator = new ServicesValidator();

describe('ServicesValidator', () => {
  describe('parseListQuery', () => {
    it('defaults to the id descending, no search, no cursor (Perfex order)', () => {
      const request = validator.parseListQuery({});
      expect(request.sortField).toBe('id');
      expect(request.order).toBe('desc');
      expect(request.search).toBeNull();
      expect(request.cursor).toBeNull();
    });

    it('reads one sort segment, a leading minus is descending', () => {
      expect(validator.parseListQuery({ sort: 'name' })).toMatchObject({
        sortField: 'name',
        order: 'asc',
      });
      expect(validator.parseListQuery({ sort: '-name' })).toMatchObject({
        sortField: 'name',
        order: 'desc',
      });
    });

    it('refuses a sort on a column the list does not offer', () => {
      expect(() => validator.parseListQuery({ sort: 'created' })).toThrow(AppError);
    });

    it('refuses two sort segments', () => {
      expect(() => validator.parseListQuery({ sort: 'id,name' })).toThrow(AppError);
    });

    it('keeps q, and treats an empty q as no search', () => {
      expect(validator.parseListQuery({ q: 'gold' }).search).toBe('gold');
      expect(validator.parseListQuery({ q: '' }).search).toBeNull();
    });

    it('refuses a q longer than the maximum', () => {
      expect(() => validator.parseListQuery({ q: 'x'.repeat(101) })).toThrow(AppError);
    });

    it('refuses a cursor that is not a cursor of this list', () => {
      expect(() => validator.parseListQuery({ cursor: 'not-a-cursor' })).toThrow(AppError);
    });
  });

  describe('parseExportList', () => {
    it('drops the cursor and reads every row in batches', () => {
      const request = validator.parseExportList({ q: 'a' });
      expect(request.cursor).toBeNull();
      expect(request.search).toBe('a');
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
    it('trims the name', () => {
      expect(validator.parseCreateBody({ name: '  Support  ' })).toEqual({ name: 'Support' });
      expect(validator.parseUpdateBody({ name: ' Gold ' })).toEqual({ name: 'Gold' });
    });

    it('accepts a name of exactly the maximum length', () => {
      const name = 'a'.repeat(SERVICES_NAME_MAX);
      expect(validator.parseCreateBody({ name })).toEqual({ name });
    });

    it('refuses an empty or blank name', () => {
      expect(() => validator.parseCreateBody({ name: '' })).toThrow(AppError);
      expect(() => validator.parseCreateBody({ name: '   ' })).toThrow(AppError);
    });

    it('refuses a name longer than 50 characters (tblservices.name is VARCHAR(50))', () => {
      expect(() => validator.parseCreateBody({ name: 'a'.repeat(SERVICES_NAME_MAX + 1) })).toThrow(
        AppError,
      );
    });

    it('refuses a missing name and any other key (strict body, D-26)', () => {
      expect(() => validator.parseCreateBody({})).toThrow(AppError);
      expect(() => validator.parseCreateBody({ name: 'a', serviceid: 3 })).toThrow(AppError);
      expect(() => validator.parseUpdateBody({})).toThrow(AppError);
    });

    it('accepts markup in a name: it is stored and shown as text', () => {
      expect(validator.parseCreateBody({ name: '<b>VIP</b>' })).toEqual({ name: '<b>VIP</b>' });
    });
  });
});
