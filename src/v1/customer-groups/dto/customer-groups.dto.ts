/**
 * Request and response DTOs. Types are `z.infer` of the schemas. Every field is written inline.
 *
 * The list response is BE-19's envelope on the superset meta: `{ data, meta: { nextCursor,
 * prevCursor, total, rangeStart, exportLimit, printLimit } }`. A single resource is a bare body;
 * the request id is never in a body (it travels in the `x-request-id` header).
 *
 * The id is a STRING on the wire: the web treats it as opaque. The table's key is an integer, so
 * `shared/http/keyset.ts`'s `[value, id]` cursor applies; the transformer writes `String(row.id)`.
 *
 * Perfex's business outcomes are kept: the name is required, trimmed, 1 to
 * `CUSTOMER_GROUPS_NAME_MAX` characters (the `VARCHAR(191)` column). The body is strict: only the
 * name is saved, so any other key is a 400.
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

/** The longest name a body may carry: Perfex's `VARCHAR(191)` column. */
export const CUSTOMER_GROUPS_NAME_MAX = 191;
/** The longest `?q=`; a longer one is a 400 on `q`. */
export const CUSTOMER_GROUPS_SEARCH_MAX = 100;
/** The largest value of a MySQL signed INT: the upper bound of the table's `id` column. */
const MAX_INT_ID = 2_147_483_647;

/** `GET /api/v1/customer-groups?limit&cursor&q&sort`: the documented surface. */
export const listCustomerGroupsQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  /** The previous page's opaque `meta.nextCursor` or `meta.prevCursor`, sent with the same `sort`. */
  cursor: z.string().min(1).optional(),
  /** Search: the name contains `q`; when `q` is all digits, also the id equal to it. */
  q: z.string().max(CUSTOMER_GROUPS_SEARCH_MAX).optional(),
  /** `-name` (default, Perfex's order), `name`, `id` or `-id`; a leading `-` is descending. */
  sort: z.string().optional(),
});

/**
 * `GET export`: the list query minus `limit` and `cursor` (an export is every row), plus the export
 * parameters of ADR-0043 as literal keys. Documentation only: `parseExportOptions` in
 * `shared/http/export.ts` is the gate. No `key`: the list has no row selection.
 */
export const exportCustomerGroupsQuerySchema = listCustomerGroupsQuerySchema
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
export const customerGroupsParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(MAX_INT_ID),
});

/** `POST`: strict, so `id` or any other key is a 400 naming the key. */
export const createCustomerGroupsBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(CUSTOMER_GROUPS_NAME_MAX),
});

/** `PATCH :id`: the same body; `{}` is a 400 on `['name']`. */
export const updateCustomerGroupsBodySchema = createCustomerGroupsBodySchema;

/** One customer group: the id as a string and the name as stored. */
export const customerGroupsResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .readonly();

/** One list row: the same shape as the record. */
export const customerGroupsListRowSchema = customerGroupsResponseSchema;

export const customerGroupsListResponseSchema = z
  .object({
    data: z.array(customerGroupsListRowSchema),
    /** The pager's meta, `exportLimit` (CSV and Excel, `EXPORT_MAX_ROWS`) and `printLimit` (PDF and print, `PRINT_MAX_ROWS`). */
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type ListCustomerGroupsQuery = z.infer<typeof listCustomerGroupsQuerySchema>;
export type CustomerGroupsExportQuery = z.infer<typeof exportCustomerGroupsQuerySchema>;
export type CustomerGroupsParams = z.infer<typeof customerGroupsParamsSchema>;
export type CreateCustomerGroupsBody = z.infer<typeof createCustomerGroupsBodySchema>;
export type UpdateCustomerGroupsBody = z.infer<typeof updateCustomerGroupsBodySchema>;
export type CustomerGroupsResponseDto = z.infer<typeof customerGroupsResponseSchema>;
export type CustomerGroupsListRowDto = z.infer<typeof customerGroupsListRowSchema>;
export type CustomerGroupsListResponseDto = z.infer<typeof customerGroupsListResponseSchema>;
