/**
 * Domain entity types of the module; nothing here is a DTO. The entity is one `tblpayment_modes`
 * row in its STORED form: `id` (`INT`, assigned by the database), `name` (`VARCHAR(100)`),
 * `description` (`MEDIUMTEXT`, nullable, stored as Perfex's `nl2br_save_html` writes it), the four
 * `INT` flags `show_on_pdf`, `selected_by_default`, `invoices_only` and `expenses_only` (Perfex reads
 * each as `== 1`, so they are kept raw here and turned into booleans by the transformer), and
 * `active` (`TINYINT(1)`, a `Boolean` in the Prisma mirror). No show-to-client column exists (D-35).
 */
import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

/** One `tblpayment_modes` row, stored form; the INT flags raw. */
export interface PaymentModeRow {
  /** The table's integer key; `String(id)` on the wire. */
  readonly id: number;
  readonly name: string;
  /** The stored form (`nl2br_save_html`), `null` when the column is NULL. */
  readonly description: string | null;
  readonly active: boolean;
  readonly showOnPdf: number;
  readonly selectedByDefault: number;
  readonly invoicesOnly: number;
  readonly expensesOnly: number;
}

/**
 * What `create` stores, and what `update` rewrites: all seven of Perfex's fields (D-34), the
 * description already in its stored form and each box 0 or 1 (an absent box saves 0).
 */
export interface NewPaymentMode {
  readonly name: string;
  readonly description: string;
  readonly active: boolean;
  readonly showOnPdf: 0 | 1;
  readonly selectedByDefault: 0 | 1;
  readonly invoicesOnly: 0 | 1;
  readonly expensesOnly: 0 | 1;
}

/**
 * What refers to a payment mode, one count per group of `PAYMENT_MODE_REFERENCES` (the repository's
 * docblock): a delete must find every group empty (D-33). Configuration (the accounting mappings and
 * the allowed lists) is never counted.
 */
export interface PaymentModeUsage {
  readonly invoicePayments: number;
  readonly expenses: number;
  readonly creditNoteRefunds: number;
  readonly purchaseInvoicePayments: number;
  readonly purchaseOrderPayments: number;
  readonly debitNoteRefunds: number;
  readonly fixedEquipmentRefunds: number;
  readonly orderReturnRefunds: number;
}

/**
 * The facade's public shape: what the invoices and payments, expenses and purchase migrations read
 * for a picker or a document. Every flag a boolean; never the description; online gateways are not
 * merged in (the caller merges its own, as Perfex's `get()` does).
 */
export interface PaymentMode {
  readonly id: number;
  readonly name: string;
  readonly active: boolean;
  readonly invoicesOnly: boolean;
  readonly expensesOnly: boolean;
  readonly selectedByDefault: boolean;
  readonly showOnPdf: boolean;
}

export type PaymentModeId = PaymentMode['id'];

/**
 * The columns `?sort=` accepts: keyset keys (NOT NULL, one value per row). The description is
 * nullable MEDIUMTEXT, so it is not a sort; `active` is a NOT NULL boolean.
 */
export type PaymentModesSortField = 'name' | 'id' | 'active';

/** One checked list request: `?q`, the one sort, the cursor decoded for it, the page size. */
export interface PaymentModesListRequest {
  readonly search: string | null;
  readonly sortField: PaymentModesSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<PaymentModesSortField> | null;
  readonly limit: number;
}

/** One keyset page and its pager meta (`shared/http/keyset.ts`). */
export interface PaymentModesPage extends ListPageMeta {
  readonly items: readonly PaymentModeRow[];
}

/**
 * The most rows the facade's `listAll` answers. Perfex installs hold a handful of payment modes;
 * above this the read is refused loudly (`ERP-INTERNAL-0001`), never truncated, so a picker never
 * silently misses one.
 */
export const PAYMENT_MODES_FACADE_MAX_ROWS = 1000;
