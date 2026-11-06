/**
 * Route constants: the single source for this module's paths and export columns.
 * Relative to the global prefix `api/v1`. `export` is a static segment, so it is served before `:id`.
 */
export const FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES = {
  base: 'fixed-equipment-depreciations',
  list: '',
  export: 'export',
  record: ':id',
} as const;

/** The export's columns, in order: Perfex's three list columns. */
export const FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_COLUMNS = ['id', 'name', 'term'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>`. */
export const FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_FILE_STEM = 'fixed-equipment-depreciations';
