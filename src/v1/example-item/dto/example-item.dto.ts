/**
 * Request and response DTOs. Types are `z.infer` of the schemas. Every field is written inline
 * (`name: z.string()…`), so each one can be compared field by field with the frontend template's
 * schemas.
 *
 * The list response is BE-19's envelope on the superset meta: `{ data, meta: { nextCursor,
 * prevCursor, total, rangeStart, exportLimit, printLimit } }`. A single resource is a bare body; the request id
 * is never in a body (it travels in the `x-request-id` header). No DTO names `internalRef` or
 * `ownerStaffId`.
 *
 * The id is a STRING on the wire: the web treats it as opaque (row keys and routes use it
 * verbatim). The store's key is an integer, so `shared/http/keyset.ts`'s `[value, id]` cursor
 * applies; the transformer writes `String(item.id)`.
 */
import { z } from 'zod';
import {
  exportBlankField,
  exportColumnField,
  exportDateFormatField,
  exportFormatField,
  exportHeaderField,
  exportKeyField,
  exportNoField,
  exportTimeFormatField,
  exportTimeZoneField,
  exportTitleField,
  exportYesField,
} from '../../../shared/http/export.js';
import { listPageMetaSchema } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';

/** The longest name a body may carry (the frontend template's form has the same bound). */
export const EXAMPLE_ITEM_NAME_MAX = 100;
/** The longest `?q=`; a longer one is a 400 on `q`. */
export const EXAMPLE_ITEM_SEARCH_MAX = 100;

/**
 * `GET /api/v1/example-item?limit&cursor&q&sort` — the documented surface. `parseListQuery` in the
 * validator enforces it (the BE-19 grammar, one keyset sort, the cursor bound to that sort).
 */
export const listExampleItemsQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  /** The previous page's opaque `meta.nextCursor` or `meta.prevCursor`, sent with the same `sort`. */
  cursor: z.string().min(1).optional(),
  /** Free-text search over the name. */
  q: z.string().max(EXAMPLE_ITEM_SEARCH_MAX).optional(),
  /** `id` (default) or `name`; a leading `-` is descending. */
  sort: z.string().optional(),
});

/**
 * `GET export`: the list query minus `limit` and `cursor` (an export is every row), plus the export
 * parameters of ADR-0043 as literal keys, `key` included: the
 * list takes the ticked rows (D-27). Documentation only: `parseExportOptions` in
 * `shared/http/export.ts` is the gate.
 */
export const exportExampleItemsQuerySchema = listExampleItemsQuerySchema
  .omit({ limit: true, cursor: true })
  .extend({
    header: exportHeaderField,
    format: exportFormatField,
    column: exportColumnField,
    key: exportKeyField,
    title: exportTitleField,
    yes: exportYesField,
    no: exportNoField,
    blank: exportBlankField,
    dateFormat: exportDateFormatField,
    timeFormat: exportTimeFormatField,
    timeZone: exportTimeZoneField,
  });

/** `:id` of the record routes: a non-numeric or non-positive id is a 400, never a 404 probe. */
export const exampleItemParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/** `POST` — strict: `id`, `createdAt`, `internalRef` or `ownerStaffId` is a 400 naming the key. */
export const createExampleItemBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(EXAMPLE_ITEM_NAME_MAX),
});

/** `PATCH :id` — any part of the create body; the validator refuses `{}`. */
export const updateExampleItemBodySchema = createExampleItemBodySchema.partial();

export const exampleItemResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    label: z.string(),
    createdAt: z.string(),
  })
  .readonly();

export const exampleItemListResponseSchema = z
  .object({
    data: z.array(exampleItemResponseSchema),
    /** The pager's meta, `exportLimit` (CSV and Excel, `EXPORT_MAX_ROWS`) and `printLimit` (PDF and print, `PRINT_MAX_ROWS`). */
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type ListExampleItemsQuery = z.infer<typeof listExampleItemsQuerySchema>;
export type ExampleItemParams = z.infer<typeof exampleItemParamsSchema>;
export type CreateExampleItemBody = z.infer<typeof createExampleItemBodySchema>;
export type UpdateExampleItemBody = z.infer<typeof updateExampleItemBodySchema>;
export type ExampleItemResponseDto = z.infer<typeof exampleItemResponseSchema>;
export type ExampleItemListResponseDto = z.infer<typeof exampleItemListResponseSchema>;
