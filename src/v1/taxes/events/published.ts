/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes extending
 * `DomainEvent` (`shared/events/domain-event.js`), ids not entities, versioned, each with a
 * `static readonly NAME` that the README's "Events published" table lists (the module-shape spec
 * keeps the two in step). Published through `DOMAIN_EVENT_PUBLISHER` from
 * `service/taxes.transport.ts` after the write; delivered in-process today and through the
 * transactional outbox once the first cross-module
 * subscriber or job needs it. A payload carries the tax's id and the server time of the change,
 * never its name or its rate (T-4.1-45). A row Perfex Subscriptions inserts publishes nothing (D-20).
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface TaxesEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class TaxesCreatedV1 extends DomainEvent<'taxes.record.created', TaxesEventPayload> {
  static readonly NAME = 'taxes.record.created' as const;
  readonly name = TaxesCreatedV1.NAME;
}

export class TaxesUpdatedV1 extends DomainEvent<'taxes.record.updated', TaxesEventPayload> {
  static readonly NAME = 'taxes.record.updated' as const;
  readonly name = TaxesUpdatedV1.NAME;
}

export class TaxesDeletedV1 extends DomainEvent<'taxes.record.deleted', TaxesEventPayload> {
  static readonly NAME = 'taxes.record.deleted' as const;
  readonly name = TaxesDeletedV1.NAME;
}

export const TAXES_PUBLISHED_EVENTS = [TaxesCreatedV1, TaxesUpdatedV1, TaxesDeletedV1] as const;
