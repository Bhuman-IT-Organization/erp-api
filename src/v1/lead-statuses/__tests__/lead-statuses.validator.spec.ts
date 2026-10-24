import { describe, expect, it } from 'vitest';

import { LeadStatusesValidator } from '../service/lead-statuses.validator.js';

import { LEAD_STATUSES_NAME_MAX, LEAD_STATUSES_SEARCH_MAX } from '../dto/lead-statuses.dto.js';

import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';

describe('LeadStatusesValidator', () => {
  const validator = new LeadStatusesValidator();

  describe('Path parameters', () => {
    it('accepts a valid lead status ID', () => {
      expect(validator.parseParams({ id: '5' })).toEqual({ id: 5 });
    });

    it('rejects an invalid ID', () => {
      expect(() => validator.parseParams({ id: 'abc' })).toThrow();
    });

    it('rejects zero and negative IDs', () => {
      expect(() => validator.parseParams({ id: '0' })).toThrow();

      expect(() => validator.parseParams({ id: '-1' })).toThrow();
    });
  });

  describe('Create validation', () => {
    it('accepts a valid status name', () => {
      expect(
        validator.parseCreateBody({
          name: 'New Lead',
        }),
      ).toEqual({
        name: 'New Lead',
      });
    });

    it('trims spaces from the name', () => {
      expect(
        validator.parseCreateBody({
          name: '  Contacted  ',
        }).name,
      ).toBe('Contacted');
    });

    it('accepts optional color and order', () => {
      expect(
        validator.parseCreateBody({
          name: 'Interested',
          color: '#123456',
          statusorder: 3,
        }),
      ).toEqual({
        name: 'Interested',
        color: '#123456',
        statusorder: 3,
      });
    });

    it('rejects an empty name', () => {
      expect(() =>
        validator.parseCreateBody({
          name: '',
        }),
      ).toThrow();
    });

    it('rejects names longer than 50 characters', () => {
      expect(() =>
        validator.parseCreateBody({
          name: 'A'.repeat(LEAD_STATUSES_NAME_MAX + 1),
        }),
      ).toThrow();
    });

    it('rejects unknown fields', () => {
      expect(() =>
        validator.parseCreateBody({
          name: 'New',
          isdefault: 1,
        }),
      ).toThrow();
    });

    it('rejects an invalid order type', () => {
      expect(() =>
        validator.parseCreateBody({
          name: 'New',
          statusorder: 'abc',
        }),
      ).toThrow();
    });
  });

  describe('Update validation', () => {
    it('accepts a valid update', () => {
      expect(
        validator.parseUpdateBody({
          name: 'Qualified',
          color: '#445566',
        }),
      ).toEqual({
        name: 'Qualified',
        color: '#445566',
      });
    });

    it('rejects an empty update body', () => {
      expect(() => validator.parseUpdateBody({})).toThrow();
    });

    it('rejects an empty status name', () => {
      expect(() =>
        validator.parseUpdateBody({
          name: ' ',
        }),
      ).toThrow();
    });
  });

  describe('List validation', () => {
    it('accepts an empty list query', () => {
      const result = validator.parseListQuery({});

      expect(result.cursor).toBeNull();
      expect(result.search).toBeNull();
      expect(result.limit).toBeGreaterThan(0);
    });

    it('accepts a valid search', () => {
      const result = validator.parseListQuery({
        q: 'Contacted',
      });

      expect(result.search).toBe('Contacted');
    });

    it('rejects an excessively long search', () => {
      expect(() =>
        validator.parseListQuery({
          q: 'A'.repeat(LEAD_STATUSES_SEARCH_MAX + 1),
        }),
      ).toThrow();
    });

    it('rejects an invalid sorting field', () => {
      expect(() =>
        validator.parseListQuery({
          sort: 'password',
        }),
      ).toThrow();
    });

    it('rejects a limit above the maximum', () => {
      expect(() =>
        validator.parseListQuery({
          limit: String(LIST_QUERY_LIMITS.max + 1),
        }),
      ).toThrow();
    });
  });

  describe('Export validation', () => {
    it('removes pagination cursors for exporting', () => {
      const result = validator.parseExportList({
        q: 'New',
      });

      expect(result.search).toBe('New');
      expect(result.cursor).toBeNull();
      expect(result.limit).toBe(LIST_QUERY_LIMITS.max);
    });
  });
});
