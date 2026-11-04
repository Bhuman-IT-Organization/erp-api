/**
 * API route constants for the Lead Statuses module.
 * Paths are relative to the global api/v1 prefix.
 *
 * Frontend screens use /setup/lead-statuses.
 * All operations are administrator-only.
 */
export const LEAD_STATUSES_ROUTES = {
  base: 'lead-statuses',
  list: '',
  export: 'export',
  record: ':id',
} as const;

/**
 * Export filename prefix.
 * Example: lead-statuses-2026-10-22.csv
 */
export const LEAD_STATUSES_EXPORT_FILE_STEM = 'lead-statuses';

export const LEAD_STATUSES_EXPORT_COLUMNS = [
  'id',
  'name',
  'statusorder',
  'color',
  'isdefault',
] as const;
