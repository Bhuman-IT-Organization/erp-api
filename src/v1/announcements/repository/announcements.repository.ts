/**
 * Repository: the module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Owner of the table it writes (ADR-0029; `ownership.json`):
 *   `tblannouncements`  node: `name`, `message`, `showtousers`, `showtostaff`, `showname`,
 *                       `dateadded`, `userid` (the actor's name); `announcementid` is assigned by the database.
 * `tbldismissed_announcements` is owned by perfex-core: Node never reads or writes it.
 *
 * Every row is re-parsed through its zod schema, never trusted from the generic (BE-11).
 *
 * The `dateadded` sort pages on the epoch millis of the DATETIME column: `shared/http/keyset.ts`'s
 * cursor carries `string | number | boolean`, so the key is `[dateadded.getTime(), id]` and the
 * repository turns a decoded millis back into a Date for the where clause — the predicate is still
 * a plain object of bound parameters, and the column name stays this file's constant.
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';

import { PrismaService } from '../../../shared/db/prisma.service.js';
import {
  encodeCursor,
  keysetWhere,
  type DecodedCursor,
  type KeyValue,
} from '../../../shared/http/keyset.js';
import {
  ANNOUNCEMENTS_FACADE_MAX_ROWS,
  type AnnouncementRow,
  type AnnouncementsListRequest,
  type AnnouncementsPage,
  type AnnouncementsSortField,
  type AnnouncementPatch,
  type NewAnnouncement,
} from '../model/announcements.model.js';

/** Prisma's "record to update not found". */
const RECORD_NOT_FOUND = 'P2025';

/** The largest value of MySQL's `INT` (the id column): a longer all-digit `q` is not an id. */
const MAX_INT_ID = 2_147_483_647;

/** The columns of the table; nothing else is selected. */
const COLUMNS = {
  announcementid: true,
  name: true,
  message: true,
  dateadded: true,
  showtousers: true,
  showtostaff: true,
  showname: true,
  userid: true,
} as const;

const rowSchema = z.object({
  announcementid: z.number().int(),
  name: z.string(),
  message: z.string().nullable(),
  dateadded: z.date(),
  showtousers: z.number().int(),
  showtostaff: z.number().int(),
  showname: z.number().int(),
  userid: z.string(),
});
const rowsSchema = z.array(rowSchema);

/** One row as the model names it: `id` for `announcementid`, the rest as stored. */
function toRow(parsed: z.infer<typeof rowSchema>): AnnouncementRow {
  return {
    id: parsed.announcementid,
    name: parsed.name,
    message: parsed.message,
    dateadded: parsed.dateadded,
    showtousers: parsed.showtousers,
    showtostaff: parsed.showtostaff,
    showname: parsed.showname,
  };
}

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];

/** `?q=`: the name contains it; an all-digit `q` that fits the id column also matches the id. */
function matchOf(search: string | null): WhereValue {
  if (search === null) return {};
  const or: WhereValue[] = [{ name: { contains: search } }];
  if (/^\d+$/.test(search) && Number(search) <= MAX_INT_ID) {
    or.push({ announcementid: Number(search) });
  }
  return { OR: or };
}

/** The sort column's cursor value of one row: the epoch millis for `dateadded`, else the column itself. */
function keyValueOf(row: AnnouncementRow, sortField: AnnouncementsSortField): KeyValue {
  if (sortField === 'dateadded') return row.dateadded.getTime();
  return row[sortField];
}

function keyOf(row: AnnouncementRow, sortField: AnnouncementsSortField): Key {
  return [keyValueOf(row, sortField), row.id];
}

/**
 * The where clause for a cursor: `keysetWhere`'s predicate, with a `dateadded` cursor's millis
 * turned back into a Date so Prisma compares it against the DATETIME column.
 */
function cursorWhere(
  sortField: AnnouncementsSortField,
  cursor: DecodedCursor<AnnouncementsSortField>,
  order: 'asc' | 'desc',
): WhereValue {
  if (sortField !== 'dateadded') return keysetWhere(sortField, 'announcementid', cursor, order);
  // `keysetWhere` rides KeyValue cursors, and a Date is none of its kinds, so the date side of the
  // predicate is written here: the same `{ OR: [...] }`, the millis back as a Date, the id breaking
  // ties — exactly what `keysetWhere` writes for any other column. The validator checks the millis.
  const [value, id] = cursor.key;
  const op = (order === 'asc') === (cursor.direction === 'after') ? 'gt' : 'lt';
  const date = new Date(value as number);
  return {
    OR: [{ dateadded: { [op]: date } }, { dateadded: date, announcementid: { [op]: id } }],
  };
}

