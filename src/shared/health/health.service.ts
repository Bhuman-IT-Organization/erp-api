import { Injectable } from '@nestjs/common';
import { TIMINGS } from '../config/timings.js';
import type {
  BreakerStates,
  HealthCheck,
  HealthCheckResult,
  HealthReport,
} from './health.types.js';

/** Rejects after `ms` if `promise` has not settled; the timer never keeps the process alive. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`probe timed out after ${String(ms)}ms`));
    }, ms);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Reserved key under `checks`: the breaker states, never a probe. */
const BREAKERS_KEY = 'breakers';

/**
 * Registry of health probes. Status is 'ok' only when every registered probe reports 'ok'.
 * A probe that rejects or does not settle within `TIMINGS.health.probeTimeoutMs` reports 'error'
 * (review WR-03): a stalled socket must never hang /health.
 *
 * Breaker states (ADR-0031 §3) ride along as `checks.breakers` when a source is registered and
 * never change `status`: an open breaker is the upstream's outage, not ours.
 */
@Injectable()
export class HealthService {
  private readonly checks = new Map<string, HealthCheck>();
  private breakerSource: (() => BreakerStates) | null = null;

  /** Registers a named probe. Later modules (db, redis) call this from onModuleInit. */
  register(check: HealthCheck): void {
    if (check.name === BREAKERS_KEY) {
      throw new Error(`'${BREAKERS_KEY}' is reserved for the breaker states, not a probe`);
    }
    this.checks.set(check.name, check);
  }

  /** Registers the one breaker-state source (ResilienceModule). A second call is a wiring bug. */
  registerBreakerSource(source: () => BreakerStates): void {
    if (this.breakerSource !== null) throw new Error('breaker source already registered');
    this.breakerSource = source;
  }

  async report(): Promise<HealthReport> {
    const entries = await Promise.all(
      [...this.checks.values()].map(async (c): Promise<readonly [string, HealthCheckResult]> => [
        c.name,
        await withTimeout(c.run(), TIMINGS.health.probeTimeoutMs).catch(
          (): HealthCheckResult => 'error',
        ),
      ]),
    );
    const status = entries.every(([, r]) => r === 'ok') ? 'ok' : 'degraded';
    const checks: Record<string, HealthCheckResult | BreakerStates> = Object.fromEntries(entries);
    if (this.breakerSource !== null) checks[BREAKERS_KEY] = this.breakerSource();
    return { status, checks };
  }
}
