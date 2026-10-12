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
 * Node keeps Perfex's business outcomes (D-29): the name is required (Perfex's form requires it),
 * trimmed, 1 to `COST_CENTERS_NAME_MAX` characters (the `VARCHAR(255)` column), every character
 * accepted and stored as text (`<` and `>` included), and a name another cost center holds is
 * accepted (Perfex has no uniqueness check). The body is strict: Perfex saved every posted field,
 * Node saves only the name (D-26), so any other key is a 400. `created_by` is never answered.
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

/** The longest name a body may carry: Perfex's `VARCHAR(255)` column (the int spec reads it). */
export const COST_CENTERS_NAME_MAX = 255;
/** The longest `?q=`; a longer one is a 400 on `q`. */
export const COST_CENTERS_SEARCH_MAX = 100;

/**
 * `GET /api/v1/cost-centers?limit&cursor&q&sort`: the documented surface. `parseListQuery` in the
 * validator enforces it (the BE-19 grammar, one keyset sort, the cursor bound to that sort).
 */
export const listCostCentersQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  /** The previous page's opaque `meta.nextCursor` or `meta.prevCursor`, sent with the same `sort`. */
  cursor: z.string().min(1).optional(),
  /**
   * Search: the name contains `q` (case per the column's collation); when `q` is all digits and
   * fits the unsigned id column, also the id equal to it.
   */
  q: z.string().max(COST_CENTERS_SEARCH_MAX).optional(),
  /** `-id` (default, Perfex's order), `id`, `name` or `-name`; a leading `-` is descending. */
  sort: z.string().optional(),
});

/**
 * `GET export`: the list query minus `limit` and `cursor` (an export is every row), plus the export
 * parameters of ADR-0043 as literal keys. Documentation only: `parseExportOptions` in
 * `shared/http/export.ts` is the gate. No `key`: the list has no row selection.
 */
export const exportCostCentersQuerySchema = listCostCentersQuerySchema
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
export const costCentersParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * `POST`: strict, so `id`, `created_by`, `datecreated` or any other key is a 400 naming the key
 * (D-26). Every character of the name is accepted and stored as text.
 */
export const createCostCentersBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(COST_CENTERS_NAME_MAX),
});

/** `PATCH :id`: the same body; the form always sends the name, so `{}` is a 400 on `['name']`. */
export const updateCostCentersBodySchema = createCostCentersBodySchema;

/** What refers to the cost center, per group (the repository's `COST_CENTER_REFERENCES`); never exported. */
export const costCenterUsageSchema = z.object({
  purchaseRequests: z.number().int().nonnegative(),
  purchaseOrders: z.number().int().nonnegative(),
  purchaseQuotations: z.number().int().nonnegative(),
  shippingCharges: z.number().int().nonnegative(),
  expenses: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
});

/**
 * One cost center: the name as stored, `dateCreated` as the ISO instant of Perfex's wall clock in
 * the company zone (`null` when the column is NULL), and what uses it (the screen's delete dialog
 * reads it). `created_by` is never answered.
 */
export const costCentersResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    dateCreated: z.iso.datetime().nullable(),
    usage: costCenterUsageSchema,
  })
  .readonly();

/** One list row: the same shape as the record (the screen needs the usage for the delete dialog). */
export const costCentersListRowSchema = costCentersResponseSchema;

export const costCentersListResponseSchema = z
  .object({
    data: z.array(costCentersListRowSchema),
    /** The pager's meta, `exportLimit` (CSV and Excel, `EXPORT_MAX_ROWS`) and `printLimit` (PDF and print, `PRINT_MAX_ROWS`). */
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type ListCostCentersQuery = z.infer<typeof listCostCentersQuerySchema>;
export type CostCentersParams = z.infer<typeof costCentersParamsSchema>;
export type CreateCostCentersBody = z.infer<typeof createCostCentersBodySchema>;
export type UpdateCostCentersBody = z.infer<typeof updateCostCentersBodySchema>;
export type CostCenterUsageDto = z.infer<typeof costCenterUsageSchema>;
export type CostCentersResponseDto = z.infer<typeof costCentersResponseSchema>;
export type CostCentersListRowDto = z.infer<typeof costCentersListRowSchema>;
export type CostCentersListResponseDto = z.infer<typeof costCentersListResponseSchema>;
