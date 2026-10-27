import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

/** One tblleads_status record in its stored form. */
export interface LeadStatusRow {
  readonly id: number;
  readonly name: string;
  readonly statusorder: number | null;
  readonly color: string | null;
  readonly isdefault: number;
}

/** Data used to create a new lead status. */
export interface NewLeadStatus {
  readonly name: string;
  readonly statusorder: number | null;
  readonly color: string | null;
  readonly isdefault: 0;
}

/** References that can prevent status deletion. */
export interface LeadStatusUsage {
  readonly leads: number;
  readonly lastLeadStatus: number;
  readonly emailIntegration: number;
  readonly webToLead: number;
}

/** Public entity exposed by LeadStatusesFacade. */
export interface LeadStatus {
  readonly id: number;
  readonly name: string;
  readonly statusorder: number | null;
  readonly color: string | null;
  readonly isdefault: number;
}

export type LeadStatusId = LeadStatus['id'];

/** Supported non-nullable sort fields. */
export type LeadStatusesSortField = 'id' | 'name';

/** Validated list request. */
export interface LeadStatusesListRequest {
  readonly search: string | null;
  readonly sortField: LeadStatusesSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<LeadStatusesSortField> | null;
  readonly limit: number;
}

/** Paginated database result. */
export interface LeadStatusesPage extends ListPageMeta {
  readonly items: readonly LeadStatusRow[];
}

/** Maximum number of records returned by the facade. */
export const LEAD_STATUSES_FACADE_MAX_ROWS = 1000;
