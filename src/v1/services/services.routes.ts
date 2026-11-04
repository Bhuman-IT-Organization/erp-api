/**
 * Route constants, relative to the global prefix `api/v1`. `export` is a static segment, so
 * find-my-way serves it before `:id`; the controller still declares it first.
 */
export const SERVICES_ROUTES = {
  base: 'services',
  list: '',
  export: 'export',
  record: ':id',
} as const;

// No permission constant: administrators only (D-06, D-26, BE-25). `@erp/contracts`' `ROUTE_GATES`
// declares the three `/setup/services` screens `'admin'`.

/** The export's columns, in order: the list's two columns (ID, Service Name). */
export const SERVICES_EXPORT_COLUMNS = ['id', 'name'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>`. */
export const SERVICES_EXPORT_FILE_STEM = 'services';
