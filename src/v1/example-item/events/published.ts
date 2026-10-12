/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes extending
 * `DomainEvent` (`shared/events/domain-event.js`), ids not entities, versioned — each with a
 * `static readonly NAME` that the README's "Events published" table lists (the module-shape spec
 * keeps the two in step). Published through `DOMAIN_EVENT_PUBLISHER` from
 * `service/example-item.transport.ts`; delivered in-process today and through the transactional
 * outbox once the first cross-module subscriber or job
 * exists. A payload carries the record's id and the server time of the change, never its fields.
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface ExampleItemEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class ExampleItemCreatedV1 extends DomainEvent<
  'example-item.record.created',
  ExampleItemEventPayload
> {
  static readonly NAME = 'example-item.record.created' as const;
  readonly name = ExampleItemCreatedV1.NAME;
}

export class ExampleItemUpdatedV1 extends DomainEvent<
  'example-item.record.updated',
  ExampleItemEventPayload
> {
  static readonly NAME = 'example-item.record.updated' as const;
  readonly name = ExampleItemUpdatedV1.NAME;
}

export const EXAMPLE_ITEM_PUBLISHED_EVENTS = [ExampleItemCreatedV1, ExampleItemUpdatedV1] as const;
