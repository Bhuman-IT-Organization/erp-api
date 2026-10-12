/**
 * BE-15 Layer 1, wired once for the whole api: the Redis store on the cache client (db 0) under
 * `IDEMPOTENCY_STORE` and the interceptor `@Idempotent()` applies. Global, so a module's controller
 * only adds the decorator.
 */
import { Global, Module } from '@nestjs/common';
import { IdempotencyInterceptor } from './idempotency.interceptor.js';
import { IDEMPOTENCY_STORE, RedisIdempotencyStore } from './idempotency.store.js';

/** Provides `IDEMPOTENCY_STORE` and `IdempotencyInterceptor` everywhere. */
@Global()
@Module({
  providers: [
    { provide: IDEMPOTENCY_STORE, useClass: RedisIdempotencyStore },
    IdempotencyInterceptor,
  ],
  exports: [IDEMPOTENCY_STORE, IdempotencyInterceptor],
})
export class IdempotencyModule {}
