/**
 * Route constants: the single source for this module's paths and export columns, used by the
 * controller, the validator, the tests and erp-web's endpoint table (the feature's
 * `CONTRACT_TYPES_ENDPOINTS`). Relative to the global prefix `api/v1`; the api path stays
 * `contract-types` while the screens live under `/setup/contract-types`. `export` is a static segment,
 * so find-my-way serves it before `:id` whatever the declaration order; the controller still
 * declares it first.
 */
export const CONTRACT_TYPES_ROUTES = {
  base: 'contract-types',
  list: '',
  export: 'export',
  record: ':id',
} as const;

// No permission constant: the module is administrators only (D-06, D-26, BE-25). Its handlers
// declare no code and the service asserts the administrator flag; `@erp/contracts`' `ROUTE_GATES`
// declares the three `/setup/contract-types` screens `'admin'`.

/**
 * The export's columns, in order: Name and the number of contracts.
 */
export const CONTRACT_TYPES_EXPORT_COLUMNS = ['name', 'contracts'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>` (print rows carry no file name). */
export const CONTRACT_TYPES_EXPORT_FILE_STEM = 'contract-types';
