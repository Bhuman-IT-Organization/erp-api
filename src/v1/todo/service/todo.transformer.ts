import { Injectable } from '@nestjs/common';
import {
  todoListResponseSchema,
  todoResponseSchema,
  type TodoListResponseDto,
  type TodoResponseDto,
} from '../dto/todo.dto.js';
import type { TodoRow } from '../model/todo.model.js';

/** The zone PHP uses when `default_timezone` is empty or not a zone: the server's, UTC here. */
export const FALLBACK_ZONE = 'UTC';

const IANA_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const SECOND_MS = 1000;
const MONTH_BASE = 1;

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterOf(zone: string): Intl.DateTimeFormat {
  const known = FORMATTERS.get(zone);
  if (known !== undefined) return known;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  FORMATTERS.set(zone, formatter);
  return formatter;
}

function isKnownZone(zone: string): boolean {
  if (!IANA_ZONE_NAME.test(zone)) return false;
  try {
    formatterOf(zone);
    return true;
  } catch {
    return false;
  }
}

/** The zone Perfex's `date()` runs in: the setting when it is an IANA name, else `UTC`. */
export function companyZone(setting: string | null): string {
  return setting !== null && isKnownZone(setting) ? setting : FALLBACK_ZONE;
}

/** The calendar fields of `instant` in `zone`, packed with `Date.UTC` (seconds kept). */
export function wallClockAt(instant: Date, zone: string): Date {
  const fields = new Map(
    formatterOf(zone)
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  const field = (type: Intl.DateTimeFormatPartTypes): number => fields.get(type) ?? 0;
  return new Date(
    Date.UTC(
      field('year'),
      field('month') - MONTH_BASE,
      field('day'),
      field('hour'),
      field('minute'),
      field('second'),
    ),
  );
}

function offsetAt(instant: number, zone: string): number {
  const whole = Math.floor(instant / SECOND_MS) * SECOND_MS;
  return wallClockAt(new Date(whole), zone).getTime() - whole;
}

/** The inverse of `wallClockAt`: the stored wall clock read in `zone`, as an ISO instant. */
export function instantOf(stored: Date, zone: string): string {
  const wall = stored.getTime();
  const first = wall - offsetAt(wall, zone);
  const corrected = wall - offsetAt(first, zone);
  return new Date(corrected).toISOString();
}

/** The opaque `nextCursor`: the offset of the next page. `todo.validator.ts` decodes the same shape. */
export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

/** One to do on the wire: the id as text, the text as stored, both dates as instants or `null`. */
export function toResponse(row: TodoRow, zone: string): TodoResponseDto {
  return todoResponseSchema.parse({
    id: String(row.id),
    description: row.description,
    finished: row.finished,
    dateAdded: instantOf(row.dateAdded, zone),
    dateFinished: row.dateFinished === null ? null : instantOf(row.dateFinished, zone),
  });
}

@Injectable()
export class TodoTransformer {
  toResponse(row: TodoRow, zone: string): TodoResponseDto {
    return toResponse(row, zone);
  }

  /**
   * The list envelope: `nextCursor` is set while rows remain after this page.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(
    rows: readonly TodoRow[],
    total: number,
    offset: number,
    zone: string,
  ): TodoListResponseDto {
    const end = offset + rows.length;
    return todoListResponseSchema.parse({
      data: rows.map((row) => toResponse(row, zone)),
      meta: { nextCursor: end < total ? encodeOffsetCursor(end) : null, total },
    });
  }
}
