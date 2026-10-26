/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes extending
 * `DomainEvent` (`shared/events/domain-event.js`), ids not entities, versioned, each with a
 * `static readonly NAME` that the README's "Events published" table lists (the module-shape spec
 * keeps the two in step). Published through `DOMAIN_EVENT_PUBLISHER` from
 * `service/contract-types.transport.ts` after the write; delivered in-process today and through the
 * transactional outbox once the first cross-module subscriber or job needs it. A payload carries
 * the contract type's id and the server time of the change, never its name (T-4.1-89).
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface ContractTypesEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class ContractTypesCreatedV1 extends DomainEvent<
  'contract-types.record.created',
  ContractTypesEventPayload
> {
  static readonly NAME = 'contract-types.record.created' as const;
  readonly name = ContractTypesCreatedV1.NAME;
}

export class ContractTypesUpdatedV1 extends DomainEvent<
  'contract-types.record.updated',
  ContractTypesEventPayload
> {
  static readonly NAME = 'contract-types.record.updated' as const;
  readonly name = ContractTypesUpdatedV1.NAME;
}

export class ContractTypesDeletedV1 extends DomainEvent<
  'contract-types.record.deleted',
  ContractTypesEventPayload
> {
  static readonly NAME = 'contract-types.record.deleted' as const;
  readonly name = ContractTypesDeletedV1.NAME;
}

export const CONTRACT_TYPES_PUBLISHED_EVENTS = [
  ContractTypesCreatedV1,
  ContractTypesUpdatedV1,
  ContractTypesDeletedV1,
] as const;
