/**
 * Transport: the module's outbound seam and the one file in this module that reaches another
 * module (BE-03, BE-08): domain events through the publisher port, and Perfex's
 * `expense_credit_payment_mode` option through `SettingsFacade` (`settings/index.js`, D-37). Both
 * are in-process calls, so no breaker and no retry; this module makes no outbound HTTP call
 * (ADR-0031 section 3, BE-18: `fetch`, a breaker or `shared/resilience/*` would live here and
 * nowhere else).
 */
import { Inject, Injectable } from '@nestjs/common';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  type DomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { SettingsFacade } from '../../settings/index.js';

/**
 * The Perfex option naming the payment mode that marks an expense as a credit expense: read by the
 * client's expense code (`Expenses_model.php:109`, `Expenses.php:91`), written by no screen (D-37).
 */
export const CREDIT_EXPENSE_MODE_OPTION = 'expense_credit_payment_mode';

@Injectable()
export class PaymentModesTransport {
  constructor(
    @Inject(DOMAIN_EVENT_PUBLISHER) private readonly publisher: DomainEventPublisher,
    private readonly settings: SettingsFacade,
  ) {}

  /** Forwards a domain event to the port (ADR-0029); the outbox rebinds the token when the first cross-module subscriber or job exists. */
  publish(event: DomainEvent): Promise<void> {
    return this.publisher.publish(event);
  }

  /** Perfex's `expense_credit_payment_mode` as stored (`null` without a row); the transformer casts it. */
  creditExpenseMode(): Promise<string | null> {
    return this.settings.getOption(CREDIT_EXPENSE_MODE_OPTION);
  }
}
