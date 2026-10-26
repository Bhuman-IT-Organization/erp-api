/**
 * Domain entity types of the module; nothing here is a DTO. The entity is one `tblcontract_types`
 * row in its STORED form: `id` (`INT UNSIGNED`, assigned by the database), `name` (`VARCHAR(255)`),
 * `created_by` (`INT`, nullable: the staff id that created it) and `datecreated` (`DATETIME`,
 * nullable). `datecreated` is a NAIVE wall clock: Perfex writes PHP's `date('Y-m-d H:i:s')` in the
 * zone of its `default_timezone` setting, and Node writes the same (D-31). Prisma reads and writes a
 * `DATETIME` as UTC, so the `Date` held here carries the wall-clock fields in its UTC fields; the
 * transformer turns it into an instant with the company zone.
 */
import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

/** One `tblcontract_types` row, stored form. */
export interface ContractTypeRow {
  /** The table's unsigned integer key; `String(id)` on the wire. */
  readonly id: number;
  readonly name: string;
  /** `created_by`: the staff id that created the row (Perfex's and Node's create), `null` when unset. */
  readonly createdBy: number | null;
  /** `datecreated`: the naive wall clock, its UTC fields ARE the wall-clock fields; `null` when unset. */
  readonly datecreated: Date | null;
}

/** What `create` stores (D-31): the trimmed name, the signed-in staff id and the packed wall clock. */
export interface NewContractType {
  readonly name: string;
  readonly createdBy: number;
  readonly datecreated: Date;
}

/**
 * What refers to a contract type, one count per group of `CONTRACT_TYPE_REFERENCES` (the
 * repository's docblock): a delete must find every group empty (D-07, D-28).
 */
export interface ContractTypeUsage {
  readonly purchaseRequests: number;
  readonly purchaseOrders: number;
  readonly purchaseQuotations: number;
  readonly shippingCharges: number;
  readonly expenses: number;
  readonly assets: number;
}

/** The facade's public shape. */
export interface ContractType {
  readonly id: number;
  readonly name: string;
}

export type ContractTypeId = ContractType['id'];

/**
 * The columns `?sort=` accepts: keyset keys (NOT NULL, one value per row). `datecreated` is
 * nullable, so it is not a sort; ids rise with creation, so `id` descending is Perfex's creation order.
 */
export type ContractTypesSortField = 'id' | 'name';

/** One checked list request: `?q`, the one sort, the cursor decoded for it, the page size. */
export interface ContractTypesListRequest {
  readonly search: string | null;
  readonly sortField: ContractTypesSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<ContractTypesSortField> | null;
  readonly limit: number;
}

/** One keyset page and its pager meta (`shared/http/keyset.ts`). */
export interface ContractTypesPage extends ListPageMeta {
  readonly items: readonly ContractTypeRow[];
}

/**
 * The most rows the facade's `listAll` answers. Above this the read is refused loudly
 * (`ERP-INTERNAL-0001`), never truncated, so a picker never silently misses one.
 */
export const CONTRACT_TYPES_FACADE_MAX_ROWS = 1000;
