/**
 * Domain events this module publishes (ADR-0029, BE-13). Past-tense typed classes; the payload
 * carries the id and the server time of the change, never the name.
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface FixedEquipmentDepreciationsEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class FixedEquipmentDepreciationsCreatedV1 extends DomainEvent<
  'fixed-equipment-depreciations.record.created',
  FixedEquipmentDepreciationsEventPayload
> {
  static readonly NAME = 'fixed-equipment-depreciations.record.created' as const;
  readonly name = FixedEquipmentDepreciationsCreatedV1.NAME;
}

export class FixedEquipmentDepreciationsUpdatedV1 extends DomainEvent<
  'fixed-equipment-depreciations.record.updated',
  FixedEquipmentDepreciationsEventPayload
> {
  static readonly NAME = 'fixed-equipment-depreciations.record.updated' as const;
  readonly name = FixedEquipmentDepreciationsUpdatedV1.NAME;
}

export class FixedEquipmentDepreciationsDeletedV1 extends DomainEvent<
  'fixed-equipment-depreciations.record.deleted',
  FixedEquipmentDepreciationsEventPayload
> {
  static readonly NAME = 'fixed-equipment-depreciations.record.deleted' as const;
  readonly name = FixedEquipmentDepreciationsDeletedV1.NAME;
}

export const FIXED_EQUIPMENT_DEPRECIATIONS_PUBLISHED_EVENTS = [
  FixedEquipmentDepreciationsCreatedV1,
  FixedEquipmentDepreciationsUpdatedV1,
  FixedEquipmentDepreciationsDeletedV1,
] as const;
