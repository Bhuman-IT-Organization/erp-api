import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface LeadStatusesEventPayload {
  readonly id: number;
  /** ISO timestamp of the change. */
  readonly at: string;
}

export class LeadStatusesCreatedV1 extends DomainEvent<
  'lead-statuses.record.created',
  LeadStatusesEventPayload
> {
  static readonly NAME = 'lead-statuses.record.created' as const;
  readonly name = LeadStatusesCreatedV1.NAME;
}

export class LeadStatusesUpdatedV1 extends DomainEvent<
  'lead-statuses.record.updated',
  LeadStatusesEventPayload
> {
  static readonly NAME = 'lead-statuses.record.updated' as const;
  readonly name = LeadStatusesUpdatedV1.NAME;
}

export class LeadStatusesDeletedV1 extends DomainEvent<
  'lead-statuses.record.deleted',
  LeadStatusesEventPayload
> {
  static readonly NAME = 'lead-statuses.record.deleted' as const;
  readonly name = LeadStatusesDeletedV1.NAME;
}

export const LEAD_STATUSES_PUBLISHED_EVENTS = [
  LeadStatusesCreatedV1,
  LeadStatusesUpdatedV1,
  LeadStatusesDeletedV1,
] as const;
