import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface TicketStatusEventPayload {
  readonly id: number;
  readonly at: string;
}

export class TicketStatusCreatedV1 extends DomainEvent<
  'ticket-statuses.record.created',
  TicketStatusEventPayload
> {
  static readonly NAME = 'ticket-statuses.record.created' as const;
  readonly name = TicketStatusCreatedV1.NAME;
}

export class TicketStatusUpdatedV1 extends DomainEvent<
  'ticket-statuses.record.updated',
  TicketStatusEventPayload
> {
  static readonly NAME = 'ticket-statuses.record.updated' as const;
  readonly name = TicketStatusUpdatedV1.NAME;
}

export class TicketStatusDeletedV1 extends DomainEvent<
  'ticket-statuses.record.deleted',
  TicketStatusEventPayload
> {
  static readonly NAME = 'ticket-statuses.record.deleted' as const;
  readonly name = TicketStatusDeletedV1.NAME;
}

export const TICKET_STATUSES_PUBLISHED_EVENTS = [
  TicketStatusCreatedV1,
  TicketStatusUpdatedV1,
  TicketStatusDeletedV1,
] as const;
