/**
 * AuthTransport without a network: a real BreakerRegistry (opossum) and a real withRetry around a
 * fake fetch, so the nesting retry → breaker → timeout → fetch is exercised as built. Nothing
 * here sleeps: retryDeps.sleep resolves immediately.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../shared/config/app-config.js';
import { RETRY_POLICIES } from '../../../shared/config/retry-policies.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import { UpstreamUnavailableError } from '../../../shared/errors/upstream-unavailable.error.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { BreakerRegistry } from '../../../shared/resilience/breaker.js';
import { UpstreamHttpError } from '../../../shared/resilience/transient-error.js';
import { StaffLoginFailedV1 } from '../events/published.js';
import { AuthTransport, LEGACY_SSO_ACTIVE_HEADER } from '../service/auth.transport.js';

const BASE_URL = 'http://legacy.test';
const HANDOFF_URL = 'http://legacy.test/erp_sso/handoff';
const NOW = 1_700_000_000_000;

interface RecordedCall {
  readonly url: string;
  readonly method: string | undefined;
  readonly signal: AbortSignal | null | undefined;
}

class RecordingLogger extends LoggerService {
  readonly warnings: string[] = [];
  override warn(message: string): void {
    this.warnings.push(message);
  }
}

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

function connectionRefused(): Error {
  return Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
}

/** A fake fetch answering from `answers` in order (the last one repeats), recording every call. */
function fakeFetch(answers: (() => Promise<Response>)[]) {
  const calls: RecordedCall[] = [];
  const impl: typeof fetch = (input, init) => {
    calls.push({
      url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      method: init?.method,
      signal: init?.signal,
    });
    const answer = answers[Math.min(calls.length, answers.length) - 1];
    if (answer === undefined) throw new Error('no answer configured');
    return answer();
  };
  return { impl, calls };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (e: unknown) => e,
  );
}

