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
 * Node accepts exactly what Perfex accepts, made safe as D-19 does. The name is required, trimmed,
 * at most `TAXES_NAME_MAX` characters (the `VARCHAR(100)` column), and `<` and `>` are accepted and
 * rendered as text; `|` is refused, because it is the separator of Perfex's `name|rate` strings
 * (Perfex's own screen strips it, `views/admin/taxes/manage.php:89-99`). The rate is a decimal
 * STRING (a JSON number is a 400), rounded half away from zero to two places by the service, with
 * at most `TAXES_RATE_INTEGER_DIGITS` integer digits (the `DECIMAL(15,2)` column).
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

/** The longest name a body may carry: Perfex's `VARCHAR(100)` column. */
export const TAXES_NAME_MAX = 100;
/** The longest `?q=`; a longer one is a 400 on `q`. */
export const TAXES_SEARCH_MAX = 100;
/** The most integer digits a rate may have after rounding: `DECIMAL(15,2)` keeps 13. */
export const TAXES_RATE_INTEGER_DIGITS = 13;

/**
 * A decimal number as text: an optional minus, then digits with an optional fraction, or a bare
 * fraction (`.5`). No exponent, no thousands separator, no plus sign. The transformer re-exports it
 * beside `roundRate`; it lives here so the DTO and the transformer share one definition without an
 * import cycle.
 */
export const RATE_PATTERN = /^-?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** The character Perfex joins a tax's name and rate with (`default_tax`, item taxes). */
const NAME_RATE_SEPARATOR = '|';

/**
 * `GET /api/v1/taxes?limit&cursor&q&sort`: the documented surface. `parseListQuery` in the
 * validator enforces it (the BE-19 grammar, one keyset sort, the cursor bound to that sort).
 */
export const listTaxesQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  /** The previous page's opaque `meta.nextCursor` or `meta.prevCursor`, sent with the same `sort`. */
  cursor: z.string().min(1).optional(),
  /**
   * Search: the name contains `q` (case per the column's collation); when `q` is all digits, also
   * the id equal to it; when `q` is a rate, also the rate equal to it rounded to two places.
   */
  q: z.string().max(TAXES_SEARCH_MAX).optional(),
  /** `rate` (default, Perfex's order), `name` or `id`; a leading `-` is descending. */
  sort: z.string().optional(),
});

/**
 * `GET export`: the list query minus `limit` and `cursor` (an export is every row), plus the export
 * parameters of ADR-0043 as literal keys. Documentation only: `parseExportOptions` in
 * `shared/http/export.ts` is the gate. No `key`: the list has no row selection (D-27).
 */
export const exportTaxesQuerySchema = listTaxesQuerySchema
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
export const taxesParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/** `POST`: strict, so `id`, `usage` or `isDefault` is a 400 naming the key. */
export const createTaxesBodySchema = z.strictObject({
  name: z
    .string()
    .trim()
    .min(1)
    .max(TAXES_NAME_MAX)
    .refine((name) => !name.includes(NAME_RATE_SEPARATOR), 'the name may not contain |'),
  rate: z.string().trim().regex(RATE_PATTERN, 'the rate is not a number'),
});

/** `PATCH :id`: any part of the create body; the validator refuses `{}`. */
export const updateTaxesBodySchema = createTaxesBodySchema.partial();

/** What refers to the tax, per group (the repository's `TAX_REFERENCES`); never exported. */
export const taxUsageSchema = z.object({
  items: z.number().int().nonnegative(),
  expenses: z.number().int().nonnegative(),
  subscriptions: z.number().int().nonnegative(),
  vendorItems: z.number().int().nonnegative(),
  purchaseLines: z.number().int().nonnegative(),
  warehouseLines: z.number().int().nonnegative(),
  fixedEquipmentLines: z.number().int().nonnegative(),
  salesReturnLines: z.number().int().nonnegative(),
  accounting: z.number().int().nonnegative(),
});

/**
 * One tax: the rate as its two-decimal text, what uses it (the screen's delete dialog and edit lock
 * read it) and whether Perfex's `default_tax` setting names it (D-21: the form opens it read-only).
 * The setting's own text never reaches the wire.
 */
export const taxesResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    rate: z.string(),
    usage: taxUsageSchema,
    isDefault: z.boolean(),
  })
  .readonly();

/** One list row: the same shape as the record (the screen needs the usage either way). */
export const taxesListRowSchema = taxesResponseSchema;

export const taxesListResponseSchema = z
  .object({
    data: z.array(taxesListRowSchema),
    /** The pager's meta, `exportLimit` (CSV and Excel, `EXPORT_MAX_ROWS`) and `printLimit` (PDF and print, `PRINT_MAX_ROWS`). */
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type ListTaxesQuery = z.infer<typeof listTaxesQuerySchema>;
export type TaxesParams = z.infer<typeof taxesParamsSchema>;
export type CreateTaxesBody = z.infer<typeof createTaxesBodySchema>;
export type UpdateTaxesBody = z.infer<typeof updateTaxesBodySchema>;
export type TaxUsageDto = z.infer<typeof taxUsageSchema>;
export type TaxesResponseDto = z.infer<typeof taxesResponseSchema>;
export type TaxesListRowDto = z.infer<typeof taxesListRowSchema>;
export type TaxesListResponseDto = z.infer<typeof taxesListResponseSchema>;
