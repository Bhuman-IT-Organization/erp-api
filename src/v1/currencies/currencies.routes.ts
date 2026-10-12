/**
 * Route constants: the single source for this module's paths and export columns, used by the
 * controller, the validator, the tests and erp-web's endpoint table (the feature's
 * `CURRENCIES_ENDPOINTS`). Relative to the global prefix `api/v1`; the api path stays `currencies`
 * while the screens live under `/setup/currencies`. `export` is a static segment, so find-my-way
 * serves it before `:id` whatever the declaration order; the controller still declares it first.
 * `makeBase` is Perfex's make-base link as one call (D-39).
 */
export const CURRENCIES_ROUTES = {
  base: 'currencies',
  list: '',
  export: 'export',
  record: ':id',
  makeBase: ':id/base',
} as const;

// No permission constant: the module is administrators only (D-06, D-38, BE-25). Its handlers
// declare no code and the service asserts the administrator flag; `@erp/contracts`' `ROUTE_GATES`
// declares the three `/setup/currencies` screens `'admin'`.

/**
 * The export's columns, in order: Perfex's list columns (`views/admin/tables/currencies.php`: the
 * code and the symbol, the base marked on the code). `isBase` is a boolean cell (`1`/`0` in CSV and
 * Excel, the sent yes or no word in PDF and Print). The usage is never exported.
 */
export const CURRENCIES_EXPORT_COLUMNS = ['name', 'symbol', 'isBase'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>` (print rows carry no file name). */
export const CURRENCIES_EXPORT_FILE_STEM = 'currencies';
