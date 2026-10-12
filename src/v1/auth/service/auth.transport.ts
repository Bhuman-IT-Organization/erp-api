/**
 * Transport: the module's outbound seam — domain events through the publisher port, and the one
 * HTTP call wave 0 makes to the legacy system.
 *
 * The only file in `v1/auth` allowed to call `fetch` or a breaker (ADR-0031 §3, §6; example-item
 * README "transport"). Services and repositories call this class, never a vendor. Retry is
 * `withRetry` only; the breaker library has no fallback/retry; the timeout is `timeoutSignal`.
 *
 * `probeLegacySso()` is the readiness signal ops need after uploading the `erp_sso` module on
 * cPanel (ADR-0030): `GET /erp_sso/handoff` answers `405` from the module's controller and, only
 * when the module is ACTIVATED (its init file loaded), the `X-Erp-Sso: active` header (plan 06
 * finding: an uploaded-but-inactive module still answers 405). Perfex without the folder answers
 * `404`. The browser's own handoff stays browser → Nginx → legacy (research Q3); this is the only
 * Node → legacy HTTP in wave 0.
 *
 * Nesting, deliberately: retry OUTSIDE the breaker, so every attempt is counted by the circuit and
 * an open circuit short-circuits the remaining attempts (`isTransientError(UpstreamUnavailableError)`
 * is false). A 5xx is `UpstreamHttpError` (transient: counted, retried); a rejected fetch
 * (connection refused, DNS, timeout) propagates as-is (transient); any other status is a value,
 * not an outage. The value is cached for `TIMINGS.http.legacy.probeCacheMs` so a burst of callers
 * costs one legacy request; an error is never cached.
 */
import { Inject, Injectable } from '@nestjs/common';
import { AppConfig } from '../../../shared/config/app-config.js';
import { RETRY_POLICIES } from '../../../shared/config/retry-policies.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { BreakerRegistry, type Breaker } from '../../../shared/resilience/breaker.js';
import { withRetry, type RetryDeps } from '../../../shared/resilience/retry.js';
import { timeoutSignal } from '../../../shared/resilience/timeout.js';
import { UpstreamHttpError } from '../../../shared/resilience/transient-error.js';
import type { LegacySsoResponseDto } from '../dto/auth.dto.js';

export const LEGACY_SSO_HANDOFF_PATH = '/erp_sso/handoff';
export const LEGACY_SSO_ACTIVE_HEADER = 'x-erp-sso';
export const LEGACY_SSO_ACTIVE_VALUE = 'active';

const HTTP_NOT_FOUND = 404;
const HTTP_METHOD_NOT_ALLOWED = 405;
const HTTP_SERVER_ERROR_FLOOR = 500;

/**
 * `status` is the wire contract (`legacySsoResponseSchema`); `detail` says why it is `inactive`:
 * the module folder is `absent` (404), `present-not-activated` (405 without the header), or the
 * legacy system answered an `unexpected-status` (anything else below 500).
 */
export interface LegacySsoProbe {
  readonly status: LegacySsoResponseDto['status'];
  readonly detail: 'active' | 'present-not-activated' | 'absent' | 'unexpected-status';
}

interface CachedProbe {
  readonly value: LegacySsoProbe;
  readonly until: number;
}

@Injectable()
export class AuthTransport {
  /** Constructor-assigned (not DI) so a spec can inject a fake without a Nest container. */
  fetchImpl: typeof fetch = globalThis.fetch;
  now: () => number = Date.now;
  retryDeps: RetryDeps = {};

  private readonly legacy: Breaker;
  private cache: CachedProbe | null = null;

  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher,
    breakers: BreakerRegistry,
    private readonly config: AppConfig,
    private readonly logger: LoggerService,
  ) {
    this.legacy = breakers.get('legacy');
  }

  /** Forwards a domain event to the port (ADR-0029); the outbox rebinds the token when the first cross-module subscriber or job exists. */
  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }

  /**
   * Readiness of the legacy `erp_sso` module. Throws `UpstreamUnavailableError` while the
   * `legacy` breaker is open, or the last transient error after `RETRY_POLICIES.legacyHttp.attempts`.
   */
  async probeLegacySso(): Promise<LegacySsoProbe> {
    const now = this.now();
    if (this.cache !== null && this.cache.until > now) return this.cache.value;
    const value = await withRetry(
      RETRY_POLICIES.legacyHttp,
      () => this.legacy.execute((signal) => this.fetchOnce(signal)),
      this.retryDeps,
    );
    this.cache = { value, until: this.now() + TIMINGS.http.legacy.probeCacheMs };
    return value;
  }

  private async fetchOnce(signal: AbortSignal | undefined): Promise<LegacySsoProbe> {
    const response = await this.fetchImpl(this.handoffUrl(), {
      method: 'GET',
      redirect: 'manual',
      headers: { accept: 'application/json' },
      signal: timeoutSignal(TIMINGS.http.legacy.timeoutMs, signal),
    });
    return this.toProbe(response);
  }

  private handoffUrl(): URL {
    const base = this.config.env.LEGACY_BASE_URL;
    if (base === undefined) {
      throw new Error('LEGACY_BASE_URL is not configured; the legacy readiness probe cannot run');
    }
    return new URL(LEGACY_SSO_HANDOFF_PATH, base);
  }

  private toProbe(response: Response): LegacySsoProbe {
    const { status } = response;
    if (status >= HTTP_SERVER_ERROR_FLOOR) throw new UpstreamHttpError('legacy', status);
    if (status === HTTP_METHOD_NOT_ALLOWED) {
      const active =
        response.headers.get(LEGACY_SSO_ACTIVE_HEADER)?.toLowerCase() === LEGACY_SSO_ACTIVE_VALUE;
      if (active) return { status: 'ready', detail: 'active' };
      this.logger.warn('legacy erp_sso module is present but not activated', { status });
      return { status: 'inactive', detail: 'present-not-activated' };
    }
    if (status === HTTP_NOT_FOUND) return { status: 'inactive', detail: 'absent' };
    this.logger.warn('legacy erp_sso probe answered an unexpected status', { status });
    return { status: 'inactive', detail: 'unexpected-status' };
  }
}
