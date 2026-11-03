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
 * trimmed, 1 to `KNOWLEDGE_BASE_NAME_MAX` characters (the `VARCHAR(255)` column), every character
 * accepted and stored as text (`<` and `>` included), and a name another knowledge base holds is
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
export const KNOWLEDGE_BASE_NAME_MAX = 255;
/** The longest `?q=`; a longer one is a 400 on `q`. */
export const KNOWLEDGE_BASE_SEARCH_MAX = 100;
/** The longest group color string. */
export const KNOWLEDGE_BASE_COLOR_MAX = 20;
/** The maximum limit for group lists. */
export const KNOWLEDGE_BASE_GROUP_LIMIT_MAX = 100;

/**
 * `GET /api/v1/knowledge-base?limit&cursor&q&sort`: the documented surface. `parseListQuery` in the
 * validator enforces it (the BE-19 grammar, one keyset sort, the cursor bound to that sort).
 */
export const listKnowledgeBaseQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  /** The previous page's opaque `meta.nextCursor` or `meta.prevCursor`, sent with the same `sort`. */
  cursor: z.string().min(1).optional(),
  /**
   * Search: the name contains `q` (case per the column's collation); when `q` is all digits and
   * fits the unsigned id column, also the id equal to it.
   */
  q: z.string().max(KNOWLEDGE_BASE_SEARCH_MAX).optional(),
  /** `-id` (default, Perfex's order), `id`, `name` or `-name`; a leading `-` is descending. */
  sort: z.string().optional(),
});

/**
 * `GET export`: the list query minus `limit` and `cursor` (an export is every row), plus the export
 * parameters of ADR-0043 as literal keys. Documentation only: `parseExportOptions` in
 * `shared/http/export.ts` is the gate. No `key`: the list has no row selection.
 */
export const exportKnowledgeBaseQuerySchema = listKnowledgeBaseQuerySchema
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
export const knowledgeBaseParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/**
 * `POST`: strict, so `id`, `created_by`, `datecreated` or any other key is a 400 naming the key
 * (D-26). Every character of the name is accepted and stored as text.
 */
export const createKnowledgeBaseBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(KNOWLEDGE_BASE_NAME_MAX),
});

/** `PATCH :id`: the same body; the form always sends the name, so `{}` is a 400 on `['name']`. */
export const updateKnowledgeBaseBodySchema = createKnowledgeBaseBodySchema;

/** What refers to the knowledge base, per group (the repository's `KNOWLEDGE_BASE_REFERENCES`); never exported. */
export const knowledgeBaseUsageSchema = z.object({
  purchaseRequests: z.number().int().nonnegative(),
  purchaseOrders: z.number().int().nonnegative(),
  purchaseQuotations: z.number().int().nonnegative(),
  shippingCharges: z.number().int().nonnegative(),
  expenses: z.number().int().nonnegative(),
  assets: z.number().int().nonnegative(),
});

/**
 * One knowledge base: the name as stored, `dateCreated` as the ISO instant of Perfex's wall clock in
 * the company zone (`null` when the column is NULL), and what uses it (the screen's delete dialog
 * reads it). `created_by` is never answered.
 */
export const knowledgeBaseResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    dateCreated: z.iso.datetime().nullable(),
    usage: knowledgeBaseUsageSchema,
  })
  .readonly();

/** One list row: the same shape as the record (the screen needs the usage for the delete dialog). */
export const knowledgeBaseListRowSchema = knowledgeBaseResponseSchema;

export const knowledgeBaseListResponseSchema = z
  .object({
    data: z.array(knowledgeBaseListRowSchema),
    /** The pager's meta, `exportLimit` (CSV and Excel, `EXPORT_MAX_ROWS`) and `printLimit` (PDF and print, `PRINT_MAX_ROWS`). */
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type ListKnowledgeBaseQuery = z.infer<typeof listKnowledgeBaseQuerySchema>;
export type KnowledgeBaseParams = z.infer<typeof knowledgeBaseParamsSchema>;
export type CreateKnowledgeBaseBody = z.infer<typeof createKnowledgeBaseBodySchema>;
export type UpdateKnowledgeBaseBody = z.infer<typeof updateKnowledgeBaseBodySchema>;
export type KnowledgeBaseUsageDto = z.infer<typeof knowledgeBaseUsageSchema>;
export type KnowledgeBaseResponseDto = z.infer<typeof knowledgeBaseResponseSchema>;
export type KnowledgeBaseListRowDto = z.infer<typeof knowledgeBaseListRowSchema>;
export type KnowledgeBaseListResponseDto = z.infer<typeof knowledgeBaseListResponseSchema>;

export const knowledgeBaseGroupParamsSchema = z.object({
  groupId: z.coerce.number().int().positive(),
});
export type KnowledgeBaseGroupParams = z.infer<typeof knowledgeBaseGroupParamsSchema>;

export const createKnowledgeBaseGroupBodySchema = z.object({
  name: z.string().trim().min(1).max(KNOWLEDGE_BASE_NAME_MAX),
  color: z.string().max(KNOWLEDGE_BASE_COLOR_MAX).optional().nullable(),
  description: z.string().optional().nullable(),
  groupOrder: z.number().int().optional(),
  disabled: z.boolean().optional(),
  active: z.boolean().optional(),
});
export type CreateKnowledgeBaseGroupBody = z.infer<typeof createKnowledgeBaseGroupBodySchema>;

export const updateKnowledgeBaseGroupBodySchema = z.object({
  name: z.string().trim().min(1).max(KNOWLEDGE_BASE_NAME_MAX).optional(),
  color: z.string().max(KNOWLEDGE_BASE_COLOR_MAX).optional().nullable(),
  description: z.string().optional().nullable(),
  groupOrder: z.number().int().optional(),
  disabled: z.boolean().optional(),
  active: z.boolean().optional(),
  groupSlug: z.string().optional().nullable(),
});
export type UpdateKnowledgeBaseGroupBody = z.infer<typeof updateKnowledgeBaseGroupBodySchema>;

export const knowledgeBaseGroupResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    groupSlug: z.string().nullable(),
    description: z.string().nullable(),
    active: z.boolean(),
    color: z.string().nullable(),
    groupOrder: z.number().int(),
    totalArticles: z.number().int().nonnegative(),
  })
  .readonly();
export type KnowledgeBaseGroupResponseDto = z.infer<typeof knowledgeBaseGroupResponseSchema>;

export const knowledgeBaseGroupListResponseSchema = z
  .object({
    data: z.array(knowledgeBaseGroupResponseSchema),
    meta: z.object({
      total: z.number().int().nonnegative(),
      nextCursor: z.string().nullable().optional(),
      prevCursor: z.string().nullable().optional(),
    }),
  })
  .readonly();
export type KnowledgeBaseGroupListResponseDto = z.infer<
  typeof knowledgeBaseGroupListResponseSchema
>;

export const listKnowledgeBaseGroupsQuerySchema = z.object({
  q: z.string().max(KNOWLEDGE_BASE_SEARCH_MAX).optional(),
  limit: z.coerce.number().int().min(1).max(KNOWLEDGE_BASE_GROUP_LIMIT_MAX).optional(),
  sort: z.string().optional(),
});
export type ListKnowledgeBaseGroupsQuery = z.infer<typeof listKnowledgeBaseGroupsQuerySchema>;
