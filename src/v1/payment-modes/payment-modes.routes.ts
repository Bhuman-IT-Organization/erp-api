/**
 * Route constants: the single source for this module's paths and export columns, used by the
 * controller, the validator, the tests and erp-web's endpoint table (the feature's
 * `PAYMENT_MODES_ENDPOINTS`). Relative to the global prefix `api/v1`; the api path stays
 * `payment-modes` while the screens live under `/setup/payment-modes`. `export` is a static
 * segment, so find-my-way serves it before `:id` whatever the declaration order; the controller
 * still declares it first. `active` is the list's one-click switch (D-34), the custom-fields
 * precedent.
 */
export const PAYMENT_MODES_ROUTES = {
  base: 'payment-modes',
  list: '',
  export: 'export',
  record: ':id',
  active: ':id/active',
} as const;

// No permission constant: the module is administrators only (D-06, D-32, BE-25). Its handlers
// declare no code and the service asserts the administrator flag; `@erp/contracts`' `ROUTE_GATES`
// declares the three `/setup/payment-modes` screens `'admin'`.

/**
 * The export's columns, in order: Perfex's four list columns (ID, Name, Description, Active;
 * `views/admin/tables/payment_modes.php` :5-10). The description is its read form; `active` is a
 * boolean cell (`1`/`0` in CSV and Excel, the sent yes or no word in PDF and Print). The usage and
 * the credit-expense lock are never exported.
 */
export const PAYMENT_MODES_EXPORT_COLUMNS = ['id', 'name', 'description', 'active'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>` (print rows carry no file name). */
export const PAYMENT_MODES_EXPORT_FILE_STEM = 'payment-modes';
