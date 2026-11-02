/**
 * Validator: the request parsing is pure, so these specs need no database or Nest app.
 */
import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { CUSTOMER_GROUPS_NAME_MAX } from '../dto/customer-groups.dto.js';
import { CustomerGroupsValidator } from '../service/customer-groups.validator.js';

const validator = new CustomerGroupsValidator();

describe('CustomerGroupsValidator.parseParams', () => {
  it('reads a positive integer id from a string', () => {
    expect(validator.parseParams({ id: '5' })).toEqual({ id: 5 });
  });

  it.each(['abc', '0', '-3', '1.5', ''])('refuses the id %j', (id) => {
    expect(() => validator.parseParams({ id })).toThrow(AppError);
  });
});

describe('CustomerGroupsValidator.parseCreateBody', () => {
  it('keeps the trimmed name', () => {
    expect(validator.parseCreateBody({ name: '  VIP  ' })).toEqual({ name: 'VIP' });
  });

  it('accepts a name of exactly the maximum length', () => {
    const name = 'a'.repeat(CUSTOMER_GROUPS_NAME_MAX);
    expect(validator.parseCreateBody({ name })).toEqual({ name });
  });

  it('refuses an empty name, a blank name and a missing name', () => {
    expect(() => validator.parseCreateBody({ name: '' })).toThrow(AppError);
    expect(() => validator.parseCreateBody({ name: '   ' })).toThrow(AppError);
    expect(() => validator.parseCreateBody({})).toThrow(AppError);
  });

  it('refuses a name longer than the maximum', () => {
    const name = 'a'.repeat(CUSTOMER_GROUPS_NAME_MAX + 1);
    expect(() => validator.parseCreateBody({ name })).toThrow(AppError);
  });

  it('refuses any other key (the body is strict)', () => {
    expect(() => validator.parseCreateBody({ name: 'VIP', id: 9 })).toThrow(AppError);
  });
});

describe('CustomerGroupsValidator.parseUpdateBody', () => {
  it('keeps the trimmed name', () => {
    expect(validator.parseUpdateBody({ name: ' Gold ' })).toEqual({ name: 'Gold' });
  });

  it('refuses an empty body', () => {
    expect(() => validator.parseUpdateBody({})).toThrow(AppError);
  });
});

describe('CustomerGroupsValidator.parseListQuery', () => {
  it('defaults to the name descending with no search and no cursor', () => {
    const request = validator.parseListQuery({});
    expect(request.sortField).toBe('name');
    expect(request.order).toBe('desc');
    expect(request.search).toBeNull();
    expect(request.cursor).toBeNull();
  });

  it('reads the search and the name sort', () => {
    const request = validator.parseListQuery({ q: 'vip', sort: 'name' });
    expect(request.search).toBe('vip');
    expect(request.sortField).toBe('name');
    expect(request.order).toBe('asc');
  });

  it('treats an empty search as no search', () => {
    expect(validator.parseListQuery({ q: '' }).search).toBeNull();
  });

  it('refuses a search longer than 100 characters', () => {
    expect(() => validator.parseListQuery({ q: 'a'.repeat(101) })).toThrow(AppError);
  });

  it('refuses a sort on a column the list does not offer', () => {
    expect(() => validator.parseListQuery({ sort: 'datecreated' })).toThrow(AppError);
  });
});
