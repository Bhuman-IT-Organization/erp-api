/**
 * Domain entity types of the module; nothing here is a DTO. The entity is one `tblexpenses_categories`
 * row in its STORED form: `description` is what Perfex's `nl2br` wrote (a `<br />` before each line
 * break), so Perfex keeps reading the rows Node writes; the transformer reads it back in Perfex's
 * `clear_textarea_breaks` form (brief section 9). The table has three columns: `id` (assigned by the
 * database), `name` (`VARCHAR(191)`) and `description` (`MEDIUMTEXT`, nullable).
 */
import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

export interface ExpenseCategory {
  /** The table's integer key; `String(id)` on the wire. */
  readonly id: number;
  readonly name: string;
  /** Stored form (`nl2br`); `null` on a row Perfex wrote without one. */
  readonly description: string | null;
}

export type ExpenseCategoryId = ExpenseCategory['id'];

/**
 * What refers to a category: the three sources a delete must find empty (D-07, D-15). Perfex's own
 * delete checks `tblexpenses.category`; accounting maps categories in
 * `tblacc_expense_category_mappings.category_id`; purchase's petty cash advances carry
 * `tblpur_petty_cash_advances.expense_category` wherever that table exists.
 */
export interface ExpenseCategoryUsage {
  readonly expenses: number;
  readonly accountingMappings: number;
  readonly pettyCashAdvances: number;
}

/** The columns `?sort=` accepts: keyset keys (NOT NULL, one value per row). */
export type ExpenseCategoriesSortField = 'name' | 'id';

/** One checked list request: `?q`, the one sort, the cursor decoded for it, the page size. */
export interface ExpenseCategoriesListRequest {
  readonly search: string | null;
  readonly sortField: ExpenseCategoriesSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<ExpenseCategoriesSortField> | null;
  readonly limit: number;
}

/** One keyset page and its pager meta (`shared/http/keyset.ts`). */
export interface ExpenseCategoriesPage extends ListPageMeta {
  readonly items: readonly ExpenseCategory[];
}

/** What `create` stores, in the stored form; the database assigns the id. */
export interface NewExpenseCategory {
  readonly name: string;
  readonly description: string;
}
