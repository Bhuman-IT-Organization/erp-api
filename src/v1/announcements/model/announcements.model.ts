/**
 * Domain entity types of the module; nothing here is a DTO. The entity is one `tblannouncements`
 * row in its STORED form: `announcementid` (`INT`, assigned by the database), `name`
 * (`VARCHAR(191)`), `message` (`MEDIUMTEXT`), `dateadded` (`DATETIME`) and the three
 * visibility switches Perfex writes as 0/1 (`showtousers`, `showtostaff`, `showname`). The message
 * can be NULL in a legacy stored row, though Node writes empty text when omitted on create.
 * `userid` (`VARCHAR(100)`, the actor's name) is written on create and never read back, so the
 * entity does not carry it.
 *
 * `tbldismissed_announcements` is owned by perfex-core (ADR-0029): it links a staff member to an
 * announcement they dismissed, and Node never reads or writes it — a read would have to pick a
 * staff id the api does not know.
 */
import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

/** One `tblannouncements` row, stored form. */
export interface AnnouncementRow {
  /** The table's integer key; `String(id)` on the wire. */
  readonly id: number;
  readonly name: string;
  readonly message: string | null;
  readonly dateadded: Date;
  readonly showtousers: number;
  readonly showtostaff: number;
  readonly showname: number;
}

/** What `create` stores: the trimmed name, the trimmed message (empty when omitted, never null) and the switches. */
export interface NewAnnouncement {
  readonly name: string;
  readonly message: string;
  readonly showtousers: number;
  readonly showtostaff: number;
  readonly showname: number;
}

/** What `update` stores: the same fields a create stores, in Perfex's order (name, message, switches). */
export interface AnnouncementPatch {
  readonly name: string;
  readonly message: string;
  readonly showtousers: number;
  readonly showtostaff: number;
  readonly showname: number;
}

/** The facade's public shape. */
export interface Announcement {
  readonly id: number;
  readonly name: string;
  readonly message: string | null;
  readonly dateadded: Date;
  readonly showtousers: number;
  readonly showtostaff: number;
  readonly showname: number;
}

export type AnnouncementId = Announcement['id'];

/** The columns `?sort=` accepts: keyset keys (NOT NULL, one value per row). */
export type AnnouncementsSortField = 'name' | 'dateadded';

/** One checked list request: `?q`, the one sort, the cursor decoded for it, the page size. */
export interface AnnouncementsListRequest {
  readonly search: string | null;
  readonly sortField: AnnouncementsSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<AnnouncementsSortField> | null;
  readonly limit: number;
}

/** One keyset page and its pager meta (`shared/http/keyset.ts`). */
export interface AnnouncementsPage extends ListPageMeta {
  readonly items: readonly AnnouncementRow[];
}

/**
 * The most rows the facade's `listAll` answers. Above this the read is refused loudly
 * (`ERP-INTERNAL-0001`), never truncated, so a portal screen never silently misses an announcement.
 */
export const ANNOUNCEMENTS_FACADE_MAX_ROWS = 1000;
