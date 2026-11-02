/**
 * Transformer: entity to response DTO and the export rows. Every DTO is built field by field and
 * then parsed through its zod response schema, which strips any key the schema does not name. The
 * controller never imports this file (BE-08).
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

/** One announcement on the wire: the id as text, the stored fields, the date as ISO text. */
export function toResponse(row: AnnouncementRow): AnnouncementsResponseDto {
  return announcementsResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    message: row.message,
    dateadded: row.dateadded.toISOString(),
    showtousers: row.showtousers,
    showtostaff: row.showtostaff,
    showname: row.showname,
  });
}

/** One exported row: the id as text, the name, and the date as its ISO text. */
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
  dateadded: { value: (row) => row.dateadded },
} as const satisfies Record<
  (typeof ANNOUNCEMENTS_EXPORT_COLUMNS)[number],
  ExportCell<AnnouncementExportRow>
>;

/** One exported row: the id as text, the name and the date as its ISO text. */
export function toExportRow(row: AnnouncementRow): AnnouncementExportRow {
  return { id: String(row.id), name: row.name, dateadded: row.dateadded.toISOString() };
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
  toResponse(row: AnnouncementRow): AnnouncementsResponseDto {
    return toResponse(row);
  }

  /**
   * The list envelope: each row, the four page fields copied one by one, and `exportLimit` and
   * `printLimit` from their one definition.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(
    rows: readonly AnnouncementRow[],
    meta: ListPageMeta,
  ): AnnouncementsListResponseDto {
    return announcementsListResponseSchema.parse({
      data: rows.map((row) => this.toResponse(row)),
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
