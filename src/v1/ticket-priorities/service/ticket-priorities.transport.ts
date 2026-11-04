/**
 * Transport: the module's outbound seam (BE-03, BE-08): domain events through the publisher port,
 * and the email-piping default priority through `SettingsFacade`. Both are in-process calls.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { SettingsFacade } from '../../settings/index.js';

/** The Perfex option that names the priority an emailed ticket gets. */
export const EMAIL_PIPING_DEFAULT_PRIORITY_OPTION = 'email_piping_default_priority';

@Injectable()
export class TicketPrioritiesTransport {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher,
    private readonly settings: SettingsFacade,
  ) {}

  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }

  /** The option as stored (`null` without a row). It throws when the setting cannot be read. */
  emailPipingDefaultPriority(): Promise<string | null> {
    return this.settings.getOption(EMAIL_PIPING_DEFAULT_PRIORITY_OPTION);
  }
}
