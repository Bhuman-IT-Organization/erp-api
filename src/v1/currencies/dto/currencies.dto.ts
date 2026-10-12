/**
 * Request and response DTOs. Types are `z.infer` of the schemas. Every field is written inline
 * (`name: z.string()...`), so each one can be compared field by field with the frontend template's
 * schemas.
 *
 * The list response is BE-19's envelope on the superset meta: `{ data, meta: { nextCursor,
 * prevCursor, total, rangeStart, exportLimit, printLimit } }`. A single resource is a bare body; the
 * request id is never in a body (it travels in the `x-request-id` header). The id is a STRING on the
 * wire; the transformer writes `String(row.id)`.
 *
 * Node keeps Perfex's business outcomes (D-38, D-29): the five fields of Perfex's form
 * (`views/admin/currencies/manage.php`). The code (`name`, Perfex's column name) goes through the
 * ONE code schema in `@erp/contracts` (`currency-code.ts`, Currencies planning answer 7): trimmed,
 * then upper-cased as PHP 8's `strtoupper` does (a to z only), 1 to `CURRENCY_CODE_MAX` characters;
 * the limit is never restated here. A code another currency holds is accepted (Perfex has no
 * uniqueness check). The symbol is 1 to `CURRENCIES_SYMBOL_MAX` characters holding a non-space
 * character, stored as sent; the separators and the placement are one of the options Perfex's form
 * offers. The body is strict: any other key is a 400 naming it, `isBase`, `isdefault` and `id`
 * among them: only `PATCH :id/base` makes a currency the base (D-39).
 */
import { CURRENCY_CODE_MAX, currencyCodeProblem, toCurrencyCode } from '@erp/contracts';
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

/** The longest symbol a body may carry: Perfex's `VARCHAR(10)` column (the int spec reads it). */
export const CURRENCIES_SYMBOL_MAX = 10;
/** The longest `?q=`; a longer one is a 400 on `q`. */
export const CURRENCIES_SEARCH_MAX = 100;

/** Perfex's decimal separator options (`manage.php`'s select). */
export const DECIMAL_SEPARATORS = [',', '.'] as const;
/** Perfex's thousand separator options: comma, dot, apostrophe, none and a space. */
export const THOUSAND_SEPARATORS = [',', '.', "'", '', ' '] as const;
/** Perfex's symbol placement options. */
export const PLACEMENTS = ['before', 'after'] as const;

/** The code problem's words in a 400 issue: the limit read from the shared schema. */
const CODE_MESSAGES = {
  required: 'required',
  too_long: `at most ${String(CURRENCY_CODE_MAX)} characters`,
} as const;

/**
 * `GET /api/v1/currencies?limit&cursor&q&sort`: the documented surface. `parseListQuery` in the
 * validator enforces it (the BE-19 grammar, one keyset sort, the cursor bound to that sort).
 */
export const listCurrenciesQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  /** The previous page's opaque `meta.nextCursor` or `meta.prevCursor`, sent with the same `sort`. */
  cursor: z.string().min(1).optional(),
  /**
   * Search: the code or the symbol contains `q` (case per the columns' collation); when `q` is all
   * digits and fits the INT id column, also the id equal to it.
   */
  q: z.string().max(CURRENCIES_SEARCH_MAX).optional(),
  /** `-name` (default, Perfex's `[[0, 'desc']]`), `name`, `symbol`, `-symbol`, `id` or `-id`. */
  sort: z.string().optional(),
});

/**
 * `GET export`: the list query minus `limit` and `cursor` (an export is every row), plus the export
 * parameters of ADR-0043 as literal keys. Documentation only: `parseExportOptions` in
 * `shared/http/export.ts` is the gate. No `key`: the list has no row selection.
 */
export const exportCurrenciesQuerySchema = listCurrenciesQuerySchema
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
export const currenciesParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * Perfex's five form fields, strict: `isBase`, `isdefault`, `id`, `usage` or any other key is a 400
 * naming the key. `name` arrives as typed and leaves as the stored code (the shared transform).
 */
