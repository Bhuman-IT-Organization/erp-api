/**
 * Route constants: the single source for this module's paths and export columns.
 * Relative to the global prefix `api/v1`.
 */
import { PERMISSIONS } from '@erp/contracts';

export const KNOWLEDGE_BASE_GROUPS_ROUTES = {
  base: 'knowledge-base-groups',
  list: '',
  export: 'export',
  record: ':id',
} as const;

export const KNOWLEDGE_BASE_GROUPS_PERMISSIONS = {
  view: PERMISSIONS.knowledgeBase.articles.view,
  create: PERMISSIONS.knowledgeBase.articles.create,
  edit: PERMISSIONS.knowledgeBase.articles.edit,
  delete: PERMISSIONS.knowledgeBase.articles.delete,
} as const;

export const KNOWLEDGE_BASE_GROUPS_EXPORT_COLUMNS = [
  'id',
  'name',
  'color',
  'groupOrder',
  'active',
  'totalArticles',
] as const;

export const KNOWLEDGE_BASE_GROUPS_EXPORT_FILE_STEM = 'knowledge-base-groups';
