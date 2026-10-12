import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import { RetryLaterError } from '../../errors/retry-later.error.js';
import { UpstreamUnavailableError } from '../../errors/upstream-unavailable.error.js';
import { isTransientError } from '../transient-error.js';

describe('isTransientError', () => {
  it('is true for RetryLaterError: an upstream asked to try again later (ADR-0049)', () => {
    const error = new RetryLaterError('smtp', 'recipient_refused');
    expect(isTransientError(error)).toBe(true);
    expect(error.name).toBe('RetryLaterError');
    expect(error.message).toBe('smtp asked to retry later (recipient_refused)');
    expect(error).not.toBeInstanceOf(AppError);
  });

  it('stays false for an AppError', () => {
    expect(isTransientError(new AppError('ERP-VALIDATION-0001'))).toBe(false);
  });

  it('stays false for an open breaker (UpstreamUnavailableError)', () => {
    expect(isTransientError(new UpstreamUnavailableError('email', 10))).toBe(false);
  });

  it('stays true for a timeout code', () => {
    expect(isTransientError({ code: 'ETIMEDOUT' })).toBe(true);
  });
});
