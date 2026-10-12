/**
 * The state behind BE-15 Layer 1: one record per
 * `(staff, Idempotency-Key)`, first `in-progress` with the request's fingerprint, then `done` with
 * the stored status and body. Redis db 0 (the cache client, `RedisService`) holds it so every api
 * replica sees the same claim; the key is `idem:<staffId>:<key>`, so one staff member can never
 * replay another's response (T-4.2-30).
 *
 * The port has two implementations in the BE-17 "Instead" form: `RedisIdempotencyStore` for the
 * running api and `InMemoryIdempotencyStore` for unit specs. Every Redis failure rejects; the
 * interceptor turns a rejection into 503 before the handler runs (fail closed, T-4.2-31).
 */
import { Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { RedisService } from '../../cache/redis.service.js';

/** What the store holds for one key: a run in progress, or the finished response to replay. */
export type IdempotencyRecord =
  | { readonly state: 'in-progress'; readonly fingerprint: string }
  | {
      readonly state: 'done';
      readonly fingerprint: string;
      readonly status: number;
      readonly body: unknown;
    };

/** The finished form of a record. */
export type DoneIdempotencyRecord = Extract<IdempotencyRecord, { state: 'done' }>;

/** The port the interceptor uses; every method rejects when the store is unreachable. */
export interface IdempotencyStore {
  /** `SET NX PX`: true when this request now owns the key (state `in-progress`). */
  claim(key: string, fingerprint: string, ttlMs: number): Promise<boolean>;
  read(key: string): Promise<IdempotencyRecord | null>;
  complete(key: string, record: DoneIdempotencyRecord, ttlMs: number): Promise<void>;
  release(key: string): Promise<void>;
}

export const IDEMPOTENCY_STORE = Symbol('IDEMPOTENCY_STORE');

/** Any 16 to 128 character token of `[A-Za-z0-9_-]`; erp-web mints `crypto.randomUUID()`. */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

/** The Redis key of one staff member's Idempotency-Key. */
export const idempotencyRedisKey = (staffId: number, key: string): string =>
  `idem:${String(staffId)}:${key}`;

/** A record as Redis returns it, or null for an absent key. */
function parseRecord(raw: string | null): IdempotencyRecord | null {
  return raw === null ? null : (JSON.parse(raw) as IdempotencyRecord);
}

/** The Redis adapter on the cache client (db 0), connected on first use like `RedisService.ping()`. */
@Injectable()
export class RedisIdempotencyStore implements IdempotencyStore {
  private connecting: Promise<void> | undefined;

  constructor(private readonly redis: RedisService) {}

  async claim(key: string, fingerprint: string, ttlMs: number): Promise<boolean> {
    const record: IdempotencyRecord = { state: 'in-progress', fingerprint };
    const client = await this.client();
    return (await client.set(key, JSON.stringify(record), 'PX', ttlMs, 'NX')) === 'OK';
  }

  async read(key: string): Promise<IdempotencyRecord | null> {
    const client = await this.client();
    return parseRecord(await client.get(key));
  }

  async complete(key: string, record: DoneIdempotencyRecord, ttlMs: number): Promise<void> {
    const client = await this.client();
    await client.set(key, JSON.stringify(record), 'PX', ttlMs);
  }

  async release(key: string): Promise<void> {
    const client = await this.client();
    await client.del(key);
  }

  private async client(): Promise<Redis> {
    const { client } = this.redis;
    if (client === null) throw new Error('REDIS_URL is not set');
    if (client.status === 'wait') this.connecting ??= client.connect();
    await this.connecting;
    return client;
  }
}

/** The in-process store for unit specs; TTLs are not enforced (a spec never outlives them). */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  claim(key: string, fingerprint: string): Promise<boolean> {
    if (this.records.has(key)) return Promise.resolve(false);
    this.records.set(key, { state: 'in-progress', fingerprint });
    return Promise.resolve(true);
  }

  read(key: string): Promise<IdempotencyRecord | null> {
    return Promise.resolve(this.records.get(key) ?? null);
  }

  complete(key: string, record: DoneIdempotencyRecord): Promise<void> {
    this.records.set(key, record);
    return Promise.resolve();
  }

  release(key: string): Promise<void> {
    this.records.delete(key);
    return Promise.resolve();
  }
}
