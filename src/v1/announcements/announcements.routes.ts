/**
 * Route constants: the single source for this module's paths and export columns, used by the
 * controller, the service, the tests and erp-web's endpoint table. Relative to the global prefix
 * `api/v1`; the api path stays `announcements` while the screens live under `/setup/announcements`.
 * `export` is a static segment, so find-my-way serves it before `:id` whatever the declaration
 * order; the controller still declares it first.
 */
export const ANNOUNCEMENTS_ROUTES = {
  base: 'announcements',
  list: '',
  export: 'export',
  record: ':id',
} as const;

// No permission constant: the API handlers assert the administrator flag; `@erp/contracts`'
// `ROUTE_GATES` marks the three `/setup/announcements` screens `'admin'`. Perfex's
// `Announcements.php::index()` has no admin check; only its menu item, form and delete are admin-only.

/**
 * The export's columns, in order. Perfex's list has Name and Date only; the Node export adds ID.
 * Every format writes them as text, escaped against formulas in CSV and Excel by the shared core.
 */
export const ANNOUNCEMENTS_EXPORT_COLUMNS = ['id', 'name', 'dateadded'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>` (print rows carry no file name). */
export const ANNOUNCEMENTS_EXPORT_FILE_STEM = 'announcements';