/** A `before` cursor reads the rows just before it in the reversed order, then reverses them back. */
function readDirection(request: AnnouncementsListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

/** Next exists while rows remain after the page, Previous while rows exist before it. */
function pageMeta(
  sortField: AnnouncementsSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<AnnouncementsPage, 'items'> {
  const first = keys[0];
  const last = keys.at(-1);
  if (first === undefined || last === undefined) {
    return { nextCursor: null, prevCursor: null, total, rangeStart: 0 };
  }
  const rangeStart = before + 1;
  return {
    nextCursor:
      rangeStart - 1 + keys.length < total ? encodeCursor(sortField, last, 'after') : null,
    prevCursor: rangeStart > 1 ? encodeCursor(sortField, first, 'before') : null,
    total,
    rangeStart,
  };
}

/** Prisma's P2025, read from the error's `code` so no Prisma class leaves this file. */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === RECORD_NOT_FOUND
  );
}

@Injectable()
export class AnnouncementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One keyset page ordered by `(sort column, announcementid)`, then `total` (the match without the
   * cursor) and the rank of the first row, both through `count`, exactly as the customer groups list.
   */
  async list(request: AnnouncementsListRequest): Promise<AnnouncementsPage> {
    const { sortField, order, cursor, limit } = request;
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.prisma.client.tblannouncements.findMany({
      where: cursor === null ? match : { AND: [match, cursorWhere(sortField, cursor, order)] },
      orderBy: [{ [sortField]: read }, { announcementid: read }],
      take: limit,
      select: COLUMNS,
    });
    const items = rowsSchema.parse(rows).map(toRow);
    if (read !== order) items.reverse();
    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tblannouncements.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblannouncements.count({
            where: {
              AND: [
                match,
                cursorWhere(sortField, { sort: sortField, key: first, direction: 'before' }, order),
              ],
            },
          }),
    ]);
    return { items, ...pageMeta(sortField, keys, total, before) };
  }

  /** The list's own match without the cursor: what the export counts before it reads a row. */
  count(request: AnnouncementsListRequest): Promise<number> {
    return this.prisma.client.tblannouncements.count({ where: matchOf(request.search) });
  }

  /** One row in its stored form, or `null` when the id is missing. */
  async findById(id: number): Promise<AnnouncementRow | null> {
    const row = await this.prisma.client.tblannouncements.findFirst({
      where: { announcementid: id },
      select: COLUMNS,
    });
    return row === null ? null : toRow(rowSchema.parse(row));
  }

  /** Inserts a row; the database assigns the id, and `dateadded` is the moment of the insert. */
  async create(input: NewAnnouncement, dateadded: Date, userid: string): Promise<AnnouncementRow> {
    const row = await this.prisma.client.tblannouncements.create({
      data: {
        name: input.name,
        message: input.message,
        showtousers: input.showtousers,
        showtostaff: input.showtostaff,
        showname: input.showname,
        dateadded,
        // Perfex stores the staff member's full name in userid; the transport resolves it from Identity.
        userid,
      },
      select: COLUMNS,
    });
    return toRow(rowSchema.parse(row));
  }

  /** Changes the five saved fields and NOTHING else; `null` when the id is missing (Prisma P2025). */
  async update(id: number, patch: AnnouncementPatch): Promise<AnnouncementRow | null> {
    try {
      const row = await this.prisma.client.tblannouncements.update({
        where: { announcementid: id },
        data: {
          name: patch.name,
          message: patch.message,
          showtousers: patch.showtousers,
          showtostaff: patch.showtostaff,
          showname: patch.showname,
        },
        select: COLUMNS,
      });
      return toRow(rowSchema.parse(row));
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /** Deletes the announcement. `false` when it was missing (nothing was deleted). */
  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tblannouncements.deleteMany({
      where: { announcementid: id },
    });
    return count > 0;
  }

  /**
   * Every announcement, the date descending then the id (the order Perfex's portal reads): the
   * facade's `listAll`. Reads one row more than `ANNOUNCEMENTS_FACADE_MAX_ROWS` and refuses loudly
   * when it finds it, never answering a truncated list.
   */
  async listAll(): Promise<readonly AnnouncementRow[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tblannouncements.findMany({
        orderBy: [{ dateadded: 'desc' }, { announcementid: 'desc' }],
        take: ANNOUNCEMENTS_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > ANNOUNCEMENTS_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(ANNOUNCEMENTS_FACADE_MAX_ROWS)} announcements: the full list was refused, not truncated`,
      );
    }
    return rows.map(toRow);
  }

  /** The rows whose id is in `ids`, in no particular order (the service orders them). */
  async findByIds(ids: readonly number[]): Promise<readonly AnnouncementRow[]> {
    if (ids.length === 0) return [];
    return rowsSchema
      .parse(
        await this.prisma.client.tblannouncements.findMany({
          where: { announcementid: { in: [...ids] } },
          select: COLUMNS,
        }),
      )
      .map(toRow);
  }
}
