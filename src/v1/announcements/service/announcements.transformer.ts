/**
 * Transformer: entity to response DTO and the export rows. Every DTO is built field by field and
 * then parsed through its zod response schema, which strips any key the schema does not name. The
 * controller never imports this file (BE-08).
 *
 * The stored message is HTML (`announcements-html.ts`): the wire answers it as plain text with
 * `hasOtherFormatting`. The stored `dateadded` is the company zone's wall clock
 * (`announcements-zone.ts`): the wire answers the instant it names.
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import { ANNOUNCEMENTS_EXPORT_COLUMNS } from '../announcements.routes.js';
import {
  announcementsListResponseSchema,
  announcementsResponseSchema,
  type AnnouncementsListResponseDto,
  type AnnouncementsResponseDto,
} from '../dto/announcements.dto.js';
import type { Announcement, AnnouncementRow } from '../model/announcements.model.js';
import { htmlToText } from './announcements-html.js';
import { instantOf } from './announcements-zone.js';

/** One announcement on the wire: the id as text, the message as text, the date as the ISO instant in `zone`. */
export function toResponse(row: AnnouncementRow, zone: string): AnnouncementsResponseDto {
  const message = row.message === null ? null : htmlToText(row.message);
  return announcementsResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    message: message === null ? null : message.text,
    dateAdded: instantOf(row.dateadded, zone),
    showToUsers: row.showtousers !== 0,
    showToStaff: row.showtostaff !== 0,
    showName: row.showname !== 0,
    hasOtherFormatting: message?.hasOtherFormatting ?? false,
  });
}

/** One exported row: the id as text, the name, and the date as its ISO instant. */
export interface AnnouncementExportRow {
  readonly id: string;
  readonly name: string;
  readonly dateadded: string;
}

/**
 * Each export column's cell over the exported row, keyed by the column name, so the column list in
 * `announcements.routes.ts` and what is written under it cannot drift (`satisfies`).
 */
export const ANNOUNCEMENTS_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
  dateadded: { value: (row) => row.dateadded, kind: 'dateTime' },
} as const satisfies Record<
  (typeof ANNOUNCEMENTS_EXPORT_COLUMNS)[number],
  ExportCell<AnnouncementExportRow>
>;

/** One exported row: the id as text, the name and the date as the ISO instant in `zone`. */
export function toExportRow(row: AnnouncementRow, zone: string): AnnouncementExportRow {
  return { id: String(row.id), name: row.name, dateadded: instantOf(row.dateadded, zone) };
}

/** The facade's shape: the stored fields, never the wire DTO. */
export function toAnnouncement(row: AnnouncementRow): Announcement {
  return {
    id: row.id,
    name: row.name,
    message: row.message,
    dateadded: row.dateadded,
    showtousers: row.showtousers,
    showtostaff: row.showtostaff,
    showname: row.showname,
  };
}

@Injectable()
export class AnnouncementsTransformer {
  /** One record. */
  toResponse(row: AnnouncementRow, zone: string): AnnouncementsResponseDto {
    return toResponse(row, zone);
  }

  /**
   * The list envelope: each row, the four paging fields copied one by one, and `exportLimit` and
   * `printLimit` from their one definition.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(
    rows: readonly AnnouncementRow[],
    zone: string,
    meta: ListPageMeta,
  ): AnnouncementsListResponseDto {
    return announcementsListResponseSchema.parse({
      data: rows.map((row) => this.toResponse(row, zone)),
      meta: {
        nextCursor: meta.nextCursor,
        prevCursor: meta.prevCursor,
        total: meta.total,
        rangeStart: meta.rangeStart,
        exportLimit: EXPORT_MAX_ROWS,
        printLimit: PRINT_MAX_ROWS,
      },
    });
  }
}
