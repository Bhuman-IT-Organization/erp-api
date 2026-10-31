import type { DecodedCursor } from '../../../shared/http/keyset.js';

export const FIXED_EQUIPMENT_DEPRECIATIONS_FACADE_MAX_ROWS = 1000;

export type FixedEquipmentDepreciationsSortField = 'id' | 'name';

/** The model other modules see, and the shape of a stored row. */
export interface FixedEquipmentDepreciation {
  readonly id: number;
  readonly name: string;
  /** The number of months (`tblfe_depreciations.term`); `null` on a row Perfex stored without one. */
  readonly term: number | null;
  /** The staff member who created it (`creator_id`); `null` on an old Perfex row. */
  readonly creatorId: number | null;
}

export interface NewFixedEquipmentDepreciation {
  readonly name: string;
  readonly term: number;
  readonly creatorId: number;
}

/** What an edit changes: Perfex's form posts the name and the term only. */
export interface FixedEquipmentDepreciationPatch {
  readonly name: string;
  readonly term: number;
}

export interface FixedEquipmentDepreciationsListRequest {
  readonly search: string | null;
  readonly sortField: FixedEquipmentDepreciationsSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<FixedEquipmentDepreciationsSortField> | null;
  readonly limit: number;
}

export interface FixedEquipmentDepreciationsPage {
  readonly items: FixedEquipmentDepreciation[];
  readonly nextCursor: string | null;
  readonly prevCursor: string | null;
  readonly total: number;
  readonly rangeStart: number;
}
