/**
 * RedisMailStateStore over a stub client: the commands it sends (the int spec proves what Redis
 * answers). Covers the paths a live Redis cannot be made to take on demand: no client, the first
 * connect, a stored value that is not a date, and a MULTI that answers no count.
 */
import { describe, expect, it } from 'vitest';
import type { RedisService } from '../../../shared/cache/redis.service.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import { RedisMailStateStore } from '../repository/redis-mail-state.store.js';

function stub(options: { get?: string | null; exec?: unknown; status?: string } = {}) {
  const commands: unknown[][] = [];
  let connects = 0;
  const multi = {
    incr: (...args: unknown[]) => (commands.push(['incr', ...args]), multi),
    pexpire: (...args: unknown[]) => (commands.push(['pexpire', ...args]), multi),
    pttl: (...args: unknown[]) => (commands.push(['pttl', ...args]), multi),
    exec: () => Promise.resolve(options.exec ?? null),
  };
  const client = {
    status: options.status ?? 'ready',
    connect: () => {
      connects += 1;
      return Promise.resolve();
    },
    set: (...args: unknown[]) => (commands.push(['set', ...args]), Promise.resolve('OK')),
    get: (...args: unknown[]) => (
      commands.push(['get', ...args]),
      Promise.resolve(options.get ?? null)
    ),
    del: (...args: unknown[]) => (commands.push(['del', ...args]), Promise.resolve(1)),
    multi: () => multi,
  };
  const store = new RedisMailStateStore({ client } as unknown as RedisService);
  return { store, commands, connects: () => connects };
}

describe('RedisMailStateStore (stub client)', () => {
  it('sends SET NX PX with the server-state TTL, DEL and GET on the one key', async () => {
    const at = new Date('2026-10-02T08:00:00.000Z');
    const { store, commands } = stub({ get: at.toISOString() });
    await store.markServerUnreachable(at);
    await store.clearServerUnreachable();
    expect(await store.serverUnreachableSince()).toEqual(at);
    expect(commands).toEqual([
      [
        'set',
        'mail:server:unreachableSince',
        at.toISOString(),
        'PX',
        TIMINGS.mail.serverStateTtlMs,
        'NX',
      ],
      ['del', 'mail:server:unreachableSince'],
      ['get', 'mail:server:unreachableSince'],
    ]);
  });

  it('reads an absent or unparseable flag as null', async () => {
    expect(await stub().store.serverUnreachableSince()).toBeNull();
    expect(await stub({ get: 'not a date' }).store.serverUnreachableSince()).toBeNull();
  });

  it('counts in one MULTI with PEXPIRE NX on the test window; a negative PTTL reads as 0', async () => {
    const { store, commands } = stub({
      exec: [
        [null, 2],
        [null, 0],
        [null, -1],
      ],
    });
    expect(await store.countTest(7)).toEqual({ count: 2, retryAfterMs: 0 });
    expect(commands).toEqual([
      ['incr', 'mail:test:7'],
      ['pexpire', 'mail:test:7', TIMINGS.mail.testWindowMs, 'NX'],
      ['pttl', 'mail:test:7'],
    ]);
  });

  it('refuses a MULTI that answers no count', async () => {
    await expect(stub({ exec: null }).store.countTest(7)).rejects.toThrow(
      'mail state: the test counter answered no count',
    );
  });

  it('connects once on first use; refuses without a client', async () => {
    const lazy = stub({ status: 'wait' });
    await lazy.store.clearServerUnreachable();
    await lazy.store.clearServerUnreachable();
    expect(lazy.connects()).toBe(1);
    const none = new RedisMailStateStore({ client: null } as unknown as RedisService);
    await expect(none.markServerUnreachable(new Date())).rejects.toThrow(
      'mail state: REDIS_URL is not set',
    );
  });
});
