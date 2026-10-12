/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes extending
 * `DomainEvent` (`shared/events/domain-event.js`), ids not entities, versioned, each with a
 * `static readonly NAME` that the README's "Events published" table lists (the module-shape spec
 * keeps the two in step). Published through `DOMAIN_EVENT_PUBLISHER` from
 * `service/cost-centers.transport.ts` after the write; delivered in-process today and through the
 * transactional outbox once the first cross-module
 * subscriber or job needs it. A payload carries the cost center's id and the server time of the
 * change, never its name (T-4.1-89).
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface CostCentersEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class CostCentersCreatedV1 extends DomainEvent<
  'cost-centers.record.created',
  CostCentersEventPayload
> {
  static readonly NAME = 'cost-centers.record.created' as const;
  readonly name = CostCentersCreatedV1.NAME;
}

export class CostCentersUpdatedV1 extends DomainEvent<
  'cost-centers.record.updated',
  CostCentersEventPayload
> {
  static readonly NAME = 'cost-centers.record.updated' as const;
  readonly name = CostCentersUpdatedV1.NAME;
}

export class CostCentersDeletedV1 extends DomainEvent<
  'cost-centers.record.deleted',
  CostCentersEventPayload
> {
  static readonly NAME = 'cost-centers.record.deleted' as const;
  readonly name = CostCentersDeletedV1.NAME;
}

export const COST_CENTERS_PUBLISHED_EVENTS = [
  CostCentersCreatedV1,
  CostCentersUpdatedV1,
  CostCentersDeletedV1,
] as const;
