/**
 * Domain entity types of the module; nothing here is a DTO. The entity is one `tblcontracts_types`
 * row in its STORED form: `id` (`INT`, assigned by the database) and `name` (`LongText`).
 */
import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

/** One `tblcontracts_types` row, stored form. */
export interface ContractTypeRow {
  /** The table's unsigned integer key; `String(id)` on the wire. */
  readonly id: number;
  readonly name: string;
}

/** What `create` stores: the trimmed name. */
export interface NewContractType {
  readonly name: string;
}

/**
 * What refers to a contract type: contracts (tblcontracts.contract_type), goals (tblgoals.contract_type).
 */
export interface ContractTypeUsage {
  readonly contracts: number;
  readonly goals: number;
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
