import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { SettingsFacade } from '../../settings/index.js';

/** The Perfex option that names PHP's zone, read for the wall clock of `dateadded`. */
export const COMPANY_TIME_ZONE_OPTION = 'default_timezone';

@Injectable()
export class TodoTransport {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher,
    private readonly settings: SettingsFacade,
  ) {}

  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }

  /** `default_timezone` as stored (`null` without a row); the transformer decides the zone. */
  companyTimeZone(): Promise<string | null> {
    return this.settings.getOption(COMPANY_TIME_ZONE_OPTION);
  }
}
