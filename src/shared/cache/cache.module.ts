import { Global, Module } from '@nestjs/common';
import { RedisService } from './redis.service.js';

/** Exposes the Redis client everywhere (today: the `redis` health probe only; ADR-0005). */
@Global()
@Module({ providers: [RedisService], exports: [RedisService] })
export class CacheModule {}
