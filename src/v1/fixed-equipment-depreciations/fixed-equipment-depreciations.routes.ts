import { PERMISSIONS } from '@erp/contracts';

/**
 * Route constants: the single source for this module's paths, permission codes and export columns.
 * Relative to the global prefix `api/v1`. `export` is a static segment, so it is served before `:id`.
 */
export const FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES = {
  base: 'fixed-equipment-depreciations',
  list: '',
  export: 'export',
  record: ':id',
} as const;

/**
 * The catalogue's `fixedEquipment.settingDepreciation` codes, which `@erp/contracts` maps from Perfex's
 * `fixed_equipment_setting_depreciation`, so a member's stored Perfex permission opens this module as
 * it opened Perfex's tab. `view` is the full-view code and `viewOwn` the narrowed one (the rows the
 * member created): the reads declare `@PermissionsAny(view, viewOwn)`, widest first.
 */
export const FIXED_EQUIPMENT_DEPRECIATIONS_PERMISSIONS =
  PERMISSIONS.fixedEquipment.settingDepreciation;

/** The export's columns, in order: Perfex's three list columns. */
export const FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_COLUMNS = ['id', 'name', 'term'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>`. */
export const FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_FILE_STEM = 'fixed-equipment-depreciations';
