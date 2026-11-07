import { Injectable } from '@nestjs/common';
import {
  todoListResponseSchema,
  todoResponseSchema,
  type TodoListResponseDto,
  type TodoResponseDto,
} from '../dto/todo.dto.js';
import type { TodoRow } from '../model/todo.model.js';
import { encodeTodoCursor } from '../repository/todo.cursor.js';
/** The zone PHP uses when `default_timezone` is empty or not a zone: UTC here. */
export const FALLBACK_ZONE = 'UTC';

const IANA_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;
const SECOND_MS = 1000;
const MONTH_BASE = 1;

// Perfex description storage and read conversion.
const PHP_WHITESPACE = ' \t\n\r\u0000\u000b';
const LINE_BREAK = /\r\n|\n\r|\n|\r/g;
const CLOSING_TAG_ON_ONE_LINE = /<\/[^\n]*>/;
const ENDS_WITH_TAG = /<\/?[^/<>]*>$/;
const BREAK_TAGS = [/<br \/>/gi, /<br>/gi, /<br\/>/gi] as const;
/**
 * @complexity O(n) over the input characters
 */
function stripEnd(text: string): string {
  let end = text.length;
  while (end > 0 && PHP_WHITESPACE.includes(text.charAt(end - 1))) {
    end -= 1;
  }
  return text.slice(0, end);
}
/**
 * @complexity O(n) over the input characters
 */
function stripStart(text: string): string {
  let start = 0;
  while (start < text.length && PHP_WHITESPACE.includes(text.charAt(start))) {
    start += 1;
  }
  return text.slice(start);
}
/**
 * @complexity O(n) over the input characters
 */
function storedLine(line: string): string {
  const trimmed = stripEnd(line);
  return `${trimmed}${ENDS_WITH_TAG.test(trimmed) ? '' : '<br />'}\n`;
}

/**
 * Converts the description into the stored format used by Perfex's
 * `nl2br_save_html`.
 */
export function toStoredDescription(text: string): string {
  if (!CLOSING_TAG_ON_ONE_LINE.test(text)) {
    return text.replace(LINE_BREAK, '<br />$&');
  }

  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n').map(storedLine).join('');
}

/**
 * Converts the stored description into the editable format used by
 * Perfex's `clear_textarea_breaks`.
 */
export function fromStoredDescription(stored: string | null): string {
  if (stored === null || stored === '') return '';

  const cleared = BREAK_TAGS.reduce((text, tag) => text.replace(tag, ''), stored);
  return stripStart(stripEnd(cleared));
}

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

/** The zone Perfex's `date()` runs in: the setting when it is an IANA name, else UTC. */
export function companyZone(setting: string | null): string {
  return setting !== null && isKnownZone(setting) ? setting : FALLBACK_ZONE;
}

/** The calendar fields of `instant` in `zone`, packed with `Date.UTC`. */
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

/** The opaque `nextCursor`: the offset of the next page. */
export function encodeOffsetCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
}

/** One to do on the wire: the description in editable form and both dates as instants. */
export function toResponse(row: TodoRow, zone: string): TodoResponseDto {
  return todoResponseSchema.parse({
    id: String(row.id),
    description: fromStoredDescription(row.description),
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
   * The list envelope: next cursor identifies the last returned row when more rows remain.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(
    rows: readonly TodoRow[],
    total: number,
    hasMore: boolean,
    zone: string,
  ): TodoListResponseDto {
    const lastRow = rows[rows.length - 1];

    const nextCursor =
      hasMore && lastRow !== undefined
        ? encodeTodoCursor({
            itemOrder: lastRow.itemOrder,
            todoid: lastRow.id,
          })
        : null;

    return todoListResponseSchema.parse({
      data: rows.map((row) => toResponse(row, zone)),
      meta: { nextCursor, total },
    });
  }
}
