/** Routes relative to the global `api/v1` prefix. */
export const TICKET_STATUSES_ROUTES = {
  base: 'ticket-statuses',
  list: '',
  export: 'export',
  record: ':id',
} as const;

export const TICKET_STATUSES_EXPORT_COLUMNS = ['id', 'name', 'ticket_count'] as const;
export const TICKET_STATUSES_EXPORT_FILE_STEM = 'ticket-statuses';
