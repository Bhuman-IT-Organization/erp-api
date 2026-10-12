/**
 * Domain entity types of the module; nothing here is a DTO. The entity is one `tblcurrencies` row
 * in its STORED form: `id` (`INT`, assigned by the database), `name` (the ISO code, `VARCHAR(100)`;
 * Node writes at most `CURRENCY_CODE_MAX` characters through `@erp/contracts`' one code schema),
 * `symbol` (`VARCHAR(10)`), `decimal_separator` and `thousand_separator` (`VARCHAR(5)`, nullable),
 * `placement` (`VARCHAR(10)`, nullable) and `isdefault` (`TINYINT(1)`, a `Boolean` in the Prisma
 * mirror: the base currency, written only by the make-base switch).
 */
import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

/** One `tblcurrencies` row, stored form. */
export interface CurrencyRow {
  /** The table's integer key; `String(id)` on the wire. */
  readonly id: number;
  /** The ISO code as stored (Perfex calls the column `name`). */
  readonly name: string;
  readonly symbol: string;
  /** `NULL` in the column is `null` here. */
  readonly decimalSeparator: string | null;
  readonly thousandSeparator: string | null;
  readonly placement: string | null;
  /** `isdefault`: the base currency. */
  readonly isBase: boolean;
}

/**
 * What `create` stores, and what `update` rewrites: Perfex's five form fields (D-38), the code
 * already through the shared transform. `isdefault` is never here: only the make-base switch
 * writes it (a create leaves it 0, as Perfex's `add` does).
 */
export interface NewCurrency {
  readonly name: string;
  readonly symbol: string;
  readonly decimalSeparator: string;
  readonly thousandSeparator: string;
  readonly placement: string;
}

/**
 * What refers to a currency and counts for a delete: one count per delete-counting group of
 * `CURRENCY_REFERENCES` (the repository's docblock; D-40, Currencies planning answer 1). Perfex's
 * seven core columns come first (`CORE_USAGE_GROUPS`, the make-base rule's input, D-39).
 */
export interface CurrencyUsage {
  readonly invoices: number;
  readonly expenses: number;
  readonly proposals: number;
  readonly estimates: number;
  readonly customers: number;
  readonly creditNotes: number;
  readonly subscriptions: number;
  readonly purchaseOrders: number;
  readonly purchaseRequests: number;
  readonly purchaseQuotations: number;
  readonly purchaseInvoices: number;
  readonly debitNotes: number;
  readonly fafRequests: number;
  readonly vendors: number;
  readonly goodsReceipts: number;
  readonly goodsDeliveries: number;
  readonly packingLists: number;
  readonly orderReturns: number;
  readonly fixedEquipmentCarts: number;
  readonly payslipsFrom: number;
  readonly payslipsTo: number;
  readonly purchaseConvertedFrom: number;
  readonly purchaseConvertedTo: number;
  readonly fixedEquipmentLocations: number;
}

/**
 * The register groups that never count for a delete but lock a code change (D-40, D-42 widened,
 * answer 2): the exchange rates, their logs and the payslips' code snapshots.
 */
export interface CurrencyLockUsage {
  readonly exchangeRates: number;
  readonly exchangeRateLogs: number;
  readonly payslipCodes: number;
}

/** Both halves of one currency's register counts, as `usageByCurrency` answers them. */
export interface CurrencyReferenceCounts {
  readonly usage: CurrencyUsage;
  readonly lockUsage: CurrencyLockUsage;
}

/** Perfex's seven core columns (`App.php:518-547`): the make-base rule reads only these (D-39). */
export const CORE_USAGE_GROUPS = [
  'invoices',
  'expenses',
  'proposals',
  'estimates',
  'customers',
  'creditNotes',
  'subscriptions',
] as const satisfies readonly (keyof CurrencyUsage)[];

/**
 * The facade's public shape (D-44): what branding and later migrations read. The separators and
 * the placement as stored (`null` for a NULL column); `isBase` a boolean.
 */
export interface Currency {
  readonly id: number;
  readonly name: string;
  readonly symbol: string;
  readonly decimalSeparator: string | null;
  readonly thousandSeparator: string | null;
  readonly placement: string | null;
  readonly isBase: boolean;
}

export type CurrencyId = Currency['id'];

/**
 * The columns `?sort=` accepts: keyset keys (NOT NULL, one value per row). The separators and the
 * placement are nullable, so they are not sorts.
 */
export type CurrenciesSortField = 'name' | 'symbol' | 'id';

/** One checked list request: `?q`, the one sort, the cursor decoded for it, the page size. */
export interface CurrenciesListRequest {
  readonly search: string | null;
  readonly sortField: CurrenciesSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<CurrenciesSortField> | null;
  readonly limit: number;
}

/** One keyset page and its pager meta (`shared/http/keyset.ts`). */
export interface CurrenciesPage extends ListPageMeta {
  readonly items: readonly CurrencyRow[];
}

/**
 * The most rows the facade's `listAll` answers. Perfex installs hold a handful of currencies; above
 * this the read is refused loudly (`ERP-INTERNAL-0001`), never truncated.
 */
export const CURRENCIES_FACADE_MAX_ROWS = 1000;
