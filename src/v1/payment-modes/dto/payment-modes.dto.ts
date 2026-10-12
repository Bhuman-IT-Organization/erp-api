/**
 * Request and response DTOs. Types are `z.infer` of the schemas. Every field is written inline
 * (`name: z.string()...`), so each one can be compared field by field with the frontend template's
 * schemas.
 *
 * The list response is BE-19's envelope on the superset meta: `{ data, meta: { nextCursor,
 * prevCursor, total, rangeStart, exportLimit, printLimit } }`. A single resource is a bare body; the
 * request id is never in a body (it travels in the `x-request-id` header).
 *
 * The id is a STRING on the wire: the web treats it as opaque (row keys and routes use it
 * verbatim). The table's key is an integer, so `shared/http/keyset.ts`'s `[value, id]` cursor
 * applies; the transformer writes `String(row.id)`.
 *
 * Node keeps Perfex's business outcomes (D-34, D-29): the seven fields of Perfex's form
 * (`views/admin/paymentmodes/paymentmode.php`); the name required, trimmed (a recorded
 * simplification: Perfex saved it untrimmed), 1 to `PAYMENT_MODES_NAME_MAX` characters (the
 * `VARCHAR(100)` column), every character accepted and stored as text (`<` and `>` included), and a
 * name another mode holds accepted (Perfex has no uniqueness check); the description any text, no
 * cap beyond the 1 MiB Fastify body; each box optional, an absent box saving 0 as Perfex's
 * `Payment_modes_model.php` :100-102 and :143-145 do. Both "only" boxes together are accepted:
 * Perfex's server accepts them, only its form disables one when the other is ticked (D-29). The
 * body is strict: any other key is a 400 naming it, Perfex's show-to-client flag among them (D-35).
 */
import { z } from 'zod';
import {
  exportBlankField,
  exportColumnField,
  exportDateFormatField,
  exportFormatField,
  exportHeaderField,
  exportNoField,
  exportTimeFormatField,
  exportTimeZoneField,
  exportTitleField,
  exportYesField,
} from '../../../shared/http/export.js';
import { listPageMetaSchema } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';

/** The longest name a body may carry: Perfex's `VARCHAR(100)` column (the int spec reads it). */
export const PAYMENT_MODES_NAME_MAX = 100;
/** The longest `?q=`; a longer one is a 400 on `q`. */
export const PAYMENT_MODES_SEARCH_MAX = 100;

/**
 * `GET /api/v1/payment-modes?limit&cursor&q&sort`: the documented surface. `parseListQuery` in the
 * validator enforces it (the BE-19 grammar, one keyset sort, the cursor bound to that sort).
 */
export const listPaymentModesQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  /** The previous page's opaque `meta.nextCursor` or `meta.prevCursor`, sent with the same `sort`. */
  cursor: z.string().min(1).optional(),
  /**
   * Search: the name or the description contains `q` (case per the columns' collation); when `q`
   * is all digits and fits the INT id column, also the id equal to it.
   */
  q: z.string().max(PAYMENT_MODES_SEARCH_MAX).optional(),
  /** `name` (default, Perfex's order), `-name`, `id`, `-id`, `active` or `-active`. */
  sort: z.string().optional(),
});

/**
 * `GET export`: the list query minus `limit` and `cursor` (an export is every row), plus the export
 * parameters of ADR-0043 as literal keys. Documentation only: `parseExportOptions` in
 * `shared/http/export.ts` is the gate. No `key`: the list has no row selection.
 */
export const exportPaymentModesQuerySchema = listPaymentModesQuerySchema
  .omit({ limit: true, cursor: true })
  .extend({
    header: exportHeaderField,
    format: exportFormatField,
    column: exportColumnField,
    title: exportTitleField,
    yes: exportYesField,
    no: exportNoField,
    blank: exportBlankField,
    dateFormat: exportDateFormatField,
    timeFormat: exportTimeFormatField,
    timeZone: exportTimeZoneField,
  });

