import { beforeEach, describe, expect, it } from 'vitest';
import type { Lockout, PermissionSnapshot, Session } from '../model/auth.model.js';
import { authKeys } from '../repository/auth-session.store.js';
import { InMemoryAuthSessionStore } from '../repository/in-memory-auth-session.store.js';
import { authDatabaseUrl } from '../repository/redis-auth-session.store.js';

const STAFF = 7;
const TTL = 10_000;

function session(sid: string, family: string, refreshHash = `hash-${sid}`): Session {
  return {
    sid,
    family,
    refreshHash,
    device: 'test-agent',
    ip: '127.0.0.1',
    createdAt: '2026-09-19T00:00:00.000Z',
    lastSeenAt: '2026-09-19T00:00:00.000Z',
    expiresAt: '2026-10-19T00:00:00.000Z',
  };
}

describe('authKeys (the 07-security layout)', () => {
  it.each([
    ['sess', authKeys.sess(7, 's1'), 'auth:sess:7:s1'],
    ['sessions', authKeys.sessions(7), 'auth:user:7:sessions'],
    ['version', authKeys.version(7), 'auth:user:7:version'],
    ['revoked', authKeys.revoked('j1'), 'auth:revoked:j1'],
    ['perm', authKeys.perm(7), 'auth:perm:7'],
    ['lockout', authKeys.lockout('a@b.c'), 'auth:lockout:a@b.c'],
  ])('%s builds the exact key', (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it('does not normalise the e-mail (the caller does)', () => {
    expect(authKeys.lockout(' A@B.C ')).toBe('auth:lockout: A@B.C ');
  });
});

describe('authDatabaseUrl', () => {
  it.each([
    ['redis://127.0.0.1:63791/0', 1, 'redis://127.0.0.1:63791/1'],
    ['redis://redis:6379', 1, 'redis://redis:6379/1'],
    ['redis://:pw@redis:6379/3', 5, 'redis://:pw@redis:6379/5'],
  ])('rewrites the database path of %s to %i', (input, db, expected) => {
    expect(authDatabaseUrl(input, db)).toBe(expected);
  });
});

describe('InMemoryAuthSessionStore', () => {
  let clock: number;
  let store: InMemoryAuthSessionStore;

  beforeEach(() => {
    clock = 1_000_000;
    store = new InMemoryAuthSessionStore(() => clock);
  });

  it('creates, reads and deletes a session under the real key names', async () => {
    await store.createSession(STAFF, session('s1', 's1'), TTL);
    expect(store.keys()).toEqual(['auth:sess:7:s1', 'auth:user:7:sessions']);
    await expect(store.getSession(STAFF, 's1')).resolves.toEqual(session('s1', 's1'));
    await expect(store.listSessionIds(STAFF)).resolves.toEqual(['s1']);

    await store.deleteSession(STAFF, 's1');
    await expect(store.getSession(STAFF, 's1')).resolves.toBeNull();
    await expect(store.listSessionIds(STAFF)).resolves.toEqual([]);
    expect(store.keys()).toEqual([]);
  });

  it('getSession returns null for an unknown sid and for another staff member', async () => {
    await store.createSession(STAFF, session('s1', 's1'), TTL);
    await expect(store.getSession(STAFF, 'nope')).resolves.toBeNull();
    await expect(store.getSession(8, 's1')).resolves.toBeNull();
  });

  it('a session expires when the clock passes its TTL', async () => {
    await store.createSession(STAFF, session('s1', 's1'), TTL);
    clock += TTL - 1;
    await expect(store.getSession(STAFF, 's1')).resolves.not.toBeNull();
    clock += 1;
    await expect(store.getSession(STAFF, 's1')).resolves.toBeNull();
  });

  it('rotation replaces refreshHash and the sliding timestamps, keeps sid and family, resets the TTL', async () => {
    await store.createSession(STAFF, session('s1', 'fam-a', 'old'), TTL);
    clock += TTL / 2;
    await store.rotateSession(
      STAFF,
      's1',
      { refreshHash: 'new', lastSeenAt: 'later', expiresAt: 'much-later' },
      TTL,
    );
    const rotated = await store.getSession(STAFF, 's1');
    expect(rotated).toMatchObject({
      sid: 's1',
      family: 'fam-a',
      refreshHash: 'new',
      lastSeenAt: 'later',
      expiresAt: 'much-later',
      createdAt: '2026-09-19T00:00:00.000Z',
    });
    clock += TTL - 1; // past the original expiry, within the reset one
    await expect(store.getSession(STAFF, 's1')).resolves.not.toBeNull();
  });

  it('rotation of a missing session is a no-op', async () => {
    await store.rotateSession(
      STAFF,
      'ghost',
      { refreshHash: 'x', lastSeenAt: 'y', expiresAt: 'z' },
      TTL,
    );
    await expect(store.getSession(STAFF, 'ghost')).resolves.toBeNull();
    expect(store.keys()).toEqual([]);
  });

  it('revokeFamily deletes only that family and returns the count', async () => {
    await store.createSession(STAFF, session('a1', 'fam-a'), TTL);
    await store.createSession(STAFF, session('a2', 'fam-a'), TTL);
    await store.createSession(STAFF, session('b1', 'fam-b'), TTL);

    await expect(store.revokeFamily(STAFF, 'fam-a')).resolves.toBe(2);
    await expect(store.getSession(STAFF, 'a1')).resolves.toBeNull();
    await expect(store.getSession(STAFF, 'a2')).resolves.toBeNull();
    await expect(store.getSession(STAFF, 'b1')).resolves.not.toBeNull();
    await expect(store.listSessionIds(STAFF)).resolves.toEqual(['b1']);
    await expect(store.revokeFamily(STAFF, 'fam-unknown')).resolves.toBe(0);
  });

  it('deleteAllSessions removes every session and the set', async () => {
    await store.createSession(STAFF, session('a1', 'fam-a'), TTL);
    await store.createSession(STAFF, session('b1', 'fam-b'), TTL);
    await expect(store.deleteAllSessions(STAFF)).resolves.toBe(2);
    await expect(store.listSessionIds(STAFF)).resolves.toEqual([]);
    expect(store.keys()).toEqual([]);
    await expect(store.deleteAllSessions(STAFF)).resolves.toBe(0);
  });

  it('version reads 0 when absent and bumps 0 → 1 → 2', async () => {
    await expect(store.getVersion(STAFF)).resolves.toBe(0);
    await expect(store.bumpVersion(STAFF)).resolves.toBe(1);
    await expect(store.bumpVersion(STAFF)).resolves.toBe(2);
    await expect(store.getVersion(STAFF)).resolves.toBe(2);
    expect(store.keys()).toContain('auth:user:7:version');
  });

  it('revokeJti then isRevoked, until the TTL passes', async () => {
    await expect(store.isRevoked('j1')).resolves.toBe(false);
    await store.revokeJti('j1', TTL);
    await expect(store.isRevoked('j1')).resolves.toBe(true);
    expect(store.keys()).toContain('auth:revoked:j1');
    clock += TTL;
    await expect(store.isRevoked('j1')).resolves.toBe(false);
  });

  it('permission snapshot round trip', async () => {
    const snapshot: PermissionSnapshot = {
      v: 1,
      staffId: STAFF,
      isAdmin: false,
      roleId: 2,
      codes: ['invoices.view', 'edit.tasks'],
      builtAt: '2026-09-19T00:00:00.000Z',
    };
    await expect(store.getPermissions(STAFF)).resolves.toBeNull();
    await store.setPermissions(STAFF, snapshot, TTL);
    await expect(store.getPermissions(STAFF)).resolves.toEqual(snapshot);
    expect(store.keys()).toContain('auth:perm:7');

    await store.deletePermissions(STAFF);
    await expect(store.getPermissions(STAFF)).resolves.toBeNull();
    expect(store.keys()).not.toContain('auth:perm:7');
  });

  it('deletePermissions on an absent key is a no-op, and never touches the token version', async () => {
    await store.bumpVersion(STAFF);
    await expect(store.deletePermissions(STAFF)).resolves.toBeUndefined();
    await expect(store.getPermissions(STAFF)).resolves.toBeNull();
    await expect(store.getVersion(STAFF)).resolves.toBe(1);
    expect(store.keys()).toContain(authKeys.version(STAFF));
  });

  it('lockout round trip, clear, and expiry when the clock advances past the TTL', async () => {
    const lockout: Lockout = { failures: 3, lockedUntil: null };
    await expect(store.getLockout('a@b.c')).resolves.toBeNull();
    await store.setLockout('a@b.c', lockout, TTL);
    await expect(store.getLockout('a@b.c')).resolves.toEqual(lockout);
    expect(store.keys()).toContain('auth:lockout:a@b.c');

    await store.clearLockout('a@b.c');
    await expect(store.getLockout('a@b.c')).resolves.toBeNull();

    await store.setLockout('a@b.c', { failures: 5, lockedUntil: clock + 60_000 }, TTL);
    clock += TTL + 1;
    await expect(store.getLockout('a@b.c')).resolves.toBeNull();
  });
});
