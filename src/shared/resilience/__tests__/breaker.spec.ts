import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../config/env.schema.js';
import { TIMINGS } from '../../config/timings.js';
import { AppError } from '../../errors/app-error.js';
import { UpstreamUnavailableError } from '../../errors/upstream-unavailable.error.js';
import { LoggerService } from '../../logger/logger.service.js';
import { BREAKER_NAMES, BreakerRegistry, type BreakerOptions } from '../breaker.js';
import { breakerOptions } from '../resilience.module.js';

const options: BreakerOptions = {
  volumeThreshold: 3,
  errorThresholdPercentage: 50,
  rollingWindowMs: 60_000,
  halfOpenAfterMs: 10_000,
};

class RecordingLogger extends LoggerService {
  readonly transitions: string[] = [];
  override warn(message: string, meta?: Record<string, unknown>): void {
    if (message === 'breaker state') this.transitions.push(String(meta?.to));
  }
}

function transient(): Error {
  return Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
}

/** A counted action that fails `failures` times with `error`, then succeeds. */
function action(failures: number, error: () => Error) {
  let calls = 0;
  const fn = (): Promise<string> => {
    calls += 1;
    return calls <= failures ? Promise.reject(error()) : Promise.resolve('ok');
  };
  return { fn, calls: () => calls };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe('Breaker (opossum on a fake clock)', () => {
  let logger: RecordingLogger;
  let registry: BreakerRegistry;

  beforeEach(() => {
    vi.useFakeTimers();
    logger = new RecordingLogger();
    registry = new BreakerRegistry(options, logger);
  });

  afterEach(() => {
    registry.onModuleDestroy();
    vi.useRealTimers();
  });

  async function tripLegacy() {
    const breaker = registry.get('legacy');
    const failing = action(99, transient);
    for (let i = 0; i < options.volumeThreshold; i += 1) {
      await rejection(breaker.execute(failing.fn));
    }
    return { breaker, failing };
  }

  it('opens after volumeThreshold transient failures and then fails fast without calling fn', async () => {
    const { breaker, failing } = await tripLegacy();
    expect(breaker.state).toBe('open');
    expect(failing.calls()).toBe(3);

    const error = await rejection(breaker.execute(failing.fn));
    expect(failing.calls()).toBe(3);
    expect(error).toBeInstanceOf(UpstreamUnavailableError);
    const upstream = error as UpstreamUnavailableError;
    expect(upstream.code).toBe('ERP-UPSTREAM-0001');
    expect(upstream.upstream).toBe('legacy');
    expect(upstream.extras?.retryAfterS).toBe(10);
    expect((error as { code?: string }).code).not.toBe('EOPENBREAKER');
  });

  it('does not count AppErrors: three business errors leave it closed and propagate unchanged', async () => {
    const breaker = registry.get('legacy');
    const thrown = new AppError('ERP-AUTH-0001');
    for (let i = 0; i < 3; i += 1) {
      expect(await rejection(breaker.execute(() => Promise.reject(thrown)))).toBe(thrown);
    }
    expect(breaker.state).toBe('closed');
    expect(logger.transitions).toEqual([]);
  });

  it('half-opens after halfOpenAfterMs and closes on a successful trial, logging each transition', async () => {
    const { breaker } = await tripLegacy();
    expect(breaker.state).toBe('open');

    await vi.advanceTimersByTimeAsync(options.halfOpenAfterMs - 1);
    expect(breaker.state).toBe('open');
    await vi.advanceTimersByTimeAsync(1);
    expect(breaker.state).toBe('half-open');

    await expect(breaker.execute(() => Promise.resolve('back'))).resolves.toBe('back');
    expect(breaker.state).toBe('closed');
    expect(logger.transitions).toEqual(['open', 'half-open', 'closed']);
  });

  it('reopens when the half-open trial fails', async () => {
    const { breaker } = await tripLegacy();
    await vi.advanceTimersByTimeAsync(options.halfOpenAfterMs);
    expect(breaker.state).toBe('half-open');

    await rejection(breaker.execute(() => Promise.reject(transient())));
    expect(breaker.state).toBe('open');
    expect(logger.transitions).toEqual(['open', 'half-open', 'open']);
  });

  it('forceOpen fails fast without calling fn and forceClose restores it', async () => {
    const breaker = registry.get('sap');
    const healthy = action(0, transient);
    breaker.forceOpen();
    expect(breaker.state).toBe('open');
    expect(await rejection(breaker.execute(healthy.fn))).toBeInstanceOf(UpstreamUnavailableError);
    expect(healthy.calls()).toBe(0);

    breaker.forceClose();
    expect(breaker.state).toBe('closed');
    await expect(breaker.execute(healthy.fn)).resolves.toBe('ok');
  });

  it('passes the signal through to fn', async () => {
    const signal = AbortSignal.abort();
    const seen = await registry.get('email').execute((s) => Promise.resolve(s), signal);
    expect(seen).toBe(signal);
  });
});

describe('BreakerRegistry', () => {
  it('creates one instance per name lazily and lists only created breakers', () => {
    const registry = new BreakerRegistry(options, new RecordingLogger());
    expect(registry.states()).toEqual({});
    const first = registry.get('legacy');
    expect(registry.get('legacy')).toBe(first);
    expect(registry.states()).toEqual({ legacy: 'closed' });
    expect(BREAKER_NAMES).toContain('email');
    registry.onModuleDestroy();
    expect(registry.states()).toEqual({});
  });
});

describe('breakerOptions', () => {
  const env = {
    NODE_ENV: 'development',
    RESILIENCE_BREAKER_HALF_OPEN_AFTER_MS: 3_000,
    RESILIENCE_BREAKER_VOLUME_THRESHOLD: 2,
  } as unknown as Env;

  it('applies the env overrides and keeps the rest from TIMINGS.breaker', () => {
    expect(breakerOptions(env)).toEqual({
      volumeThreshold: 2,
      errorThresholdPercentage: TIMINGS.breaker.errorThresholdPercentage,
      rollingWindowMs: TIMINGS.breaker.rollingWindowMs,
      halfOpenAfterMs: 3_000,
    });
    expect(breakerOptions({ NODE_ENV: 'production' } as unknown as Env)).toEqual(TIMINGS.breaker);
  });
});
