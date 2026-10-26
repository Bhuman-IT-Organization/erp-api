/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes extending
 * `DomainEvent` (`shared/events/domain-event.js`), ids not entities, versioned, each with a
 * `static readonly NAME` that the README's "Events published" table lists (the module-shape spec
 * keeps the two in step). Published through `DOMAIN_EVENT_PUBLISHER` from
 * `service/lead-sources.transport.ts` after the write; delivered in-process today and through the
 * transactional outbox once the first cross-module
 * subscriber or job needs it. A payload carries the lead source's id and the server time of the
 * change, never its name.
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface LeadSourcesEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class LeadSourcesCreatedV1 extends DomainEvent<
  'lead-sources.record.created',
  LeadSourcesEventPayload
> {
  static readonly NAME = 'lead-sources.record.created' as const;
  readonly name = LeadSourcesCreatedV1.NAME;
}

export class LeadSourcesUpdatedV1 extends DomainEvent<
  'lead-sources.record.updated',
  LeadSourcesEventPayload
> {
  static readonly NAME = 'lead-sources.record.updated' as const;
  readonly name = LeadSourcesUpdatedV1.NAME;
}

export class LeadSourcesDeletedV1 extends DomainEvent<
  'lead-sources.record.deleted',
  LeadSourcesEventPayload
> {
  static readonly NAME = 'lead-sources.record.deleted' as const;
  readonly name = LeadSourcesDeletedV1.NAME;
}

export const LEAD_SOURCES_PUBLISHED_EVENTS = [
  LeadSourcesCreatedV1,
  LeadSourcesUpdatedV1,
  LeadSourcesDeletedV1,
] as const;
