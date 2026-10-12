/**
 * Transport: the module's outbound seam and the one file in this module that reaches another
 * module (BE-03, BE-08): domain events through the publisher port, and Perfex's `default_timezone`
 * through `SettingsFacade` (`settings/index.js`). Both are in-process calls, so no breaker and no
 * retry; this module makes no outbound HTTP call (ADR-0031 section 3, BE-18: `fetch`, a breaker or
 * `shared/resilience/*` would live here and nowhere else).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { SettingsFacade } from '../../settings/index.js';

/** The Perfex option that names PHP's zone (`App_Controller.php:59-62`), read for D-31's wall clock. */
export const COMPANY_TIME_ZONE_OPTION = 'default_timezone';

@Injectable()
export class CostCentersTransport {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher,
    private readonly settings: SettingsFacade,
  ) {}

  /** Forwards a domain event to the port (ADR-0029); the outbox rebinds the token when the first cross-module subscriber or job exists. */
  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }

  /** Perfex's `default_timezone` option as stored (`null` without a row); the transformer decides the zone. */
  companyTimeZone(): Promise<string | null> {
    return this.settings.getOption(COMPANY_TIME_ZONE_OPTION);
  }
}
