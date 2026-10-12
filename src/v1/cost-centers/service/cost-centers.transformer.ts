/**
 * Transformer: Perfex's wall clock (D-31), the export rows and entity to response DTO. Every DTO is
 * built field by field and then parsed through its zod response schema, which strips any key the
 * schema does not name, so nothing the wire shape does not declare can ride along (T-2-14): the
 * row's `created_by` is never answered. The controller never imports this file (BE-08).
 *
 * D-31, Perfex's `datecreated`: `Cost_centers_model::add` writes PHP's `date('Y-m-d H:i:s')`, and
 * PHP's zone is the `default_timezone` setting when it is set (`application/core/App_Controller.php`
 * :59-62), else the server's (UTC on the client's stack). So the column holds a NAIVE wall clock in
 * the company zone. `wallClockAt` turns an instant into that wall clock, packed with `Date.UTC` so
 * Prisma (which writes a `DATETIME` from the UTC fields) stores it verbatim; `instantOf` reads it
 * back as the instant it names in the same zone, which is what the wire answers.
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import { COST_CENTERS_EXPORT_COLUMNS } from '../cost-centers.routes.js';
import {
  costCentersListResponseSchema,
  costCentersResponseSchema,
  type CostCentersListResponseDto,
  type CostCentersResponseDto,
} from '../dto/cost-centers.dto.js';
import type { CostCenter, CostCenterRow, CostCenterUsage } from '../model/cost-centers.model.js';

/** The zone PHP uses when `default_timezone` is empty or not a zone: the server's, UTC on the client's stack. */
export const FALLBACK_ZONE = 'UTC';

/**
 * The shape of an IANA zone name (`Area/Location`, `UTC`, `Etc/GMT+4`), checked before `Intl` so an
 * offset string (`+04:00`) that newer engines accept is still refused (branding's rule).
 */
const IANA_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/** One second in milliseconds: the wall clock keeps seconds, as `DATETIME(0)` does. */
const SECOND_MS = 1000;

/** `Date.UTC`'s month is 0-based; `formatToParts` answers 1 to 12. */
const MONTH_BASE = 1;

/** The counts a cost center answers when the usage map has no entry for its id. */
export const NO_COST_CENTER_USAGE: CostCenterUsage = {
  purchaseRequests: 0,
  purchaseOrders: 0,
  purchaseQuotations: 0,
  shippingCharges: 0,
  expenses: 0,
  assets: 0,
};

/** One exported row: the three export columns, `dateCreated` the ISO instant or `null`. */
export interface CostCenterExportRow {
  readonly id: string;
  readonly name: string;
  readonly dateCreated: string | null;
}

/**
 * Each export column's cell over the exported row, keyed by the column name, so the column list in
 * `cost-centers.routes.ts` and what is written under it cannot drift (`satisfies`). `dateCreated` is
 * the ISO instant in a file and the reader's date and time format and zone in PDF and Print
 * (`kind: 'dateTime'`, as Perfex's list prints `_d()`, which hands a value with a time to `_dt()`);
 * a NULL date is empty, or the column's sent blank label.
 */
export const COST_CENTERS_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
  dateCreated: { value: (row) => row.dateCreated, kind: 'dateTime' },
} as const satisfies Record<
  (typeof COST_CENTERS_EXPORT_COLUMNS)[number],
  ExportCell<CostCenterExportRow>
>;

/** Formatters per zone: `Intl.DateTimeFormat` is costly to build and a zone's never changes. */
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

/** Whether `zone` names an IANA zone this runtime knows. */
function isKnownZone(zone: string): boolean {
  if (!IANA_ZONE_NAME.test(zone)) return false;
  try {
    // Validation, not formatting: `Intl` throws a RangeError for a zone it does not know.
    formatterOf(zone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone Perfex's `date()` runs in: the `default_timezone` setting when it is an IANA zone name,
 * else `FALLBACK_ZONE` (Perfex sets PHP's zone only when the option is non-empty; an empty or
 * unknown one leaves the server's, UTC). The fallback is recorded in the README.
 */
export function companyZone(setting: string | null): string {
  return setting !== null && isKnownZone(setting) ? setting : FALLBACK_ZONE;
}

/**
 * The calendar fields of `instant` in `zone`, packed with `Date.UTC`: the result's UTC fields ARE
 * that wall clock, so Prisma writes them verbatim to the naive `DATETIME`. Seconds kept,
 * milliseconds dropped (the column is `DATETIME(0)`).
 *
 * @complexity O(1): one `formatToParts` over seven fields
 */
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

/** How far `zone`'s wall clock is ahead of UTC at `instant`, in milliseconds (whole seconds). */
function offsetAt(instant: number, zone: string): number {
  const whole = Math.floor(instant / SECOND_MS) * SECOND_MS;
  return wallClockAt(new Date(whole), zone).getTime() - whole;
}

/**
 * The inverse of `wallClockAt`: the stored wall clock read in `zone`, as an ISO instant. The offset
 * is found at the wall clock read as UTC, then corrected once at the first guess, so a wall clock
 * just after a daylight-saving change lands on the right side of it. A wall clock that occurs twice
 * (the hour a clock goes back) reads as the later instant; one that never occurs (the hour skipped,
 * which `wallClockAt` never produces) reads an hour early, on the earlier side of the skip.
 */
export function instantOf(stored: Date, zone: string): string {
  const wall = stored.getTime();
  const first = wall - offsetAt(wall, zone);
  const corrected = wall - offsetAt(first, zone);
  return new Date(corrected).toISOString();
}

/** One cost center on the wire: the id as text, the stored name, the instant of its date, its usage. */
export function toResponse(
  row: CostCenterRow,
  usage: CostCenterUsage,
  zone: string,
): CostCentersResponseDto {
  return costCentersResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    dateCreated: row.datecreated === null ? null : instantOf(row.datecreated, zone),
    usage,
  });
}

/** One exported row: the id as text, the name, the instant of the date (or `null`); never the usage. */
export function toExportRow(row: CostCenterRow, zone: string): CostCenterExportRow {
  return {
    id: String(row.id),
    name: row.name,
    dateCreated: row.datecreated === null ? null : instantOf(row.datecreated, zone),
  };
}

/** The facade's shape: `{ id, name }`, never the wire DTO, never `created_by`. */
export function toCostCenter(row: CostCenterRow): CostCenter {
  return { id: row.id, name: row.name };
}

@Injectable()
export class CostCentersTransformer {
  /** One record: `toResponse` with the usage the map holds for it (zeros when none). */
  toResponse(
    row: CostCenterRow,
    usage: ReadonlyMap<number, CostCenterUsage>,
    zone: string,
  ): CostCentersResponseDto {
    return toResponse(row, usage.get(row.id) ?? NO_COST_CENTER_USAGE, zone);
  }

  /**
   * The list envelope: each row with its usage (zeros when the map has no entry for the id), the
   * four page fields copied one by one (a page object passed as the meta carries nothing else),
   * `exportLimit` and `printLimit` from their one definition.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(
    rows: readonly CostCenterRow[],
    usage: ReadonlyMap<number, CostCenterUsage>,
    zone: string,
    meta: ListPageMeta,
  ): CostCentersListResponseDto {
    return costCentersListResponseSchema.parse({
      data: rows.map((row) => this.toResponse(row, usage, zone)),
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
