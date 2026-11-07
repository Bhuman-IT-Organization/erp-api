/**
 * Transport seam for the event publisher, the Identity facade and the Settings facade this module
 * calls across modules. These in-process calls need no breaker or retry and make no outbound HTTP
 * request.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { IdentityFacade } from '../../identity/index.js';
import { SettingsFacade } from '../../settings/index.js';

/** The Perfex option that names PHP's zone (`App_Controller.php:59-62`), read for the wall clock of `dateadded`. */
export const COMPANY_TIME_ZONE_OPTION = 'default_timezone';

@Injectable()
export class AnnouncementsTransport {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher,
    private readonly identity: IdentityFacade,
    private readonly settings: SettingsFacade,
  ) {}

  /** The staff member's stored display name from identity, keyed by staff id. */
  nameOf(staffId: number): Promise<ReadonlyMap<number, string>> {
    return this.identity.namesOf([staffId]);
  }

  /** Perfex's `default_timezone` option as stored (`null` without a row); the zone helper decides the zone. */
  companyTimeZone(): Promise<string | null> {
    return this.settings.getOption(COMPANY_TIME_ZONE_OPTION);
  }

  /** Forwards a domain event to the port (ADR-0029). */
  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }
}
