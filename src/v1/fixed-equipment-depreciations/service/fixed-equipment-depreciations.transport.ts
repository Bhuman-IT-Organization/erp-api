/**
 * Transport: the module's outbound seam (BE-03, BE-08): domain events through the publisher port.
 * An in-process call; this module reads no setting and calls no other module.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';

@Injectable()
export class FixedEquipmentDepreciationsTransport {
  constructor(@Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher) {}

  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }
}
