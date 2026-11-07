import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

export interface KnowledgeBaseGroupRow {
  readonly groupid: number;
  readonly name: string;
  readonly group_slug: string | null;
  readonly description: string | null;
  readonly active: number;
  readonly color: string | null;
  readonly group_order: number | null;
  readonly totalArticles?: number;
}

export interface NewKnowledgeBaseGroup {
  readonly name: string;
  readonly group_slug: string | null;
  readonly description: string | null;
  readonly active: number;
  readonly color: string | null;
  readonly group_order: number;
}

export interface KnowledgeBaseGroupPatch {
  readonly name?: string;
  readonly group_slug?: string | null;
  readonly description?: string | null;
  readonly active?: number;
  readonly color?: string | null;
  readonly group_order?: number;
}

export type KnowledgeBaseGroupSortField = 'id' | 'name' | 'groupOrder' | 'group_order' | 'active';

export interface KnowledgeBaseGroupListRequest {
  readonly search: string | null;
  readonly sortField: KnowledgeBaseGroupSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<KnowledgeBaseGroupSortField> | null;
  readonly limit: number;
}

export interface KnowledgeBaseGroupPage extends ListPageMeta {
  readonly items: readonly KnowledgeBaseGroupRow[];
}

export interface KnowledgeBaseGroup {
  readonly id: number;
  readonly name: string;
}

export type KnowledgeBaseGroupId = KnowledgeBaseGroup['id'];

export const KNOWLEDGE_BASE_GROUPS_FACADE_MAX_ROWS = 1000;
