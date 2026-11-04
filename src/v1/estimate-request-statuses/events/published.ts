import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface EstimateRequestStatusesEventPayload {
  readonly id: number;
  readonly at: string;
}

export class EstimateRequestStatusCreatedV1 extends DomainEvent<
  'estimate-request-statuses.record.created',
  EstimateRequestStatusesEventPayload
> {
  static readonly NAME = 'estimate-request-statuses.record.created' as const;
  readonly name = EstimateRequestStatusCreatedV1.NAME;
}

export class EstimateRequestStatusUpdatedV1 extends DomainEvent<
  'estimate-request-statuses.record.updated',
  EstimateRequestStatusesEventPayload
> {
  static readonly NAME = 'estimate-request-statuses.record.updated' as const;
  readonly name = EstimateRequestStatusUpdatedV1.NAME;
}

export class EstimateRequestStatusDeletedV1 extends DomainEvent<
  'estimate-request-statuses.record.deleted',
  EstimateRequestStatusesEventPayload
> {
  static readonly NAME = 'estimate-request-statuses.record.deleted' as const;
  readonly name = EstimateRequestStatusDeletedV1.NAME;
}

export const ESTIMATE_REQUEST_STATUSES_PUBLISHED_EVENTS = [
  EstimateRequestStatusCreatedV1,
  EstimateRequestStatusUpdatedV1,
  EstimateRequestStatusDeletedV1,
] as const;
