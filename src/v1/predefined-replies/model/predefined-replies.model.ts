import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

export interface PredefinedReply {
  readonly id: number;
  readonly name: string;
  readonly message: string;
}

export type PredefinedReplyId = PredefinedReply['id'];
export type PredefinedRepliesSortField = 'name' | 'id';

export interface PredefinedRepliesListRequest {
  readonly search: string | null;
  readonly sortField: PredefinedRepliesSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<PredefinedRepliesSortField> | null;
  readonly limit: number;
}

export interface PredefinedRepliesPage extends ListPageMeta {
  readonly items: readonly PredefinedReply[];
}

export interface NewPredefinedReply {
  readonly name: string;
  readonly message: string;
}

export interface UpdatePredefinedReply {
  readonly name: string;
  readonly message: string;
}
