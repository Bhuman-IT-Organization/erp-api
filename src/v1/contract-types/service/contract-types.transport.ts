/**
 * Transport: the module's outbound seam: domain events through the publisher port.
 * An in-process call, so no breaker and no retry; this module makes no outbound HTTP call.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';

@Injectable()
export class ContractTypesTransport {
  constructor(@Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher) {}

  /** Forwards a domain event to the port (ADR-0029). */
  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }
}
