/**
 * Transport: the module's outbound seam: domain events through the publisher port, and the only
 * file in this module where `fetch`, a breaker or `shared/resilience/*` may appear (ADR-0031 §3,
 * BE-18; the architecture block in `eslint.config.mjs` rejects them anywhere else). Services and
 * repositories call this class, never a vendor.
 *
 * This skeleton makes no outbound call. When a real module does, the shape is exactly this :
 * retry OUTSIDE the breaker so every attempt is counted by the circuit, the timeout on the
 * request itself, every number from `TIMINGS` / `RETRY_POLICIES` (`v1/auth`'s
 * `service/auth.transport.ts#probeLegacySso` is the built example):
 *
 * ```ts
 * import { RETRY_POLICIES } from '../../../shared/config/retry-policies.js';
 * import { TIMINGS } from '../../../shared/config/timings.js';
 * import { BreakerRegistry, type Breaker } from '../../../shared/resilience/breaker.js';
 * import { withRetry } from '../../../shared/resilience/retry.js';
 * import { timeoutSignal } from '../../../shared/resilience/timeout.js';
 *
 * private readonly vendor: Breaker; // = breakers.get('<name from BREAKER_NAMES>') in the constructor
 *
 * const response = await withRetry(RETRY_POLICIES.vendorHttp, () =>
 *   this.vendor.execute((signal) =>
 *     fetch(url, { signal: timeoutSignal(TIMINGS.http.vendor.timeoutMs, signal) }),
 *   ),
 * );
 * ```
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';

@Injectable()
export class TaxesTransport {
  constructor(@Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher) {}

  /** Forwards a domain event to the port (ADR-0029); the outbox rebinds the token when the first cross-module subscriber or job exists. */
  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }
}
