/**
 * Route constants: the single source for this module's paths and export columns. Relative to the
 * global prefix `api/v1`. `export` is a static segment, so it is served before `:id`.
 */
export const TICKET_PRIORITIES_ROUTES = {
  base: 'ticket-priorities',
  list: '',
  export: 'export',
  record: ':id',
} as const;

// No permission constant: the module is administrators only (BE-25). Its handlers declare no code
// and the service asserts the administrator flag; `ROUTE_GATES` declares the three
// `/setup/ticket-priorities` screens `'admin'`.

/** The export's columns, in order. Perfex's table has no date column, so there is no Date Created. */
export const TICKET_PRIORITIES_EXPORT_COLUMNS = ['id', 'name'] as const;

/** The download's file-name stem: `<stem>-YYYY-MM-DD.<csv|xlsx|pdf>`. */
export const TICKET_PRIORITIES_EXPORT_FILE_STEM = 'ticket-priorities';