export const currenciesBodySchema = z.strictObject({
  name: z
    .string()
    .transform(toCurrencyCode)
    .superRefine((code, context) => {
      const problem = currencyCodeProblem(code);
      if (problem !== null) context.addIssue({ code: 'custom', message: CODE_MESSAGES[problem] });
    }),
  symbol: z
    .string()
    .min(1)
    .max(CURRENCIES_SYMBOL_MAX)
    .refine((symbol) => symbol.trim() !== '', { message: 'the symbol needs a character' }),
  decimalSeparator: z.enum(DECIMAL_SEPARATORS),
  thousandSeparator: z.enum(THOUSAND_SEPARATORS),
  placement: z.enum(PLACEMENTS),
});

/** `POST`: the five fields. */
export const createCurrenciesBodySchema = currenciesBodySchema;

/** `PATCH :id`: the same body, all five rewritten as Perfex's edit does; `{}` is a 400. */
export const updateCurrenciesBodySchema = currenciesBodySchema;

/** `PATCH :id/base`: no field; any key is a 400. */
export const currenciesBaseBodySchema = z.strictObject({});

const count = () => z.number().int().nonnegative();

/** What refers to the currency and counts for a delete, per group (the repository's register). */
export const currencyUsageSchema = z.object({
  invoices: count(),
  expenses: count(),
  proposals: count(),
  estimates: count(),
  customers: count(),
  creditNotes: count(),
  subscriptions: count(),
  purchaseOrders: count(),
  purchaseRequests: count(),
  purchaseQuotations: count(),
  purchaseInvoices: count(),
  debitNotes: count(),
  fafRequests: count(),
  vendors: count(),
  goodsReceipts: count(),
  goodsDeliveries: count(),
  packingLists: count(),
  orderReturns: count(),
  fixedEquipmentCarts: count(),
  payslipsFrom: count(),
  payslipsTo: count(),
  purchaseConvertedFrom: count(),
  purchaseConvertedTo: count(),
  fixedEquipmentLocations: count(),
});

/** The register groups that never block a delete but lock a code change (D-42 widened). */
export const currencyLockUsageSchema = z.object({
  exchangeRates: count(),
  exchangeRateLogs: count(),
  payslipCodes: count(),
});

/**
 * One currency: the code, the symbol, the separators and the placement as stored, whether it is the
 * base, what uses it (`usage` counts for a delete, `lockUsage` only locks the code), what other
 * modules registered (`registeredUsage`, keyed by the counter's key; none today) and whether
 * it can be made the base now (`canMakeBase`, Perfex's rule, D-39).
 */
export const currenciesResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    symbol: z.string(),
    decimalSeparator: z.string().nullable(),
    thousandSeparator: z.string().nullable(),
    placement: z.string().nullable(),
    isBase: z.boolean(),
    usage: currencyUsageSchema,
    lockUsage: currencyLockUsageSchema,
    registeredUsage: z.record(z.string(), count()),
    canMakeBase: z.boolean(),
  })
  .readonly();

/** One list row: the same shape as the record (the screen needs every count for its dialogs). */
export const currenciesListRowSchema = currenciesResponseSchema;

export const currenciesListResponseSchema = z
  .object({
    data: z.array(currenciesListRowSchema),
    /** The pager's meta, `exportLimit` (CSV and Excel, `EXPORT_MAX_ROWS`) and `printLimit` (PDF and print, `PRINT_MAX_ROWS`). */
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

/** `PATCH :id/base`'s answer: the id as text and the flag now stored. */
export const currenciesBaseResponseSchema = z
  .object({ id: z.string(), isBase: z.literal(true) })
  .readonly();

export type ListCurrenciesQuery = z.infer<typeof listCurrenciesQuerySchema>;
export type CurrenciesParams = z.infer<typeof currenciesParamsSchema>;
export type CurrenciesBody = z.infer<typeof currenciesBodySchema>;
export type CreateCurrenciesBody = z.infer<typeof createCurrenciesBodySchema>;
export type UpdateCurrenciesBody = z.infer<typeof updateCurrenciesBodySchema>;
export type CurrenciesBaseBody = z.infer<typeof currenciesBaseBodySchema>;
export type CurrencyUsageDto = z.infer<typeof currencyUsageSchema>;
export type CurrencyLockUsageDto = z.infer<typeof currencyLockUsageSchema>;
export type CurrenciesResponseDto = z.infer<typeof currenciesResponseSchema>;
export type CurrenciesListRowDto = z.infer<typeof currenciesListRowSchema>;
export type CurrenciesListResponseDto = z.infer<typeof currenciesListResponseSchema>;
export type CurrenciesBaseResponseDto = z.infer<typeof currenciesBaseResponseSchema>;
