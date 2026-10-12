/**
 * Domain entity types of the module; nothing here is a DTO. `internalRef` and `ownerStaffId` are
 * the fields a transformer must never let through: they exist so the transformer spec can prove
 * that the response schema strips what the wire shape does not name (T-2-14). `ownerStaffId` is
 * also the owning column the `own` row scope filters on (ADR-0033 decision 5).
 */
import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

export interface ExampleItem {
  /** The store's integer key; `String(id)` on the wire. */
  readonly id: number;
  readonly name: string;
  /** ISO timestamp. */
  readonly createdAt: string;
  /** Internal bookkeeping; never reaches a DTO. */
  readonly internalRef: string;
  /** The member who created the row; never reaches a DTO. */
  readonly ownerStaffId: number;
}

export type ExampleItemId = ExampleItem['id'];

/** The entity plus the computed fields the enricher adds: `label` is `${name} (${id})`. */
export interface EnrichedExampleItem extends ExampleItem {
  readonly label: string;
}

/** The columns `?sort=` accepts: keyset keys (NOT NULL, one value per row). */
export type ExampleItemSortField = 'id' | 'name';

/**
 * One checked list request: `?q`, the one sort, the cursor decoded for it, the page size, and an
 * export's ticked row keys as `ids` (absent = no key filter; they only narrow, D-03).
 */
export interface ExampleItemListRequest {
  readonly search: string | null;
  readonly sortField: ExampleItemSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<ExampleItemSortField> | null;
  readonly limit: number;
  readonly ids?: readonly number[];
}

/** One keyset page and its pager meta (`shared/http/keyset.ts`). */
export interface ExampleItemPage extends ListPageMeta {
  readonly items: readonly ExampleItem[];
}

/** What `create` stores; the repository assigns the id. */
export interface NewExampleItem {
  readonly name: string;
  readonly ownerStaffId: number;
  readonly createdAt: string;
  readonly internalRef: string;
}
