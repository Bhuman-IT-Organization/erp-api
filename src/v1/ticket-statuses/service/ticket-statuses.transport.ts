import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { SettingsFacade } from '../../settings/index.js';

export const DEFAULT_TICKET_REPLY_STATUS_OPTION = 'default_ticket_reply_status';

@Injectable()
export class TicketStatusesTransport {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher,
    private readonly settings: SettingsFacade,
  ) {}

  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }

  defaultTicketReplyStatus(): Promise<string | null> {
    return this.settings.getOption(DEFAULT_TICKET_REPLY_STATUS_OPTION);
  }
}
