export const ESTIMATE_REQUEST_STATUSES_ROUTES = {
  base: 'estimate-request-statuses',
  list: '',
  export: 'export',
  record: ':id',
} as const;

export const ESTIMATE_REQUEST_STATUSES_EXPORT_COLUMNS = ['id', 'name', 'total_request'] as const;
export const ESTIMATE_REQUEST_STATUSES_EXPORT_FILE_STEM = 'estimate-request-statuses';
