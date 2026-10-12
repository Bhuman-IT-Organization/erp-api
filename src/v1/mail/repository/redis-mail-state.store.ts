/**
 * The ioredis adapter of `MailStateStore` on the cache client (`RedisService.client`, db 0),
 * connected on first use as `RedisIdempotencyStore` does. Every Redis failure rejects; the caller
 * decides what a missing answer means.
 *
 * The counter is one MULTI: `INCR`, `PEXPIRE ... NX` (sets the window only on a key that has none,
 * so a crash between two commands can never leave a counter without an expiry), then `PTTL`.
 */
import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RedisService } from '../../../shared/cache/redis.service.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import { mailKeys, type MailStateStore } from './mail-state.store.js';

/** `[count, pttl]` from the MULTI's replies; a missing or failed reply rejects. */
function countAnswer(replies: [Error | null, unknown][] | null): [number, number] {
  const count = replies?.[0]?.[1];
  const pttl = replies?.[2]?.[1];
  if (typeof count !== 'number' || typeof pttl !== 'number') {
    throw new Error('mail state: the test counter answered no count');
  }
  return [count, pttl];
}

@Injectable()
export class RedisMailStateStore implements MailStateStore {
  /** The test-send window; a field (not DI) so the int spec can shorten it, as `MailService` did with `now`. */
  testWindowMs: number = TIMINGS.mail.testWindowMs;

  private connecting: Promise<void> | undefined;

  constructor(private readonly redis: RedisService) {}

  async markServerUnreachable(at: Date): Promise<void> {
    const client = await this.client();
    await client.set(
      mailKeys.serverUnreachableSince(),
      at.toISOString(),
      'PX',
      TIMINGS.mail.serverStateTtlMs,
      'NX',
    );
  }

  async clearServerUnreachable(): Promise<void> {
    const client = await this.client();
    await client.del(mailKeys.serverUnreachableSince());
  }

  async serverUnreachableSince(): Promise<Date | null> {
    const client = await this.client();
    const raw = await client.get(mailKeys.serverUnreachableSince());
    if (raw === null) return null;
    const at = new Date(raw);
    return Number.isNaN(at.getTime()) ? null : at;
  }

  async countTest(
    staffId: number,
  ): Promise<{ readonly count: number; readonly retryAfterMs: number }> {
    const client = await this.client();
    const key = mailKeys.testCount(staffId);
    const replies = await client
      .multi()
      .incr(key)
      .pexpire(key, this.testWindowMs, 'NX')
      .pttl(key)
      .exec();
    const [count, pttl] = countAnswer(replies);
    return { count, retryAfterMs: Math.max(0, pttl) };
  }

  private async client(): Promise<Redis> {
    const { client } = this.redis;
    if (client === null) throw new Error('mail state: REDIS_URL is not set');
    if (client.status === 'wait') this.connecting ??= client.connect();
    await this.connecting;
    return client;
  }
}
