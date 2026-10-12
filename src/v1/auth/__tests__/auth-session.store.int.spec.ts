/**
 * Against the local Redis (REDIS_URL from ../erp-infra/env/local/api.host.env), on the auth
 * database AUTH_REDIS_DB. Uses a staff id no real row has and random ids; deletes every key it
 * created by exact name in afterAll — never a FLUSH (T-1.3-30).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import type { Session } from '../model/auth.model.js';
import { authKeys } from '../repository/auth-session.store.js';
import { RedisAuthSessionStore } from '../repository/redis-auth-session.store.js';

const STAFF = 999_999;
const TTL = 60_000;
const EMAIL = `int-${randomUUID()}@example.test`;

function session(sid: string, family: string, refreshHash = `hash-${sid}`): Session {
  const now = new Date().toISOString();
  return {
    sid,
    family,
    refreshHash,
    device: 'int-spec',
    ip: '127.0.0.1',
    createdAt: now,
    lastSeenAt: now,
    expiresAt: now,
  };
}

describe.skipIf(!process.env.REDIS_URL)('RedisAuthSessionStore against the local Redis', () => {
  const config = new AppConfig();
  const store = new RedisAuthSessionStore(config);
  const { client } = store;
  const sidA1 = randomUUID();
  const sidA2 = randomUUID();
  const sidB1 = randomUUID();
  const jti = randomUUID();
  const created = [
    authKeys.sess(STAFF, sidA1),
    authKeys.sess(STAFF, sidA2),
    authKeys.sess(STAFF, sidB1),
    authKeys.sessions(STAFF),
    authKeys.version(STAFF),
    authKeys.revoked(jti),
    authKeys.perm(STAFF),
    authKeys.lockout(EMAIL),
  ];

  beforeAll(async () => {
    await store.onModuleInit();
  });

  afterAll(async () => {
    try {
      await client.del(created);
    } finally {
      await store.onModuleDestroy();
    }
  });

  it('opens its client on AUTH_REDIS_DB (on the wire, not only in options) with the fail-fast options', async () => {
    expect(client.options.db).toBe(config.env.AUTH_REDIS_DB);
    const info = String(await client.call('CLIENT', 'INFO'));
    expect(info.split(' ')).toContain(`db=${String(config.env.AUTH_REDIS_DB)}`);
    expect(client.options.enableOfflineQueue).toBe(false);
    expect(client.options.maxRetriesPerRequest).toBe(TIMINGS.redis.maxRetriesPerRequest);
    expect(client.options.connectTimeout).toBe(TIMINGS.redis.connectTimeoutMs);
    expect(client.options.commandTimeout).toBe(TIMINGS.redis.commandTimeoutMs);
  });

  it('createSession writes the JSON with PX within the TTL window and a SET of sids', async () => {
    const first = session(sidA1, sidA1);
    await store.createSession(STAFF, first, TTL);
    const pttl = await client.pttl(authKeys.sess(STAFF, sidA1));
    expect(pttl).toBeGreaterThan(TTL - 5_000);
    expect(pttl).toBeLessThanOrEqual(TTL);
    await expect(client.type(authKeys.sessions(STAFF))).resolves.toBe('set');
    await expect(store.listSessionIds(STAFF)).resolves.toEqual([sidA1]);
    await expect(store.getSession(STAFF, sidA1)).resolves.toEqual(first);
  });

  it('rotateSession changes refreshHash, keeps family and refreshes the PTTL', async () => {
    await client.pexpire(authKeys.sess(STAFF, sidA1), TTL / 2);
    await store.rotateSession(
      STAFF,
      sidA1,
      { refreshHash: 'rotated', lastSeenAt: 'later', expiresAt: 'much-later' },
      TTL,
    );
    const rotated = await store.getSession(STAFF, sidA1);
    expect(rotated).toMatchObject({ sid: sidA1, family: sidA1, refreshHash: 'rotated' });
    expect(await client.pttl(authKeys.sess(STAFF, sidA1))).toBeGreaterThan(TTL / 2);
  });

  it('revokeFamily deletes the family only and returns the count', async () => {
    await store.createSession(STAFF, session(sidA2, sidA1), TTL);
    await store.createSession(STAFF, session(sidB1, sidB1), TTL);
    await expect(store.revokeFamily(STAFF, sidA1)).resolves.toBe(2);
    await expect(client.exists(authKeys.sess(STAFF, sidA1))).resolves.toBe(0);
    await expect(client.exists(authKeys.sess(STAFF, sidA2))).resolves.toBe(0);
    await expect(client.exists(authKeys.sess(STAFF, sidB1))).resolves.toBe(1);
    await expect(store.listSessionIds(STAFF)).resolves.toEqual([sidB1]);
  });

  it('deleteAllSessions removes the remaining session and the set', async () => {
    await expect(store.deleteAllSessions(STAFF)).resolves.toBe(1);
    await expect(client.exists(authKeys.sess(STAFF, sidB1))).resolves.toBe(0);
    await expect(client.exists(authKeys.sessions(STAFF))).resolves.toBe(0);
  });

  it('version is 0 when absent and INCRs', async () => {
    await client.del(authKeys.version(STAFF));
    await expect(store.getVersion(STAFF)).resolves.toBe(0);
    await expect(store.bumpVersion(STAFF)).resolves.toBe(1);
    await expect(store.bumpVersion(STAFF)).resolves.toBe(2);
    await expect(store.getVersion(STAFF)).resolves.toBe(2);
  });

  it('revokeJti sets 1 with PTTL ≤ ttl and isRevoked sees it', async () => {
    await store.revokeJti(jti, TTL);
    await expect(client.get(authKeys.revoked(jti))).resolves.toBe('1');
    const pttl = await client.pttl(authKeys.revoked(jti));
    expect(pttl).toBeGreaterThan(0);
    expect(pttl).toBeLessThanOrEqual(TTL);
    await expect(store.isRevoked(jti)).resolves.toBe(true);
    await expect(store.isRevoked(randomUUID())).resolves.toBe(false);
  });

  it('permission snapshot round trip with PTTL', async () => {
    const snapshot = {
      v: 1 as const,
      staffId: STAFF,
      isAdmin: true,
      roleId: null,
      codes: ['invoices.view'],
      builtAt: new Date().toISOString(),
    };
    await store.setPermissions(STAFF, snapshot, TTL);
    await expect(store.getPermissions(STAFF)).resolves.toEqual(snapshot);
    expect(await client.pttl(authKeys.perm(STAFF))).toBeGreaterThan(0);
  });

  it('deletePermissions removes auth:perm:{staffId} from Redis and is a no-op when absent', async () => {
    await store.setPermissions(
      STAFF,
      {
        v: 1 as const,
        staffId: STAFF,
        isAdmin: false,
        roleId: 2,
        codes: ['staff.members.view'],
        builtAt: new Date().toISOString(),
      },
      TTL,
    );
    expect(await client.exists(authKeys.perm(STAFF))).toBe(1);

    await store.deletePermissions(STAFF);
    expect(await client.exists(authKeys.perm(STAFF))).toBe(0);
    await expect(store.getPermissions(STAFF)).resolves.toBeNull();

    // Absent key: no error, and the token version beside it is untouched.
    await store.bumpVersion(STAFF);
    const version = await store.getVersion(STAFF);
    await expect(store.deletePermissions(STAFF)).resolves.toBeUndefined();
    await expect(store.getVersion(STAFF)).resolves.toBe(version);
  });

  it('lockout round trip and null after clearLockout', async () => {
    await store.setLockout(EMAIL, { failures: 2, lockedUntil: null }, TTL);
    await expect(store.getLockout(EMAIL)).resolves.toEqual({ failures: 2, lockedUntil: null });
    await store.clearLockout(EMAIL);
    await expect(store.getLockout(EMAIL)).resolves.toBeNull();
  });
});

describe('RedisAuthSessionStore construction', () => {
  it('throws without REDIS_URL', () => {
    const config = { env: { REDIS_URL: undefined, AUTH_REDIS_DB: 1 } } as unknown as AppConfig;
    expect(() => new RedisAuthSessionStore(config)).toThrow('auth session store needs REDIS_URL');
  });
});
