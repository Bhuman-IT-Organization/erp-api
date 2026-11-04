/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes extending
 * `DomainEvent`, ids not entities, versioned, each with a `static readonly NAME` that the README's
 * "Events published" table lists. Published through `DOMAIN_EVENT_PUBLISHER` from
 * `service/customer-groups.transport.ts` after the write. A payload carries the customer group's
 * id and the server time of the change, never its name.
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface CustomerGroupsEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class CustomerGroupsCreatedV1 extends DomainEvent<
  'customer-groups.record.created',
  CustomerGroupsEventPayload
> {
  static readonly NAME = 'customer-groups.record.created' as const;
  readonly name = CustomerGroupsCreatedV1.NAME;
}

export class CustomerGroupsUpdatedV1 extends DomainEvent<
  'customer-groups.record.updated',
  CustomerGroupsEventPayload
> {
  static readonly NAME = 'customer-groups.record.updated' as const;
  readonly name = CustomerGroupsUpdatedV1.NAME;
}

export class CustomerGroupsDeletedV1 extends DomainEvent<
  'customer-groups.record.deleted',
  CustomerGroupsEventPayload
> {
  static readonly NAME = 'customer-groups.record.deleted' as const;
  readonly name = CustomerGroupsDeletedV1.NAME;
}

export const CUSTOMER_GROUPS_PUBLISHED_EVENTS = [
  CustomerGroupsCreatedV1,
  CustomerGroupsUpdatedV1,
  CustomerGroupsDeletedV1,
] as const;
