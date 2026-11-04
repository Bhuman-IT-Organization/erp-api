/**
 * Route constants: the single source for this module's paths and export columns, used by the
 * controller, the validator, the tests and erp-web's endpoint table (the feature's
 * `LEAD_SOURCES_ENDPOINTS`). Relative to the global prefix `api/v1`; the api path stays
 * `lead-sources` while the screens live under `/setup/lead-sources`. `export` is a static segment,
 * so find-my-way serves it before `:id` whatever the declaration order; the controller still
 * declares it first.
 */
export const LEAD_SOURCES_ROUTES = {
  base: 'lead-sources',
  list: '',
  export: 'export',
  record: ':id',
} as const;

// No permission constant: the module is administrators only (D-06, D-26, BE-25). Its handlers
// declare no code and the service asserts the administrator flag; `@erp/contracts`' `ROUTE_GATES`
// declares the three `/setup/lead-sources` screens `'admin'`.

/**
 * The export's columns, in order: ID, Name, Total Leads. Every format
 * writes them as text, escaped against formulas in CSV and Excel by the shared core.
 */
export const LEAD_SOURCES_EXPORT_COLUMNS = ['id', 'name', 'totalLeads'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>` (print rows carry no file name). */
export const LEAD_SOURCES_EXPORT_FILE_STEM = 'lead-sources';
