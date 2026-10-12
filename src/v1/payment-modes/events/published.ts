/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes extending
 * `DomainEvent` (`shared/events/domain-event.js`), ids not entities, versioned, each with a
 * `static readonly NAME` that the README's "Events published" table lists (the module-shape spec
 * keeps the two in step). Published through `DOMAIN_EVENT_PUBLISHER` from
 * `service/payment-modes.transport.ts` after the write; delivered in-process today and through the
 * transactional outbox once the first cross-module
 * subscriber or job needs it. A payload carries the payment mode's id, the switch's flag and the
 * server time of the change, never its name, its description or a setting (T-4.1-121).
 *
 * The switch publishes ONE event, `activeChanged` with the flag (the custom-fields shape), rather
 * than an `activated` and a `deactivated` (plan 04.1-23, approved 2026-10-03), and only when the
 * flag changed.
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface PaymentModesEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export interface PaymentModesActiveChangedPayload extends PaymentModesEventPayload {
  /** The flag now stored. */
  readonly active: boolean;
}

export class PaymentModesCreatedV1 extends DomainEvent<
  'payment-modes.record.created',
  PaymentModesEventPayload
> {
  static readonly NAME = 'payment-modes.record.created' as const;
  readonly name = PaymentModesCreatedV1.NAME;
}

export class PaymentModesUpdatedV1 extends DomainEvent<
  'payment-modes.record.updated',
  PaymentModesEventPayload
> {
  static readonly NAME = 'payment-modes.record.updated' as const;
  readonly name = PaymentModesUpdatedV1.NAME;
}

export class PaymentModesActiveChangedV1 extends DomainEvent<
  'payment-modes.record.activeChanged',
  PaymentModesActiveChangedPayload
> {
  static readonly NAME = 'payment-modes.record.activeChanged' as const;
  readonly name = PaymentModesActiveChangedV1.NAME;
}

export class PaymentModesDeletedV1 extends DomainEvent<
  'payment-modes.record.deleted',
  PaymentModesEventPayload
> {
  static readonly NAME = 'payment-modes.record.deleted' as const;
  readonly name = PaymentModesDeletedV1.NAME;
}

export const PAYMENT_MODES_PUBLISHED_EVENTS = [
  PaymentModesCreatedV1,
  PaymentModesUpdatedV1,
  PaymentModesActiveChangedV1,
  PaymentModesDeletedV1,
] as const;
