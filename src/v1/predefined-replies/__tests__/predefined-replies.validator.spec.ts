import { describe, expect, it } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import { PredefinedRepliesValidator } from '../service/predefined-replies.validator.js';

describe('PredefinedRepliesValidator', () => {
  const validator = new PredefinedRepliesValidator();

  it('accepts a valid positive integer ID', () => {
    expect(validator.parseParams({ id: '12' })).toEqual({ id: 12 });
  });

  it.each(['abc', '0', '-1', '1.5'])('rejects invalid ID: %s', (id) => {
    expect(() => validator.parseParams({ id })).toThrow(AppError);
  });

  it('trims whitespace from a valid name', () => {
    expect(
      validator.parseCreateBody({
        name: '  Welcome reply  ',
        message: '<p>Hello!</p>',
      }).name,
    ).toBe('Welcome reply');
  });

  it('accepts a name containing 191 characters', () => {
    expect(
      validator.parseCreateBody({
        name: 'a'.repeat(191),
        message: 'Hello',
      }).name,
    ).toHaveLength(191);
  });

  it('rejects a name exceeding 191 characters', () => {
    expect(() =>
      validator.parseCreateBody({
        name: 'a'.repeat(192),
        message: 'Hello',
      }),
    ).toThrow(AppError);
  });

  it.each(['', '   '])('rejects an empty or whitespace-only name: %j', (name) => {
    expect(() =>
      validator.parseCreateBody({
        name,
        message: 'Hello',
      }),
    ).toThrow(AppError);
  });

  it('rejects a missing name', () => {
    expect(() =>
      validator.parseCreateBody({
        message: 'Hello',
      }),
    ).toThrow(AppError);
  });

  it('rejects a missing or empty message', () => {
    expect(() =>
      validator.parseCreateBody({
        name: 'Welcome',
      }),
    ).toThrow(AppError);

    expect(() =>
      validator.parseCreateBody({
        name: 'Welcome',
        message: '   ',
      }),
    ).toThrow(AppError);
  });

  it('rejects unexpected fields', () => {
    expect(() =>
      validator.parseCreateBody({
        name: 'Welcome',
        message: 'Hello',
        extra: true,
      }),
    ).toThrow(AppError);
  });

  it('validates update bodies using the same rules as create bodies', () => {
    expect(
      validator.parseUpdateBody({
        name: 'Updated reply',
        message: '<p>Updated message</p>',
      }).name,
    ).toBe('Updated reply');
  });

  it('uses the standard validation error code for invalid input', () => {
    try {
      validator.parseCreateBody({ name: '', message: 'Hello' });
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);

      if (error instanceof AppError) {
        expect(error.code).toBe('ERP-VALIDATION-0001');
      }
    }
  });
});
