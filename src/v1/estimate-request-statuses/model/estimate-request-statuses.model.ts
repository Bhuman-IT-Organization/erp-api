import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

export const ESTIMATE_REQUEST_STATUS_ID_MAX = 4_294_967_295;

export interface EstimateRequestStatusRow {
  readonly id: number;
  readonly name: string;
  readonly color: string | null;
  readonly statusorder: number | null;
  readonly flag: string | null;
  readonly total_request: number;
}

export interface NewEstimateRequestStatus {
  readonly name: string;
  readonly color: string | null;
  readonly statusorder: number | null;
}

export type EstimateRequestStatusPatch = Partial<NewEstimateRequestStatus>;
export type EstimateRequestStatusSortField = 'id' | 'name';

export interface EstimateRequestStatusesListRequest {
  readonly search: string | null;
  readonly sortField: EstimateRequestStatusSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<EstimateRequestStatusSortField> | null;
  readonly limit: number;
}

export interface EstimateRequestStatusesPage extends ListPageMeta {
  readonly items: readonly EstimateRequestStatusRow[];
}
