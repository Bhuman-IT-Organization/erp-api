/**
 * Request and response DTOs. Types are `z.infer` of the schemas; every field is written inline.
 *
 * The list response is BE-19's envelope on the superset meta: `{ data, meta: { nextCursor,
 * prevCursor, total, rangeStart, exportLimit, printLimit } }`. A single resource is a bare body that
 * carries its ADR-0040 fingerprint in `etag` beside the `ETag` header (PATTERNS M4); the request id
 * is never in a body.
 *
 * The id is a NUMBER on the wire. Read routes only: the module takes no request body, since
 * Perfex's Setup > Custom Fields page is the only writer of `tblcustomfields`.
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

/** The longest `?q=`; a longer one is a 400 on `q`. */
export const CUSTOM_FIELDS_SEARCH_MAX = 100;

/** `GET /api/v1/custom-fields?limit&cursor&q&sort&filter[fieldto][in]`: the documented surface. */
export const listCustomFieldsQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  /** The previous page's opaque `meta.nextCursor` or `meta.prevCursor`, sent with the same `sort`. */
  cursor: z.string().min(1).optional(),
  /** Free-text search over the name or the slug (contains). */
  q: z.string().max(CUSTOM_FIELDS_SEARCH_MAX).optional(),
  /** `id` (default), `name`, `fieldto`, `type` or `fieldOrder`; a leading `-` is descending. */
  sort: z.string().optional(),
  /** `filter[fieldto][in]=a,b`: the entities the list is narrowed to. */
  'filter[fieldto][in]': z.string().optional(),
});

/** `GET export`: the list query minus `limit` and `cursor`, plus ADR-0043's parameters. No `key`. */
export const exportCustomFieldsQuerySchema = listCustomFieldsQuerySchema
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
export const customFieldsParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/** One field as Perfex's form holds it, with its value count and its fingerprint (ADR-0040). */
const customFieldRecordSchema = z.object({
  id: z.number().int(),
  fieldto: z.string(),
  type: z.string(),
  name: z.string(),
  slug: z.string(),
  defaultValue: z.string().nullable(),
  options: z.array(z.string()),
  fieldOrder: z.number().int(),
  bsColumn: z.number().int(),
  disabled: z.boolean(),
  displayInline: z.boolean(),
  onlyAdmin: z.boolean(),
  disallowCustomerEdit: z.boolean(),
  required: z.boolean(),
  showOnTable: z.boolean(),
  showOnPdf: z.boolean(),
  showOnClientPortal: z.boolean(),
  showOnTicketForm: z.boolean(),
  valuesCount: z.number().int().nonnegative(),
  etag: z.string(),
});

export const customFieldsResponseSchema = customFieldRecordSchema.readonly();

/** One list row. */
export const customFieldsListRowSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    fieldto: z.string(),
    type: z.string(),
    slug: z.string(),
    active: z.boolean(),
    fieldOrder: z.number().int(),
    valuesCount: z.number().int().nonnegative(),
  })
  .readonly();

export const customFieldsListResponseSchema = z
  .object({
    data: z.array(customFieldsListRowSchema),
    /** The pager's meta, `exportLimit` (CSV and Excel) and `printLimit` (PDF and print). */
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type CustomFieldsParams = z.infer<typeof customFieldsParamsSchema>;
export type CustomFieldsResponseDto = z.infer<typeof customFieldsResponseSchema>;
export type CustomFieldsListRowDto = z.infer<typeof customFieldsListRowSchema>;
export type CustomFieldsListResponseDto = z.infer<typeof customFieldsListResponseSchema>;
