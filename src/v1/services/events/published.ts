import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface ServicesEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class ServicesCreatedV1 extends DomainEvent<
  'services.record.created',
  ServicesEventPayload
> {
  static readonly NAME = 'services.record.created' as const;
  readonly name = ServicesCreatedV1.NAME;
}

export class ServicesUpdatedV1 extends DomainEvent<
  'services.record.updated',
  ServicesEventPayload
> {
  static readonly NAME = 'services.record.updated' as const;
  readonly name = ServicesUpdatedV1.NAME;
}

export class ServicesDeletedV1 extends DomainEvent<
  'services.record.deleted',
  ServicesEventPayload
> {
  static readonly NAME = 'services.record.deleted' as const;
  readonly name = ServicesDeletedV1.NAME;
}

export const SERVICES_PUBLISHED_EVENTS = [
  ServicesCreatedV1,
  ServicesUpdatedV1,
  ServicesDeletedV1,
] as const;
