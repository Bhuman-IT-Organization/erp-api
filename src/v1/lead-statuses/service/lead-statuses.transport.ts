/**
 * Lead Statuses transport.
 *
 * Handles communication with other modules through
 * approved facades and publishes domain events.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { DomainEvent } from '../../../shared/events/domain-event.js';

import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';

import { SettingsFacade } from '../../settings/index.js';

/** Perfex setting identifying the configured default lead status. */
export const LEADS_DEFAULT_STATUS_OPTION = 'leads_default_status';

@Injectable()
export class LeadStatusesTransport {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER)
    private readonly publisher: DomainEventPublisher,
    private readonly settings: SettingsFacade,
  ) {}

  /** Publish an approved domain event. */
  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }

  /** Read the configured default lead status from SettingsFacade. */
  configuredDefaultStatus(): Promise<string | null> {
    return this.settings.getOption(LEADS_DEFAULT_STATUS_OPTION);
  }
}
