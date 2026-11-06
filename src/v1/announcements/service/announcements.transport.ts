/**
 * Transport seam for the event publisher and Identity facade calls this module makes across modules.
 * These in-process calls need no breaker or retry and make no outbound HTTP request.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { IdentityFacade } from '../../identity/index.js';

@Injectable()
export class AnnouncementsTransport {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher,
    private readonly identity: IdentityFacade,
  ) {}

  /** The staff member's stored display name from identity, keyed by staff id. */
  nameOf(staffId: number): Promise<ReadonlyMap<number, string>> {
    return this.identity.namesOf([staffId]);
  }

  /** Forwards a domain event to the port (ADR-0029). */
  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }
}
