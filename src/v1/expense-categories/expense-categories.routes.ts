/**
 * Route constants: the single source for this module's paths and export columns, used by the
 * controller, the validator, the tests and erp-web's endpoint table (the feature's
 * `EXPENSE_CATEGORIES_ENDPOINTS`). Relative to the global prefix `api/v1`; the api path stays
 * `expense-categories` while the screens live under `/setup/expense-categories`. `export` is a
 * static segment, so find-my-way serves it before `:id` whatever the declaration order; the
 * controller still declares it first.
 */
export const EXPENSE_CATEGORIES_ROUTES = {
  base: 'expense-categories',
  list: '',
  export: 'export',
  record: ':id',
} as const;

// No permission constant: the module is administrators only (D-06, BE-25). Its handlers declare no
// code and the service asserts the administrator flag; `@erp/contracts`' `ROUTE_GATES` declares
// the three `/setup/expense-categories` screens `'admin'`.

/**
 * The export's columns, in order: the response DTO's fields (D-42: one `header` label each; D-13:
 * `column` picks a subset). Every format writes them as text: the description in its read form,
 * escaped against formulas in CSV and Excel, as is in PDF and Print. The usage counts of a list row
 * are never exported.
 */
export const EXPENSE_CATEGORIES_EXPORT_COLUMNS = ['id', 'name', 'description'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>` (print rows carry no file name). */
export const EXPENSE_CATEGORIES_EXPORT_FILE_STEM = 'expense-categories';
