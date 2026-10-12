/**
 * The ioredis adapter of `AuthSessionStore` on the auth logical database (`AUTH_REDIS_DB`,
 * ADR-0005: sessions never share a database with the cache, so a cache flush logs nobody out).
 *
 * Its own client, opened with the same fail-fast options as `RedisService` (ADR-0031 §4,
 * T-1.3-77): `lazyConnect`, `enableOfflineQueue: false` and the `TIMINGS.redis` timeouts, so a
 * dead Redis fails a login in about a second instead of buffering commands until memory runs
 * out. Values are JSON; TTLs are `PX` milliseconds passed by the caller from `TIMINGS.auth`.
 *
 * With `enableOfflineQueue: false` a command issued before the socket is open is refused, so
 * the connection is opened in `onModuleInit` — a process whose auth Redis is unreachable refuses
 * to boot rather than failing on the first login (T-1.3-11, env.schema.ts on REDIS_URL).
 *
 * Accepted race in `rotateSession`: the session JSON is read outside the MULTI and rewritten
 * inside it. Two concurrent refreshes of the same token both read the same `refreshHash`; the
 * first rotation wins, the second then presents a hash that no longer matches and trips reuse
 * detection — the designed outcome for a replayed refresh token, not a bug to lock around.
 */
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Redis } from 'ioredis';
import { AppConfig } from '../../../shared/config/app-config.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import type { Lockout, PermissionSnapshot, Session } from '../model/auth.model.js';
import { authKeys, type AuthSessionStore, type SessionRotation } from './auth-session.store.js';

@Injectable()
export class RedisAuthSessionStore implements AuthSessionStore, OnModuleInit, OnModuleDestroy {
  readonly client: Redis;

  constructor(config: AppConfig) {
    if (config.env.REDIS_URL === undefined) throw new Error('auth session store needs REDIS_URL');
    this.client = new Redis(authDatabaseUrl(config.env.REDIS_URL, config.env.AUTH_REDIS_DB), {
      db: config.env.AUTH_REDIS_DB,
      lazyConnect: true,
      maxRetriesPerRequest: TIMINGS.redis.maxRetriesPerRequest,
      enableOfflineQueue: false,
      connectTimeout: TIMINGS.redis.connectTimeoutMs,
      commandTimeout: TIMINGS.redis.commandTimeoutMs,
    });
    // Without a listener ioredis logs "Unhandled error event" on every failed connect; the
    // failure already surfaces on the command that needed the connection.
    this.client.on('error', () => undefined);
  }

  /** Opens the connection (once); throws when Redis is unreachable within `TIMINGS.redis.connectTimeoutMs`. */
  async onModuleInit(): Promise<void> {
    if (this.client.status === 'wait') await this.client.connect();
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      // Already disconnected or never connected: nothing to release.
    }
  }

  // --- sessions -------------------------------------------------------------------------------

  async createSession(staffId: number, session: Session, ttlMs: number): Promise<void> {
    await this.client
      .multi()
      .set(authKeys.sess(staffId, session.sid), JSON.stringify(session), 'PX', ttlMs)
      .sadd(authKeys.sessions(staffId), session.sid)
      .exec();
  }

  async getSession(staffId: number, sid: string): Promise<Session | null> {
    return parseJson(await this.client.get(authKeys.sess(staffId, sid))) as Session | null;
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
    await this.client
      .multi()
      .set(authKeys.sess(staffId, sid), JSON.stringify(rotated), 'PX', ttlMs)
      .exec();
  }

  async deleteSession(staffId: number, sid: string): Promise<void> {
    await this.client
      .multi()
      .del(authKeys.sess(staffId, sid))
      .srem(authKeys.sessions(staffId), sid)
      .exec();
  }

  listSessionIds(staffId: number): Promise<string[]> {
    return this.client.smembers(authKeys.sessions(staffId));
  }

  async revokeFamily(staffId: number, family: string): Promise<number> {
    const sids = await this.listSessionIds(staffId);
    if (sids.length === 0) return 0;
    const raws = await this.client.mget(sids.map((sid) => authKeys.sess(staffId, sid)));
    const matching = sids.filter(
      (_sid, i) => (parseJson(raws[i] ?? null) as Session | null)?.family === family,
    );
    if (matching.length === 0) return 0;
    await this.client
      .multi()
      .del(matching.map((sid) => authKeys.sess(staffId, sid)))
      .srem(authKeys.sessions(staffId), matching)
      .exec();
    return matching.length;
  }

  async deleteAllSessions(staffId: number): Promise<number> {
    const sids = await this.listSessionIds(staffId);
    const multi = this.client.multi().del(authKeys.sessions(staffId));
    if (sids.length > 0) multi.del(sids.map((sid) => authKeys.sess(staffId, sid)));
    await multi.exec();
    return sids.length;
  }

  // --- version ----------------------------------------------------------------------------------

  async getVersion(staffId: number): Promise<number> {
    const raw = await this.client.get(authKeys.version(staffId));
    return raw === null ? 0 : Number.parseInt(raw, 10);
  }

  bumpVersion(staffId: number): Promise<number> {
    return this.client.incr(authKeys.version(staffId));
  }

  // --- revoked jti ------------------------------------------------------------------------------

  async revokeJti(jti: string, ttlMs: number): Promise<void> {
    await this.client.set(authKeys.revoked(jti), '1', 'PX', ttlMs);
  }

  async isRevoked(jti: string): Promise<boolean> {
    return (await this.client.exists(authKeys.revoked(jti))) === 1;
  }

  // --- permissions ------------------------------------------------------------------------------

  async setPermissions(
    staffId: number,
    snapshot: PermissionSnapshot,
    ttlMs: number,
  ): Promise<void> {
    await this.client.set(authKeys.perm(staffId), JSON.stringify(snapshot), 'PX', ttlMs);
  }

  async getPermissions(staffId: number): Promise<PermissionSnapshot | null> {
    return parseJson(await this.client.get(authKeys.perm(staffId))) as PermissionSnapshot | null;
  }

  async deletePermissions(staffId: number): Promise<void> {
    await this.client.del(authKeys.perm(staffId));
  }

  // --- lockout ----------------------------------------------------------------------------------

  async getLockout(email: string): Promise<Lockout | null> {
    return parseJson(await this.client.get(authKeys.lockout(email))) as Lockout | null;
  }

  async setLockout(email: string, lockout: Lockout, ttlMs: number): Promise<void> {
    await this.client.set(authKeys.lockout(email), JSON.stringify(lockout), 'PX', ttlMs);
  }

  async clearLockout(email: string): Promise<void> {
    await this.client.del(authKeys.lockout(email));
  }
}

/**
 * `REDIS_URL` carries the cache database in its path (`redis://host:port/0`). ioredis merges the
 * URL before the options object with lodash `defaults`, so a `db` option does NOT override the
 * URL's path — the path must be rewritten to the auth database or sessions land in `/0` next to
 * the cache (proven by the int spec's `CLIENT INFO` assertion).
 */
export function authDatabaseUrl(redisUrl: string, db: number): string {
  const url = new URL(redisUrl);
  url.pathname = `/${String(db)}`;
  return url.toString();
}

/** Values are written by this class only, so the shape is trusted; `null` when the key is absent. */
function parseJson(raw: string | null): unknown {
  return raw === null ? null : JSON.parse(raw);
}