describe('AuthTransport', () => {
  let logger: RecordingLogger;
  let registry: BreakerRegistry;
  let publisher: RecordingDomainEventPublisher;
  let clock: number;

  function makeTransport(volumeThreshold: number, fetchImpl: typeof fetch): AuthTransport {
    registry = new BreakerRegistry({ ...TIMINGS.breaker, volumeThreshold }, logger);
    const config = { env: { LEGACY_BASE_URL: BASE_URL } } as unknown as AppConfig;
    const transport = new AuthTransport(publisher, registry, config, logger);
    transport.fetchImpl = fetchImpl;
    transport.now = () => clock;
    transport.retryDeps = { sleep: () => Promise.resolve(), random: () => 0 };
    return transport;
  }

  beforeEach(() => {
    logger = new RecordingLogger();
    publisher = new RecordingDomainEventPublisher();
    clock = NOW;
  });

  afterEach(() => {
    registry.onModuleDestroy();
  });

  it('publish forwards the event to the DOMAIN_EVENT_PUBLISHER port unchanged', async () => {
    const transport = makeTransport(2, fakeFetch([]).impl);
    const event = new StaffLoginFailedV1({ staffId: null, reason: 'invalid_credentials', at: 'x' });
    await transport.publish(event);
    const drained = publisher.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]).toBe(event);
  });

  it('405 with X-Erp-Sso: active → ready; GET of exactly /erp_sso/handoff with a timeout signal', async () => {
    const { impl, calls } = fakeFetch([
      () => Promise.resolve(response(405, { Allow: 'POST', [LEGACY_SSO_ACTIVE_HEADER]: 'active' })),
    ]);
    const transport = makeTransport(2, impl);
    await expect(transport.probeLegacySso()).resolves.toEqual({
      status: 'ready',
      detail: 'active',
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(HANDOFF_URL);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0]?.signal?.aborted).toBe(false);
  });

  it('405 without the header → inactive (present-not-activated), logged, one fetch', async () => {
    const { impl, calls } = fakeFetch([() => Promise.resolve(response(405, { Allow: 'POST' }))]);
    const transport = makeTransport(2, impl);
    await expect(transport.probeLegacySso()).resolves.toEqual({
      status: 'inactive',
      detail: 'present-not-activated',
    });
    expect(calls).toHaveLength(1);
    expect(logger.warnings).toEqual(['legacy erp_sso module is present but not activated']);
  });

  it('404 → inactive (absent) after ONE fetch: a 4xx is never retried', async () => {
    const { impl, calls } = fakeFetch([() => Promise.resolve(response(404))]);
    const transport = makeTransport(2, impl);
    await expect(transport.probeLegacySso()).resolves.toEqual({
      status: 'inactive',
      detail: 'absent',
    });
    expect(calls).toHaveLength(1);
    expect(registry.get('legacy').state).toBe('closed');
  });

  it('another status below 500 (e.g. 302) → inactive (unexpected-status), not an outage', async () => {
    const { impl, calls } = fakeFetch([() => Promise.resolve(response(302, { location: '/' }))]);
    const transport = makeTransport(2, impl);
    await expect(transport.probeLegacySso()).resolves.toEqual({
      status: 'inactive',
      detail: 'unexpected-status',
    });
    expect(calls).toHaveLength(1);
    expect(registry.get('legacy').state).toBe('closed');
  });

  it('connection refused every time: retried through the breaker, which opens and short-circuits', async () => {
    const { impl, calls } = fakeFetch([() => Promise.reject(connectionRefused())]);
    const transport = makeTransport(2, impl);
    const error = await rejection(transport.probeLegacySso());
    // volumeThreshold 2: the second failure opens the circuit; the third attempt never reaches fetch.
    expect(calls.length).toBeLessThanOrEqual(RETRY_POLICIES.legacyHttp.attempts);
    expect(calls).toHaveLength(2);
    expect(registry.get('legacy').state).toBe('open');
    expect(error).toBeInstanceOf(UpstreamUnavailableError);
  });

  it('connection refused with a wide breaker: exactly attempts fetches, the last error rethrown as-is', async () => {
    const { impl, calls } = fakeFetch([() => Promise.reject(connectionRefused())]);
    const transport = makeTransport(TIMINGS.breaker.volumeThreshold, impl);
    const error = await rejection(transport.probeLegacySso());
    expect(calls).toHaveLength(RETRY_POLICIES.legacyHttp.attempts);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as { cause?: { code?: string } }).cause?.code).toBe('ECONNREFUSED');
    expect(registry.get('legacy').state).toBe('closed');
  });

  it('breaker forced open → UpstreamUnavailableError with ZERO fetch calls (ADR-0031 §7 load shedding)', async () => {
    const { impl, calls } = fakeFetch([
      () => Promise.resolve(response(405, { [LEGACY_SSO_ACTIVE_HEADER]: 'active' })),
    ]);
    const transport = makeTransport(2, impl);
    registry.get('legacy').forceOpen();
    const error = await rejection(transport.probeLegacySso());
    expect(error).toBeInstanceOf(UpstreamUnavailableError);
    const upstream = error as UpstreamUnavailableError;
    expect(upstream.code).toBe('ERP-UPSTREAM-0001');
    expect(upstream.upstream).toBe('legacy');
    expect(upstream.extras?.retryAfterS).toBe(Math.ceil(TIMINGS.breaker.halfOpenAfterMs / 1_000));
    expect(calls).toHaveLength(0);
  });

  it('caches a value for probeCacheMs and never caches an error', async () => {
    const { impl, calls } = fakeFetch([
      () => Promise.resolve(response(405, { [LEGACY_SSO_ACTIVE_HEADER]: 'active' })),
    ]);
    const transport = makeTransport(2, impl);
    await transport.probeLegacySso();
    await transport.probeLegacySso();
    expect(calls).toHaveLength(1);
    clock = NOW + TIMINGS.http.legacy.probeCacheMs - 1;
    await transport.probeLegacySso();
    expect(calls).toHaveLength(1);
    clock = NOW + TIMINGS.http.legacy.probeCacheMs;
    await expect(transport.probeLegacySso()).resolves.toEqual({
      status: 'ready',
      detail: 'active',
    });
    expect(calls).toHaveLength(2);

    // An open breaker is not a value: the next call after the cache expires probes again.
    registry.get('legacy').forceOpen();
    clock += TIMINGS.http.legacy.probeCacheMs;
    expect(await rejection(transport.probeLegacySso())).toBeInstanceOf(UpstreamUnavailableError);
    registry.get('legacy').forceClose();
    await expect(transport.probeLegacySso()).resolves.toEqual({
      status: 'ready',
      detail: 'active',
    });
    expect(calls).toHaveLength(3);
  });

  it('503 → UpstreamHttpError, retried up to attempts through a wide breaker and rethrown', async () => {
    const { impl, calls } = fakeFetch([() => Promise.resolve(response(503))]);
    const transport = makeTransport(TIMINGS.breaker.volumeThreshold, impl);
    const error = await rejection(transport.probeLegacySso());
    expect(calls).toHaveLength(RETRY_POLICIES.legacyHttp.attempts);
    expect(error).toBeInstanceOf(UpstreamHttpError);
    expect((error as UpstreamHttpError).status).toBe(503);
    expect((error as UpstreamHttpError).upstream).toBe('legacy');
  });

  it('a transient failure followed by a good answer succeeds within the retry budget', async () => {
    const { impl, calls } = fakeFetch([
      () => Promise.resolve(response(502)),
      () => Promise.resolve(response(405, { [LEGACY_SSO_ACTIVE_HEADER]: 'Active' })),
    ]);
    const transport = makeTransport(TIMINGS.breaker.volumeThreshold, impl);
    await expect(transport.probeLegacySso()).resolves.toEqual({
      status: 'ready',
      detail: 'active',
    });
    expect(calls).toHaveLength(2);
  });

  it('refuses to probe without LEGACY_BASE_URL (a configuration error, not an outage)', async () => {
    const { impl, calls } = fakeFetch([]);
    const transport = makeTransport(2, impl);
    const config = { env: {} } as unknown as AppConfig;
    const unconfigured = new AuthTransport(publisher, registry, config, logger);
    unconfigured.fetchImpl = impl;
    unconfigured.retryDeps = transport.retryDeps;
    const error = await rejection(unconfigured.probeLegacySso());
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UpstreamUnavailableError);
    expect((error as Error).message).toMatch(/LEGACY_BASE_URL/);
    expect(calls).toHaveLength(0);
    expect(registry.get('legacy').state).toBe('closed');
  });
});
