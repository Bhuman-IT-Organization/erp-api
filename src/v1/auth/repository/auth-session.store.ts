/**
 * The Redis-backed session state behind a port (ADR-0005; research Pattern 2). The service
 * depends on `AUTH_SESSION_STORE`; `RedisAuthSessionStore` is the runtime adapter and
 * `InMemoryAuthSessionStore` the unit-test fake. Both key their data with `authKeys`, so unit
 * tests assert the real key names without Redis.
 *
 * The key builders do not normalise: the caller passes the e-mail already lowercased and
 * trimmed (the validator's job), so one account cannot own two lockout counters.
 */
import type { Lockout, PermissionSnapshot, Session } from '../model/auth.model.js';

export const AUTH_SESSION_STORE = Symbol('AUTH_SESSION_STORE');

/** Exactly the key layout of 07-security; the only place these strings are spelled. */
export const authKeys = Object.freeze({
  /** JSON `Session`, sliding PX = refresh TTL. */
  sess: (staffId: number, sid: string): string => `auth:sess:${String(staffId)}:${sid}`,
  /** SET of `sid`. */
  sessions: (staffId: number): string => `auth:user:${String(staffId)}:sessions`,
  /** Integer; absent ⇒ 0. */
  version: (staffId: number): string => `auth:user:${String(staffId)}:version`,
  /** `1`, PX = remaining access-token life. */
  revoked: (jti: string): string => `auth:revoked:${jti}`,
  /** JSON `PermissionSnapshot`, PX = refresh TTL. */
  perm: (staffId: number): string => `auth:perm:${String(staffId)}`,
  /** JSON `Lockout`, PX = lockout window; e-mail normalised by the caller. */
  lockout: (email: string): string => `auth:lockout:${email}`,
});

/** What rotation replaces on a session: a new refresh hash and the sliding timestamps. */
export interface SessionRotation {
  readonly refreshHash: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
}

export interface AuthSessionStore {
  createSession(staffId: number, session: Session, ttlMs: number): Promise<void>;
  getSession(staffId: number, sid: string): Promise<Session | null>;
  /** Replaces `refreshHash`/`lastSeenAt`/`expiresAt`, keeps `sid` and `family`, resets the TTL. No-op when the session is gone. */
  rotateSession(staffId: number, sid: string, next: SessionRotation, ttlMs: number): Promise<void>;
  deleteSession(staffId: number, sid: string): Promise<void>;
  listSessionIds(staffId: number): Promise<string[]>;
  /** Deletes every session of the family (reuse detection); returns how many. */
  revokeFamily(staffId: number, family: string): Promise<number>;
  /** Logout everywhere; returns how many sessions were deleted. */
  deleteAllSessions(staffId: number): Promise<number>;
  getVersion(staffId: number): Promise<number>;
  /** Returns the new version. */
  bumpVersion(staffId: number): Promise<number>;
  revokeJti(jti: string, ttlMs: number): Promise<void>;
  isRevoked(jti: string): Promise<boolean>;
  setPermissions(staffId: number, snapshot: PermissionSnapshot, ttlMs: number): Promise<void>;
  getPermissions(staffId: number): Promise<PermissionSnapshot | null>;
  /**
   * Drops the snapshot: `DEL auth:perm:{staffId}`. An absent key is not an error. The next read
   * rebuilds from the rows, so this is how a permission change takes effect at once instead of
   * waiting for the next refresh (ADR-0033 decision 6); the `identity.permissions.replaced`
   * subscriber calls it. Never touches `auth:user:{id}:version` — that is the token-version key.
   */
  deletePermissions(staffId: number): Promise<void>;
  getLockout(email: string): Promise<Lockout | null>;
  setLockout(email: string, lockout: Lockout, ttlMs: number): Promise<void>;
  clearLockout(email: string): Promise<void>;
}
