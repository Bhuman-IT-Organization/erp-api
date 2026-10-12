import { describe, expect, it } from 'vitest';
import { TIMINGS } from '../../../shared/config/timings.js';
import type { Lockout } from '../model/auth.model.js';
import { isLocked, nextLockout, retryAfterS } from '../service/lockout-policy.js';

const { lockoutThreshold, lockoutBaseMs, lockoutMaxMs } = TIMINGS.auth;
const NOW = 1_700_000_000_000; // a fixed clock; the policy never reads Date.now

/** `n` consecutive failures at `now`, starting from nothing. */
function afterFailures(n: number, now = NOW): Lockout {
  let lockout: Lockout | null = null;
  for (let i = 0; i < n; i += 1) lockout = nextLockout(lockout, now);
  if (lockout === null) throw new Error('n must be >= 1');
  return lockout;
}

describe('lockout policy (pure, TIMINGS.auth)', () => {
  it('counts failures below the threshold without locking', () => {
    for (let n = 1; n < lockoutThreshold; n += 1) {
      const lockout = afterFailures(n);
      expect(lockout).toEqual({ failures: n, lockedUntil: null });
      expect(isLocked(lockout, NOW)).toBe(false);
    }
  });

  it('locks for lockoutBaseMs on the threshold failure', () => {
    expect(afterFailures(lockoutThreshold)).toEqual({
      failures: lockoutThreshold,
      lockedUntil: NOW + lockoutBaseMs,
    });
  });

  it('doubles on the next failure', () => {
    expect(afterFailures(lockoutThreshold + 1).lockedUntil).toBe(NOW + 2 * lockoutBaseMs);
    expect(afterFailures(lockoutThreshold + 2).lockedUntil).toBe(NOW + 4 * lockoutBaseMs);
  });

  it('caps at lockoutMaxMs', () => {
    expect(afterFailures(lockoutThreshold + 4).lockedUntil).toBe(NOW + lockoutMaxMs);
    expect(afterFailures(lockoutThreshold + 40).lockedUntil).toBe(NOW + lockoutMaxMs);
  });

  it('continues from a stored lockout', () => {
    const stored: Lockout = { failures: lockoutThreshold - 1, lockedUntil: null };
    expect(nextLockout(stored, NOW)).toEqual({
      failures: lockoutThreshold,
      lockedUntil: NOW + lockoutBaseMs,
    });
  });

  it('isLocked is true until the lock ends and false from that instant', () => {
    const lockout = afterFailures(lockoutThreshold);
    expect(isLocked(lockout, NOW)).toBe(true);
    expect(isLocked(lockout, NOW + lockoutBaseMs - 1)).toBe(true);
    expect(isLocked(lockout, NOW + lockoutBaseMs)).toBe(false);
    expect(isLocked(null, NOW)).toBe(false);
  });

  it('retryAfterS rounds up to whole seconds and is 0 once the lock has ended', () => {
    const lockout = afterFailures(lockoutThreshold);
    expect(retryAfterS(lockout, NOW)).toBe(lockoutBaseMs / 1_000);
    expect(retryAfterS(lockout, NOW + 1)).toBe(lockoutBaseMs / 1_000);
    expect(retryAfterS(lockout, NOW + lockoutBaseMs - 1)).toBe(1);
    expect(retryAfterS(lockout, NOW + lockoutBaseMs)).toBe(0);
    expect(retryAfterS(lockout, NOW + lockoutBaseMs + 5_000)).toBe(0);
    expect(retryAfterS({ failures: 1, lockedUntil: null }, NOW)).toBe(0);
  });
});
