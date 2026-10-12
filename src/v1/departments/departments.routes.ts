/**
 * Route constants: the single source for this module's paths and export columns, used by the
 * controller, the validator and the tests. Relative to the global prefix `api/v1`. Every route is a
 * read: this copy has no Node Departments screen, and Perfex's `admin/departments` page stays the
 * screen and the only writer of `tbldepartments`. `export`, `managers` and `options` are static
 * segments, so find-my-way serves them before `:id` whatever the declaration order; the controller
 * still declares them first.
 *
 * No permission map: every route is administrators only (D-06, D-45), asserted by the service.
 */
export const DEPARTMENTS_ROUTES = {
  base: 'departments',
  list: '',
  export: 'export',
  managers: 'managers',
  options: 'options',
  record: ':id',
} as const;

/**
 * The export's columns, in order: Perfex's list columns (`views/admin/tables/departments.php`)
 * minus its Email column, which is a mailbox column Node never reads (D-47). All three are text.
 */
export const DEPARTMENTS_EXPORT_COLUMNS = ['id', 'name', 'calendarId'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>` (print rows carry no file name). */
export const DEPARTMENTS_EXPORT_FILE_STEM = 'departments';
