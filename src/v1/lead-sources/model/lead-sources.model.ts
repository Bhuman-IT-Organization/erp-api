/**
 * Domain entity types of the module; nothing here is a DTO. The entity is one `tblleads_sources` row
 * in its STORED form: `id` (`INT UNSIGNED`, assigned by the database) and `name` (`VARCHAR(150)`).
 */
import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

/** One `tblleads_sources` row, stored form. */
export interface LeadSourceRow {
  /** The table's unsigned integer key; `String(id)` on the wire. */
  readonly id: number;
  readonly name: string;
}

/** What `create` stores: the trimmed name. */
export interface NewLeadSource {
  readonly name: string;
}

/**
 * What refers to a lead source, one count per group of `LEAD_SOURCE_REFERENCES`:
 * a delete must find every group empty (D-07, D-28).
 */
export interface LeadSourceUsage {
  readonly leads: number;
}

/** The facade's public shape: what the leads module migrations read. */
export interface LeadSource {
  readonly id: number;
  readonly name: string;
}

export type LeadSourceId = LeadSource['id'];

/**
 * The columns `?sort=` accepts: keyset keys (NOT NULL, one value per row).
 */
export type LeadSourcesSortField = 'id' | 'name';

/** One checked list request: `?q`, the one sort, the cursor decoded for it, the page size. */
export interface LeadSourcesListRequest {
  readonly search: string | null;
  readonly sortField: LeadSourcesSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<LeadSourcesSortField> | null;
  readonly limit: number;
}

/** One keyset page and its pager meta (`shared/http/keyset.ts`). */
export interface LeadSourcesPage extends ListPageMeta {
  readonly items: readonly LeadSourceRow[];
}

/**
 * The most rows the facade's `listAll` answers. Perfex installs hold a handful of lead sources;
 * above this the read is refused loudly (`ERP-INTERNAL-0001`), never truncated.
 */
export const LEAD_SOURCES_FACADE_MAX_ROWS = 1000;
