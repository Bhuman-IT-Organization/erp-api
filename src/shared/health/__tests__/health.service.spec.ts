import { afterEach, describe, expect, it, vi } from 'vitest';
import { HealthService, withTimeout } from '../health.service.js';
import { TIMINGS } from '../../config/timings.js';

/** A probe whose promise never settles: a stalled DB or Redis socket (review WR-03). */
const hung = { name: 'hung', run: () => new Promise<'ok'>(() => undefined) };

describe('HealthService time bounds (WR-03)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a probe that never settles as error once TIMINGS.health.probeTimeoutMs has elapsed', async () => {
    vi.useFakeTimers();
    const health = new HealthService();
    health.register(hung);
    health.register({ name: 'fine', run: () => Promise.resolve('ok') });

    let settled = false;
    const pending = health.report().then((r) => {
      settled = true;
      return r;
    });

    await vi.advanceTimersByTimeAsync(TIMINGS.health.probeTimeoutMs - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
    expect(await pending).toEqual({ status: 'degraded', checks: { hung: 'error', fine: 'ok' } });
  });

  it('still lets a fast probe answer ok and a rejecting probe answer error', async () => {
    const health = new HealthService();
    health.register({ name: 'ok', run: () => Promise.resolve('ok') });
    health.register({ name: 'boom', run: () => Promise.reject(new Error('down')) });
    expect(await health.report()).toEqual({
      status: 'degraded',
      checks: { ok: 'ok', boom: 'error' },
    });
  });

  it('keeps the dependency budget under the probe budget', () => {
    expect(TIMINGS.health.dependencyTimeoutMs).toBeLessThan(TIMINGS.health.probeTimeoutMs);
  });
});

describe('HealthService breaker states (ADR-0031 §3)', () => {
  it('adds checks.breakers from the source without changing status', async () => {
    const health = new HealthService();
    health.register({ name: 'db', run: () => Promise.resolve('ok') });
    health.registerBreakerSource(() => ({ legacy: 'open' }));
    const report = await health.report();
    expect(report.status).toBe('ok');
    expect(report.checks.breakers).toEqual({ legacy: 'open' });
    expect(report.checks.db).toBe('ok');
  });

  it('has no breakers key when no source is registered', async () => {
    const health = new HealthService();
    const report = await health.report();
    expect('breakers' in report.checks).toBe(false);
    expect(report).toEqual({ status: 'ok', checks: {} });
  });

  it('reserves the breakers probe name and allows one source only', () => {
    const health = new HealthService();
    expect(() => {
      health.register({ name: 'breakers', run: () => Promise.resolve('ok') });
    }).toThrow(/reserved/);
    health.registerBreakerSource(() => ({}));
    expect(() => {
      health.registerBreakerSource(() => ({}));
    }).toThrow('breaker source already registered');
  });
});

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rejects with a timeout error after ms', async () => {
    vi.useFakeTimers();
    const p = withTimeout(new Promise<never>(() => undefined), 50);
    const outcome = p.then(
      () => 'resolved',
      (e: unknown) => (e instanceof Error ? e.message : String(e)),
    );
    await vi.advanceTimersByTimeAsync(50);
    expect(await outcome).toBe('probe timed out after 50ms');
  });

  it('passes through a value or a rejection that arrives in time', async () => {
    await expect(withTimeout(Promise.resolve(1), 50)).resolves.toBe(1);
    await expect(withTimeout(Promise.reject(new Error('x')), 50)).rejects.toThrow('x');
  });
});
