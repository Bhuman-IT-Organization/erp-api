/**
 * Transport: the module's outbound seam and the one file in this module that reaches another
 * module (BE-03, BE-08): domain events through the publisher port.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { SettingsFacade } from '../../settings/index.js';

@Injectable()
export class LeadSourcesTransport {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher,
    @Inject(SettingsFacade) private readonly settings: Pick<SettingsFacade, 'getOption'>,
  ) {}

  /** Forwards a domain event to the port (ADR-0029); the outbox rebinds the token when the first cross-module subscriber or job exists. */
  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }

  /** Whether `leads_default_source` names this source, using PHP's integer-prefix cast semantics. */
  async isDefaultSource(id: number): Promise<boolean> {
    const value = await this.settings.getOption('leads_default_source');
    const sourceId = Number.parseInt(value ?? '', 10);
    return sourceId > 0 && sourceId === id;
  }
}
