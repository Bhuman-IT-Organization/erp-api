/**
 * ADR-0031's home in the container: one global `BreakerRegistry` whose options are
 * `TIMINGS.breaker` with the `RESILIENCE_BREAKER_*` overrides (non-production only, for the
 * stack proof) and whose states are published to `/health` as `checks.breakers`.
 */
import { Global, Module, type OnModuleInit } from '@nestjs/common';
import { AppConfig } from '../config/app-config.js';
import type { Env } from '../config/env.schema.js';
import { TIMINGS } from '../config/timings.js';
import { HealthService } from '../health/health.service.js';
import { LoggerService } from '../logger/logger.service.js';
import { BreakerRegistry, type BreakerOptions } from './breaker.js';

/** `TIMINGS.breaker` with the two env overrides applied when defined (the schema refuses them in production). */
export function breakerOptions(env: Env): BreakerOptions {
  return {
    volumeThreshold: env.RESILIENCE_BREAKER_VOLUME_THRESHOLD ?? TIMINGS.breaker.volumeThreshold,
    errorThresholdPercentage: TIMINGS.breaker.errorThresholdPercentage,
    rollingWindowMs: TIMINGS.breaker.rollingWindowMs,
    halfOpenAfterMs: env.RESILIENCE_BREAKER_HALF_OPEN_AFTER_MS ?? TIMINGS.breaker.halfOpenAfterMs,
  };
}

@Global()
@Module({
  providers: [
    {
      provide: BreakerRegistry,
      useFactory: (config: AppConfig, logger: LoggerService) =>
        new BreakerRegistry(breakerOptions(config.env), logger),
      inject: [AppConfig, LoggerService],
    },
  ],
  exports: [BreakerRegistry],
})
export class ResilienceModule implements OnModuleInit {
  constructor(
    private readonly registry: BreakerRegistry,
    private readonly health: HealthService,
  ) {}

  onModuleInit(): void {
    this.health.registerBreakerSource(() => this.registry.states());
  }
}
