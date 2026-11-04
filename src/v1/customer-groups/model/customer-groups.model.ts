/**
 * Domain entity types of the module; nothing here is a DTO. The entity is one
 * `tblcustomers_groups` row in its STORED form: `id` (`INT UNSIGNED`, assigned by the database)
 * and `name` (`VARCHAR(191)`). `tblcustomer_groups` links a customer to a group; it is owned by
 * perfex-core and this module only counts its rows (read only): deleting a group never touches
 * the links, and a group any customer is still in is refused with 409 `ERP-CUSTOMERGROUPS-0001`.
 */
import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

/** One `tblcustomers_groups` row, stored form. */
export interface CustomerGroupRow {
  /** The table's unsigned integer key; `String(id)` on the wire. */
  readonly id: number;
  readonly name: string;
}

/** What `create` stores: the trimmed name. */
export interface NewCustomerGroup {
  readonly name: string;
}

/** The facade's public shape. */
export interface CustomerGroup {
  readonly id: number;
  readonly name: string;
}

export type CustomerGroupId = CustomerGroup['id'];

/** The columns `?sort=` accepts: keyset keys (NOT NULL, one value per row). */
export type CustomerGroupsSortField = 'id' | 'name';

/** One checked list request: `?q`, the one sort, the cursor decoded for it, the page size. */
export interface CustomerGroupsListRequest {
  readonly search: string | null;
  readonly sortField: CustomerGroupsSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<CustomerGroupsSortField> | null;
  readonly limit: number;
}

/** One keyset page and its pager meta (`shared/http/keyset.ts`). */
export interface CustomerGroupsPage extends ListPageMeta {
  readonly items: readonly CustomerGroupRow[];
}

/**
 * The most rows the facade's `listAll` answers. Above this the read is refused loudly
 * (`ERP-INTERNAL-0001`), never truncated, so a picker never silently misses a group.
 */
export const CUSTOMER_GROUPS_FACADE_MAX_ROWS = 1000;
