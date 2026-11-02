/**
 * Request and response DTOs. Types are `z.infer` of the schemas. Every field is written inline.
 *
 * The list response is BE-19's envelope on the superset meta: `{ data, meta: { nextCursor,
 * prevCursor, total, rangeStart, exportLimit, printLimit } }`. A single resource is a bare body;
 * the request id is never in a body (it travels in the `x-request-id` header).
 *
 * The id is a STRING on the wire: the web treats it as opaque. The table's key is an integer, so
 * `shared/http/keyset.ts`'s `[value, id]` cursor applies; the transformer writes `String(row.id)`
 * and the date as its ISO string.
 *
 * Perfex's business outcomes are kept: the name is required, trimmed, 1 to
 * `ANNOUNCEMENTS_NAME_MAX` characters; the message is optional and trimmed, at most
 * `ANNOUNCEMENTS_MESSAGE_MAX` characters (an empty string remains empty, as Perfex stores it);
 * the three visibility switches are booleans on the wire, stored as Perfex's 0/1. The bodies are
 * strict: only these five fields are saved, so any other key is a 400.
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
export const ANNOUNCEMENTS_NAME_MAX = 191;
/** The maximum bytes Perfex's MEDIUMTEXT column can store. */
export const ANNOUNCEMENTS_MESSAGE_MAX = 16_777_215;
/** The longest `?q=`; a longer one is a 400 on `q`. */
export const ANNOUNCEMENTS_SEARCH_MAX = 100;
/** The largest value of a MySQL signed INT: the upper bound of the table's `id` column. */
const MAX_INT_ID = 2_147_483_647;

/** `GET /api/v1/announcements?limit&cursor&q&sort`: the documented surface. */
export const listAnnouncementsQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  /** The previous page's opaque `meta.nextCursor` or `meta.prevCursor`, sent with the same `sort`. */
  cursor: z.string().min(1).optional(),
  /** Search: the name contains `q`; when `q` is all digits, also the id equal to it. */
  q: z.string().max(ANNOUNCEMENTS_SEARCH_MAX).optional(),
  /** `-dateadded` (default, Perfex's order), `dateadded`, `name` or `-name`; a leading `-` is descending. */
  sort: z.string().optional(),
});

/**
 * `GET export`: the list query minus `limit` and `cursor` (an export is every row), plus the export
 * parameters of ADR-0043 as literal keys. Documentation only: `parseExportOptions` in
 * `shared/http/export.ts` is the gate. No `key`: the list has no row selection.
 */
export const exportAnnouncementsQuerySchema = listAnnouncementsQuerySchema
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
export const announcementsParamsSchema = z.object({
  id: z.coerce.number().int().positive().max(MAX_INT_ID),
});

/** One visibility switch on the wire; stored as Perfex's 0/1. */
const switchSchema = z.boolean();

/** `POST`: strict, so `id` or any other key is a 400 naming the key. */
export const createAnnouncementsBodySchema = z.strictObject({
  name: z.string().trim().min(1).max(ANNOUNCEMENTS_NAME_MAX),
  /** Optional: an empty (or whitespace) message remains an empty string, as Perfex stores it. */
  message: z.string().trim().max(ANNOUNCEMENTS_MESSAGE_MAX).optional(),
  showtousers: switchSchema,
  showtostaff: switchSchema,
  showname: switchSchema,
});

/** `PATCH :id`: the same body; `{}` is a 400 on `['name']`. */
export const updateAnnouncementsBodySchema = createAnnouncementsBodySchema;

/** One announcement: the id as a string, the stored name, the message (null when none), the date as ISO text and the switches as stored. */
export const announcementsResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    message: z.string().nullable(),
    dateadded: z.string(),
    showtousers: z.number().int(),
    showtostaff: z.number().int(),
    showname: z.number().int(),
  })
  .readonly();

/** One list row: the same shape as the record. */
export const announcementsListRowSchema = announcementsResponseSchema;

export const announcementsListResponseSchema = z
  .object({
    data: z.array(announcementsListRowSchema),
    /** The pager's meta, `exportLimit` (CSV and Excel, `EXPORT_MAX_ROWS`) and `printLimit` (PDF and print, `PRINT_MAX_ROWS`). */
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

export type ListAnnouncementsQuery = z.infer<typeof listAnnouncementsQuerySchema>;
export type AnnouncementsExportQuery = z.infer<typeof exportAnnouncementsQuerySchema>;
export type AnnouncementsParams = z.infer<typeof announcementsParamsSchema>;
export type CreateAnnouncementsBody = z.infer<typeof createAnnouncementsBodySchema>;
export type UpdateAnnouncementsBody = z.infer<typeof updateAnnouncementsBodySchema>;
export type AnnouncementsResponseDto = z.infer<typeof announcementsResponseSchema>;
export type AnnouncementsListRowDto = z.infer<typeof announcementsListRowSchema>;
export type AnnouncementsListResponseDto = z.infer<typeof announcementsListResponseSchema>;
