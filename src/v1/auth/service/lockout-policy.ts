/**
 * Lockout backoff (ADR-0005, 07-security `auth:lockout:{email}`): a pure function of the failure
 * count and the clock, so the service only stores what it returns. Every number comes from
 * `TIMINGS.auth` — the threshold, the first lock and the cap; there is no literal here.
 *
 * With threshold 5 and base 1 min: failures 1–4 never lock, the 5th locks for 1 min, the 6th for
 * 2 min, the 7th for 4 min … capped at `lockoutMaxMs`. The store's TTL (`lockoutWindowMs`) resets
 * the counter when the e-mail goes quiet.
 */
import { TIMINGS } from '../../../shared/config/timings.js';
import type { Lockout } from '../model/auth.model.js';

const MS_PER_SECOND = 1_000;

/** The lockout after one more failure at `now` (epoch ms). */
export function nextLockout(previous: Lockout | null, now: number): Lockout {
  const { lockoutThreshold, lockoutBaseMs, lockoutMaxMs } = TIMINGS.auth;
  const failures = (previous?.failures ?? 0) + 1;
  if (failures < lockoutThreshold) return { failures, lockedUntil: null };
  const backoffMs = Math.min(lockoutBaseMs * 2 ** (failures - lockoutThreshold), lockoutMaxMs);
  return { failures, lockedUntil: now + backoffMs };
}

/** `true` while a lock's end lies in the future. */
export function isLocked(lockout: Lockout | null, now: number): boolean {
  return (
    lockout?.lockedUntil !== null && lockout?.lockedUntil !== undefined && lockout.lockedUntil > now
  );
}

/** Whole seconds until the lock ends, rounded up (the `Retry-After` value); `0` once it has ended. */
export function retryAfterS(lockout: Lockout, now: number): number {
  if (lockout.lockedUntil === null) return 0;
  return Math.max(0, Math.ceil((lockout.lockedUntil - now) / MS_PER_SECOND));
}
