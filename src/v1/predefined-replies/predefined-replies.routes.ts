export const PREDEFINED_REPLIES_ROUTES = {
  base: 'predefined-replies',
  list: '',
  export: 'export',
  record: ':id',
} as const;

export const PREDEFINED_REPLIES_EXPORT_COLUMNS = ['id', 'name'] as const;
export const PREDEFINED_REPLIES_EXPORT_FILE_STEM = 'predefined-replies';
