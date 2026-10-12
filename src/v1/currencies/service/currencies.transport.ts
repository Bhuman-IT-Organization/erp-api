/**
 * Transport: the module's outbound seam (BE-03, BE-08): domain events through the publisher port,
 * and nothing else. No other module is reached from here: the registered usage counters live
 * in-module (`currency-usage.registry.ts`), handed in by the modules that register them. The events
 * are in-process, so no breaker and no retry; this module makes no outbound HTTP call (ADR-0031
 * section 3, BE-18: `fetch`, a breaker or `shared/resilience/*` would live here and nowhere else).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';

@Injectable()
export class CurrenciesTransport {
  constructor(@Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher) {}

  /** Forwards a domain event to the port (ADR-0029); the outbox rebinds the token when delivery beyond this process is needed. */
  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }
}
