/**
 * Route constants: the single source for this module's paths and export columns, used by the
 * controller, the validator, the tests and erp-web's endpoint table (the feature's
 * `TAXES_ENDPOINTS`). Relative to the global prefix `api/v1`; the api path stays `taxes` while the
 * screens live under `/setup/taxes`. `export` is a static segment, so find-my-way serves it before
 * `:id` whatever the declaration order; the controller still declares it first.
 */
export const TAXES_ROUTES = {
  base: 'taxes',
  list: '',
  export: 'export',
  record: ':id',
} as const;

// No permission constant: the module is administrators only (D-06, BE-25). Its handlers declare no
// code and the service asserts the administrator flag; `@erp/contracts`' `ROUTE_GATES` declares
// the three `/setup/taxes` screens `'admin'`.

/**
 * The export's columns, in order: the response DTO's own fields (D-42: one `header` label each;
 * D-13: `column` picks a subset). Every format writes them as text, escaped against formulas in CSV
 * and Excel by the shared core. The usage counts and `isDefault` are never exported.
 */
export const TAXES_EXPORT_COLUMNS = ['id', 'name', 'rate'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>` (print rows carry no file name). */
export const TAXES_EXPORT_FILE_STEM = 'taxes';
