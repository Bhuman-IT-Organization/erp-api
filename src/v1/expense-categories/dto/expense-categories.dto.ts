/**
 * Request and response DTOs. Types are `z.infer` of the schemas. Every field is written inline
 * (`name: z.string()...`), so each one can be compared field by field with the frontend template's
 * schemas.
 *
 * The list response is BE-19's envelope on the superset meta: `{ data, meta: { nextCursor,
 * prevCursor, total, rangeStart, exportLimit, printLimit } }`. A single resource is a bare body; the request id
 * is never in a body (it travels in the `x-request-id` header).
 *
 * The id is a STRING on the wire: the web treats it as opaque (row keys and routes use it
 * verbatim). The table's key is an integer, so `shared/http/keyset.ts`'s `[value, id]` cursor
 * applies; the transformer writes `String(row.id)`.
 *
 * D-19: Node accepts exactly what Perfex accepts. The name is required, trimmed and at most
 * `EXPENSE_CATEGORIES_NAME_MAX` characters (the `VARCHAR(191)` column), and no character is refused:
 * `<` and `>` included. The description is optional with no Node cap: the column is `MEDIUMTEXT`,
 * and the only ceiling is the api's existing request-body limit (Fastify's default, 1 MiB), which is
 * not a new cap. Stored markup is made safe by rendering it as text (T-4.1-07), never by refusing it.
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

/** The longest name a body may carry: Perfex's `VARCHAR(191)` column (the form has the same bound). */
export const EXPENSE_CATEGORIES_NAME_MAX = 191;
/** The longest `?q=`; a longer one is a 400 on `q`. */
export const EXPENSE_CATEGORIES_SEARCH_MAX = 100;

/**
 * `GET /api/v1/expense-categories?limit&cursor&q&sort`: the documented surface. `parseListQuery` in
 * the validator enforces it (the BE-19 grammar, one keyset sort, the cursor bound to that sort).
 */
export const listExpenseCategoriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  /** The previous page's opaque `meta.nextCursor` or `meta.prevCursor`, sent with the same `sort`. */
  cursor: z.string().min(1).optional(),
  /** Free-text search over the name or the description (contains, case-insensitive). */
  q: z.string().max(EXPENSE_CATEGORIES_SEARCH_MAX).optional(),
  /** `name` (default, Perfex's order) or `id`; a leading `-` is descending. */
  sort: z.string().optional(),
});

/**
 * `GET export`: the list query minus `limit` and `cursor` (an export is every row), plus the export
 * parameters of ADR-0043 as literal keys. Documentation only: `parseExportOptions` in
 * `shared/http/export.ts` is the gate. No `key`: the list has no row selection (D-27).
 */
export const exportExpenseCategoriesQuerySchema = listExpenseCategoriesQuerySchema
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
export const expenseCategoriesParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/** `POST`: strict, so `id` or a count is a 400 naming the key (D-19 for the two fields). */
export const createExpenseCategoriesBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(EXPENSE_CATEGORIES_NAME_MAX),
  description: z.string().optional(),
});

/** `PATCH :id`: any part of the create body; the validator refuses `{}`. */
export const updateExpenseCategoriesBodySchema = createExpenseCategoriesBodySchema.partial();

/** One category: the description in its read form (`<br />` removed, trimmed; `''` when none). */
export const expenseCategoriesResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
  })
  .readonly();

/**
 * One list row: the category plus what refers to it, so the screen can refuse a delete up front
 * (D-07, D-15). The counts are never exported.
 */
export const expenseCategoriesListRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    expenseCount: z.number().int().nonnegative(),
    mappingCount: z.number().int().nonnegative(),
    pettyCashCount: z.number().int().nonnegative(),
  })
  .readonly();

export const expenseCategoriesListResponseSchema = z
  .object({
    data: z.array(expenseCategoriesListRowSchema),
    /** The pager's meta, `exportLimit` (CSV and Excel, `EXPORT_MAX_ROWS`) and `printLimit` (PDF and print, `PRINT_MAX_ROWS`). */
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type ListExpenseCategoriesQuery = z.infer<typeof listExpenseCategoriesQuerySchema>;
export type ExpenseCategoriesParams = z.infer<typeof expenseCategoriesParamsSchema>;
export type CreateExpenseCategoriesBody = z.infer<typeof createExpenseCategoriesBodySchema>;
export type UpdateExpenseCategoriesBody = z.infer<typeof updateExpenseCategoriesBodySchema>;
export type ExpenseCategoriesResponseDto = z.infer<typeof expenseCategoriesResponseSchema>;
export type ExpenseCategoriesListRowDto = z.infer<typeof expenseCategoriesListRowSchema>;
export type ExpenseCategoriesListResponseDto = z.infer<typeof expenseCategoriesListResponseSchema>;