/** `:id` of the record routes: a non-numeric or non-positive id is a 400, never a 404 probe. */
export const paymentModesParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * The seven fields of Perfex's form, strict: `id`, `usage`, the show-to-client flag or any other key is a 400
 * naming the key. The description arrives as the user typed it; the transformer stores it as
 * Perfex's `nl2br_save_html` does.
 */
export const paymentModesBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(PAYMENT_MODES_NAME_MAX),
  description: z.string().optional(),
  active: z.boolean().optional(),
  showOnPdf: z.boolean().optional(),
  selectedByDefault: z.boolean().optional(),
  invoicesOnly: z.boolean().optional(),
  expensesOnly: z.boolean().optional(),
});

/** `POST`: the seven fields; an absent description saves `''`, an absent box 0. */
export const createPaymentModesBodySchema = paymentModesBodySchema;

/** `PATCH :id`: the same body, all seven rewritten as Perfex's edit does; `{}` is a 400 on `['name']`. */
export const updatePaymentModesBodySchema = paymentModesBodySchema;

/** `PATCH :id/active`: the list's one-click switch (D-34); only the flag, strict. */
export const paymentModesActiveBodySchema = z.strictObject({ active: z.boolean() });

/** What refers to the payment mode, per group (the repository's `PAYMENT_MODE_REFERENCES`); never exported. */
export const paymentModeUsageSchema = z.object({
  invoicePayments: z.number().int().nonnegative(),
  expenses: z.number().int().nonnegative(),
  creditNoteRefunds: z.number().int().nonnegative(),
  purchaseInvoicePayments: z.number().int().nonnegative(),
  purchaseOrderPayments: z.number().int().nonnegative(),
  debitNoteRefunds: z.number().int().nonnegative(),
  fixedEquipmentRefunds: z.number().int().nonnegative(),
  orderReturnRefunds: z.number().int().nonnegative(),
});

/**
 * One payment mode: the name as stored, the description in its read form (Perfex's
 * `clear_textarea_breaks`), the five boxes as booleans, what uses it (the screen's delete dialog
 * reads it) and whether Perfex's `expense_credit_payment_mode` names it (D-37: its delete is
 * refused). The option's value itself is never answered.
 */
export const paymentModesResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    active: z.boolean(),
    showOnPdf: z.boolean(),
    selectedByDefault: z.boolean(),
    invoicesOnly: z.boolean(),
    expensesOnly: z.boolean(),
    usage: paymentModeUsageSchema,
    isCreditExpenseMode: z.boolean(),
  })
  .readonly();

/** One list row: the same shape as the record (the screen needs the usage and the lock for the delete). */
export const paymentModesListRowSchema = paymentModesResponseSchema;

export const paymentModesListResponseSchema = z
  .object({
    data: z.array(paymentModesListRowSchema),
    /** The pager's meta, `exportLimit` (CSV and Excel, `EXPORT_MAX_ROWS`) and `printLimit` (PDF and print, `PRINT_MAX_ROWS`). */
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

/** `PATCH :id/active`'s answer: the id as text and the flag now stored. */
export const paymentModesActiveResponseSchema = z
  .object({ id: z.string(), active: z.boolean() })
  .readonly();

export type ListPaymentModesQuery = z.infer<typeof listPaymentModesQuerySchema>;
export type PaymentModesParams = z.infer<typeof paymentModesParamsSchema>;
export type PaymentModesBody = z.infer<typeof paymentModesBodySchema>;
export type CreatePaymentModesBody = z.infer<typeof createPaymentModesBodySchema>;
export type UpdatePaymentModesBody = z.infer<typeof updatePaymentModesBodySchema>;
export type PaymentModesActiveBody = z.infer<typeof paymentModesActiveBodySchema>;
export type PaymentModeUsageDto = z.infer<typeof paymentModeUsageSchema>;
export type PaymentModesResponseDto = z.infer<typeof paymentModesResponseSchema>;
export type PaymentModesListRowDto = z.infer<typeof paymentModesListRowSchema>;
export type PaymentModesListResponseDto = z.infer<typeof paymentModesListResponseSchema>;
export type PaymentModesActiveResponseDto = z.infer<typeof paymentModesActiveResponseSchema>;
