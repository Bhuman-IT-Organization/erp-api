/**
 * Route constants: the single source for this module's paths and export columns, used by the
 * controller, the service, the tests and erp-web's endpoint table. Relative to the global prefix
 * `api/v1`; the api path stays `customer-groups` while the screens live under
 * `/setup/customer-groups`. `export` is a static segment, so find-my-way serves it before `:id`
 * whatever the declaration order; the controller still declares it first.
 */
export const CUSTOMER_GROUPS_ROUTES = {
  base: 'customer-groups',
  list: '',
  export: 'export',
  record: ':id',
} as const;

// No permission constant: the module is administrators only. Its handlers declare no code and
// the service asserts the administrator flag; `@erp/contracts`' `ROUTE_GATES` declares the three
// `/setup/customer-groups` screens `'admin'`.

/**
 * The export's columns, in order: Perfex's groups table columns (ID, Name). Every format writes
 * them as text, escaped against formulas in CSV and Excel by the shared core.
 */
export const CUSTOMER_GROUPS_EXPORT_COLUMNS = ['id', 'name'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>` (print rows carry no file name). */
export const CUSTOMER_GROUPS_EXPORT_FILE_STEM = 'customer-groups';
