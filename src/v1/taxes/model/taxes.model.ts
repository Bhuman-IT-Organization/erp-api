/**
 * Domain entity types of the module; nothing here is a DTO. The entity is one `tbltaxes` row in its
 * STORED form: the table has three columns, `id` (assigned by the database), `name`
 * (`VARCHAR(100)`) and `taxrate` (`DECIMAL(15,2)`), and the rate travels as its two-decimal text
 * (`'5.00'`), never as a float, so the value Perfex wrote is the value Node answers.
 */
import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

/** One `tbltaxes` row, stored form: `taxrate` is the column's two-decimal text. */
export interface TaxRow {
  /** The table's integer key; `String(id)` on the wire. */
  readonly id: number;
  readonly name: string;
  /** Two decimals, as `DECIMAL(15,2)` holds it: `'5.00'`, `'-0.50'`. */
  readonly taxrate: string;
}

/** What `create` stores: the name trimmed, the rate already rounded to two decimals. */
export interface NewTax {
  readonly name: string;
  readonly taxrate: string;
}

/**
 * What refers to a tax, one count per group of `TAX_REFERENCES` (the repository's docblock): a
 * delete must find every group empty (D-07), an edit must find `expenses` and `subscriptions` empty
 * (Perfex's locked modal).
 */
export interface TaxUsage {
  readonly items: number;
  readonly expenses: number;
  readonly subscriptions: number;
  readonly vendorItems: number;
  readonly purchaseLines: number;
  readonly warehouseLines: number;
  readonly fixedEquipmentLines: number;
  readonly salesReturnLines: number;
  readonly accounting: number;
}

/** The facade's public shape: the rate under its wire name. */
export interface Tax {
  readonly id: number;
  readonly name: string;
  /** Two decimals, as stored. */
  readonly rate: string;
}

export type TaxId = Tax['id'];

/**
 * The columns `?sort=` accepts: keyset keys (NOT NULL, one value per row). `rate` reads the column
 * `taxrate`, and its cursor key is the number, so the order is numeric (5.00 before 10.00).
 */
export type TaxesSortField = 'rate' | 'name' | 'id';

/** One checked list request: `?q`, the one sort, the cursor decoded for it, the page size. */
export interface TaxesListRequest {
  readonly search: string | null;
  readonly sortField: TaxesSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<TaxesSortField> | null;
  readonly limit: number;
}

/** One keyset page and its pager meta (`shared/http/keyset.ts`). */
export interface TaxesPage extends ListPageMeta {
  readonly items: readonly TaxRow[];
}

/**
 * The most rows the facade's `listAll` answers. Perfex installs hold a handful of taxes; above this
 * the read is refused loudly (`ERP-INTERNAL-0001`), never truncated, so a picker never silently
 * misses a tax.
 */
export const TAXES_FACADE_MAX_ROWS = 1000;
