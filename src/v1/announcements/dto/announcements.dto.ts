/**
 * Request and response DTOs. Types are `z.infer` of the schemas. Every field is written inline.
 *
 * The list response is BE-19's envelope on the superset meta: `{ data, meta: { nextCursor,
 * prevCursor, total, rangeStart, exportLimit, printLimit } }`. A single resource is a bare body;
 * the request id is never in a body (it travels in the `x-request-id` header).
 *
 * The id is a STRING on the wire: the web treats it as opaque. The table's key is an integer, so
 * `shared/http/keyset.ts`'s `[value, id]` cursor applies; the transformer writes `String(row.id)`
 * and maps the stored date to camelCase `dateAdded` as an ISO instant (the column holds the company
 * zone's wall clock, `announcements-zone.ts`).
 *
 * Perfex's business outcomes are kept: the name is required, trimmed, 1 to
 * `ANNOUNCEMENTS_NAME_MAX` characters; the message is optional on create and on update (an omitted
 * message on update leaves the stored one untouched), plain text on the wire, trimmed. The column
 * holds HTML (`announcements-html.ts`), so the real cap is on the stored HTML in bytes and the
 * service answers 400 on `message` when it is longer; the character cap here is only the first,
 * cheaper gate. The visibility switches are booleans on the wire, stored as Perfex's 0/1. The
 * bodies are strict: only the five accepted fields are allowed.
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
/** The longest `userid`: Perfex's `VARCHAR(100)` column; the actor's full name is cut to it. */
export const ANNOUNCEMENTS_USERID_MAX = 100;
/**
 * The most typed characters Zod accepts: MEDIUMTEXT holds 16,777,215 bytes and the stored HTML is
 * never shorter than the typed text, so a longer text can never fit. The exact cap is on the HTML
 * (`exceedsMessageLimit`); Fastify's 1 MiB body limit applies before both.
 */
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
  showToUsers: switchSchema,
  showToStaff: switchSchema,
  showName: switchSchema,
});

/**
 * `PATCH :id`: the same strict body, and `message` is optional: a body without it leaves the stored
 * message byte for byte as it was (Perfex's editor may have stored bold or links in it).
 */
export const updateAnnouncementsBodySchema = createAnnouncementsBodySchema;

/** One announcement: the message as plain text, whether stored formatting was dropped, ISO dateAdded. */
export const announcementsResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    message: z.string().nullable(),
    dateAdded: z.iso.datetime(),
    showToUsers: z.boolean(),
    showToStaff: z.boolean(),
    showName: z.boolean(),
    hasOtherFormatting: z.boolean(),
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
