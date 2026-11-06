import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

export const FIXED_EQUIPMENT_DEPRECIATIONS_FACADE_MAX_ROWS = 1000;

export type FixedEquipmentDepreciationsSortField = 'id' | 'name';

/** One `tblfe_depreciations` row, stored form: what the repository reads and writes. */
export interface FixedEquipmentDepreciationRow {
  readonly id: number;
  readonly name: string;
  /** The number of months (`tblfe_depreciations.term`); `null` on a row Perfex stored without one. */
  readonly term: number | null;
  /** The staff member who created it (`creator_id`); `null` on an old Perfex row. */
  readonly creatorId: number | null;
}

/** The model other modules see through the facade: never `creatorId`. */
export interface FixedEquipmentDepreciation {
  readonly id: number;
  readonly name: string;
  /** The number of months; `null` on a row Perfex stored without one. */
  readonly term: number | null;
}

/** What a create stores: the name, the term and the member who creates it. */
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

/** One keyset page and its pager meta (`shared/http/keyset.ts`). */
export interface FixedEquipmentDepreciationsPage extends ListPageMeta {
  readonly items: readonly FixedEquipmentDepreciationRow[];
}

/** Where a depreciation is in use: the asset models and the assets that carry its id. */
export interface FixedEquipmentDepreciationUsage {
  readonly models: number;
  readonly assets: number;
}

/** What the facade says about itself: the module and its contract version. */
export interface FixedEquipmentDepreciationsDescription {
  readonly module: 'fixed-equipment-depreciations';
  readonly version: 1;
}
