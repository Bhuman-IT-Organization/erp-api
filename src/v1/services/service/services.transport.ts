import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';

/** The module's outbound seam: domain events only. No other module, no outbound HTTP. */
@Injectable()
export class ServicesTransport {
  constructor(@Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher) {}

  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }
}
