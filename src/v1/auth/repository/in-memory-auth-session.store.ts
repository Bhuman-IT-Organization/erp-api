/**
 * The port's fake for unit tests: a `Map` keyed by the SAME `authKeys` strings as Redis, with
 * per-entry expiry against an injectable clock so TTL behaviour is testable without waiting.
 * Never used at runtime — `AuthModule` binds `RedisAuthSessionStore`.
 */
import type { Lockout, PermissionSnapshot, Session } from '../model/auth.model.js';
import { authKeys, type AuthSessionStore, type SessionRotation } from './auth-session.store.js';

interface Entry {
  value: string;
  /** Epoch ms; `null` = no expiry. */
  expiresAt: number | null;
}

export class InMemoryAuthSessionStore implements AuthSessionStore {
  private readonly entries = new Map<string, Entry>();
  private readonly sets = new Map<string, Set<string>>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  // --- sessions -------------------------------------------------------------------------------

  createSession(staffId: number, session: Session, ttlMs: number): Promise<void> {
    this.set(authKeys.sess(staffId, session.sid), JSON.stringify(session), ttlMs);
    this.members(authKeys.sessions(staffId)).add(session.sid);
    return Promise.resolve();
  }

  getSession(staffId: number, sid: string): Promise<Session | null> {
    return Promise.resolve(this.getJson(authKeys.sess(staffId, sid)) as Session | null);
  }

  async rotateSession(
    staffId: number,
    sid: string,
    next: SessionRotation,
    ttlMs: number,
  ): Promise<void> {
    const current = await this.getSession(staffId, sid);
    if (current === null) return;
    const rotated: Session = { ...current, ...next };
    this.set(authKeys.sess(staffId, sid), JSON.stringify(rotated), ttlMs);
  }

  deleteSession(staffId: number, sid: string): Promise<void> {
    this.entries.delete(authKeys.sess(staffId, sid));
    this.members(authKeys.sessions(staffId)).delete(sid);
    return Promise.resolve();
  }

  listSessionIds(staffId: number): Promise<string[]> {
    return Promise.resolve([...this.members(authKeys.sessions(staffId))]);
  }

  async revokeFamily(staffId: number, family: string): Promise<number> {
    let count = 0;
    for (const sid of await this.listSessionIds(staffId)) {
      const session = await this.getSession(staffId, sid);
      if (session?.family === family) {
        await this.deleteSession(staffId, sid);
        count += 1;
      }
    }
    return count;
  }

  async deleteAllSessions(staffId: number): Promise<number> {
    const sids = await this.listSessionIds(staffId);
    for (const sid of sids) await this.deleteSession(staffId, sid);
    this.sets.delete(authKeys.sessions(staffId));
    return sids.length;
  }

  // --- version ----------------------------------------------------------------------------------

  getVersion(staffId: number): Promise<number> {
    const raw = this.get(authKeys.version(staffId));
    return Promise.resolve(raw === null ? 0 : Number.parseInt(raw, 10));
  }

  async bumpVersion(staffId: number): Promise<number> {
    const next = (await this.getVersion(staffId)) + 1;
    this.set(authKeys.version(staffId), String(next), null);
    return next;
  }

  // --- revoked jti ------------------------------------------------------------------------------

  revokeJti(jti: string, ttlMs: number): Promise<void> {
    this.set(authKeys.revoked(jti), '1', ttlMs);
    return Promise.resolve();
  }

  isRevoked(jti: string): Promise<boolean> {
    return Promise.resolve(this.get(authKeys.revoked(jti)) !== null);
  }

  // --- permissions ------------------------------------------------------------------------------

  setPermissions(staffId: number, snapshot: PermissionSnapshot, ttlMs: number): Promise<void> {
    this.set(authKeys.perm(staffId), JSON.stringify(snapshot), ttlMs);
    return Promise.resolve();
  }

  getPermissions(staffId: number): Promise<PermissionSnapshot | null> {
    return Promise.resolve(this.getJson(authKeys.perm(staffId)) as PermissionSnapshot | null);
  }

  deletePermissions(staffId: number): Promise<void> {
    this.entries.delete(authKeys.perm(staffId));
    return Promise.resolve();
  }

  // --- lockout ----------------------------------------------------------------------------------

  getLockout(email: string): Promise<Lockout | null> {
    return Promise.resolve(this.getJson(authKeys.lockout(email)) as Lockout | null);
  }

  setLockout(email: string, lockout: Lockout, ttlMs: number): Promise<void> {
    this.set(authKeys.lockout(email), JSON.stringify(lockout), ttlMs);
    return Promise.resolve();
  }

  clearLockout(email: string): Promise<void> {
    this.entries.delete(authKeys.lockout(email));
    return Promise.resolve();
  }

  // --- test helpers -----------------------------------------------------------------------------

  /** Every live key, for assertions on the exact names. */
  keys(): string[] {
    return [...this.entries.keys()]
      .filter((key) => this.get(key) !== null)
      .concat([...this.sets.entries()].filter(([, set]) => set.size > 0).map(([key]) => key));
  }

  // --- internals --------------------------------------------------------------------------------

  private set(key: string, value: string, ttlMs: number | null): void {
    this.entries.set(key, { value, expiresAt: ttlMs === null ? null : this.now() + ttlMs });
  }

  /** Drops an expired entry on read, as Redis would. */
  private get(key: string): string | null {
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAt !== null && entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.value;
  }

  private getJson(key: string): unknown {
    const raw = this.get(key);
    return raw === null ? null : JSON.parse(raw);
  }

  private members(key: string): Set<string> {
    let set = this.sets.get(key);
    if (set === undefined) {
      set = new Set();
      this.sets.set(key, set);
    }
    return set;
  }
}
