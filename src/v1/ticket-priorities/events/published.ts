/**
 * Domain events this module publishes (ADR-0029, BE-13). Past-tense typed classes; the payload
 * carries the id and the server time of the change, never the name.
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface TicketPrioritiesEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class TicketPrioritiesCreatedV1 extends DomainEvent<
  'ticket-priorities.record.created',
  TicketPrioritiesEventPayload
> {
  static readonly NAME = 'ticket-priorities.record.created' as const;
  readonly name = TicketPrioritiesCreatedV1.NAME;
}

export class TicketPrioritiesUpdatedV1 extends DomainEvent<
  'ticket-priorities.record.updated',
  TicketPrioritiesEventPayload
> {
  static readonly NAME = 'ticket-priorities.record.updated' as const;
  readonly name = TicketPrioritiesUpdatedV1.NAME;
}

export class TicketPrioritiesDeletedV1 extends DomainEvent<
  'ticket-priorities.record.deleted',
  TicketPrioritiesEventPayload
> {
  static readonly NAME = 'ticket-priorities.record.deleted' as const;
  readonly name = TicketPrioritiesDeletedV1.NAME;
}

export const TICKET_PRIORITIES_PUBLISHED_EVENTS = [
  TicketPrioritiesCreatedV1,
  TicketPrioritiesUpdatedV1,
  TicketPrioritiesDeletedV1,
] as const;
