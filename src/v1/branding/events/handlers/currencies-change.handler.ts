/**
 * The subscriber for `v1/currencies`' two changes that make branding's memo stale (D-39, Currencies
 * planning answer 6, ADR-0029).
 *
 * It registers on `DOMAIN_EVENT_SUBSCRIBER` from `onModuleInit`, so the handlers exist before the
 * first request, and it reaches `v1/currencies` through nothing at all: the names are wire
 * constants in `events/subscribed.ts` (BE-03).
 *
 *   `currencies.record.baseChanged` -> drop the memo: another currency is the base now
 *   `currencies.record.updated`     -> drop the memo: the base's symbol, separators or placement
 *                                      may have changed (any currency's edit drops it; the next
 *                                      read costs one facade call)
 *
 * The payload is not read: a memo drop needs no id, so no payload can make it throw.
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import {
  DOMAIN_EVENT_SUBSCRIBER,
  type DomainEventSubscriber,
} from '../../../../shared/events/domain-event.publisher.js';
import { BrandingService } from '../../service/branding.service.js';
import { BRANDING_SUBSCRIBED_EVENTS } from '../subscribed.js';

@Injectable()
export class CurrenciesChangeEventHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_SUBSCRIBER) private readonly subscriber: DomainEventSubscriber,
    private readonly service: BrandingService,
  ) {}

  onModuleInit(): void {
    for (const name of BRANDING_SUBSCRIBED_EVENTS) {
      this.subscriber.subscribe(name, () => this.dropMemo());
    }
  }

  /** The next `GET /api/v1/branding` reads the base currency again. */
  private dropMemo(): Promise<void> {
    this.service.dropMemo();
    return Promise.resolve();
  }
}
