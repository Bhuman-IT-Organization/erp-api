/**
 * Transformer: Perfex's wall clock (D-31), the export rows and entity to response DTO. Every DTO is
 * built field by field and then parsed through its zod response schema, which strips any key the
 * schema does not name, so nothing the wire shape does not declare can ride along (T-2-14): the
 * row's `created_by` is never answered. The controller never imports this file (BE-08).
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import { CONTRACT_TYPES_EXPORT_COLUMNS } from '../contract-types.routes.js';
import {
  contractTypesListResponseSchema,
  contractTypesResponseSchema,
  type ContractTypesListResponseDto,
  type ContractTypesResponseDto,
} from '../dto/contract-types.dto.js';
import type {
  ContractType,
  ContractTypeRow,
  ContractTypeUsage,
} from '../model/contract-types.model.js';

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

/** The counts a contract type answers when the usage map has no entry for its id. */
export const NO_CONTRACT_TYPE_USAGE: ContractTypeUsage = {
  purchaseRequests: 0,
  purchaseOrders: 0,
  purchaseQuotations: 0,
  shippingCharges: 0,
  expenses: 0,
  assets: 0,
};

/** One exported row: the three export columns, `dateCreated` the ISO instant or `null`. */
export interface ContractTypeExportRow {
  readonly id: string;
  readonly name: string;
  readonly dateCreated: string | null;
}

/**
 * Each export column's cell over the exported row, keyed by the column name.
 */
export const CONTRACT_TYPES_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
  dateCreated: { value: (row) => row.dateCreated, kind: 'dateTime' },
} as const satisfies Record<
  (typeof CONTRACT_TYPES_EXPORT_COLUMNS)[number],
  ExportCell<ContractTypeExportRow>
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
    formatterOf(zone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone Perfex's `date()` runs in: the `default_timezone` setting when it is an IANA zone name,
 * else `FALLBACK_ZONE`.
 */
export function companyZone(setting: string | null): string {
  return setting !== null && isKnownZone(setting) ? setting : FALLBACK_ZONE;
}

/**
 * The calendar fields of `instant` in `zone`, packed with `Date.UTC`: the result's UTC fields ARE
 * that wall clock, so Prisma writes them verbatim to the naive `DATETIME`. Seconds kept,
 * milliseconds dropped (the column is `DATETIME(0)`).
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
 * The inverse of `wallClockAt`: the stored wall clock read in `zone`, as an ISO instant.
 */
export function instantOf(stored: Date, zone: string): string {
  const wall = stored.getTime();
  const first = wall - offsetAt(wall, zone);
  const corrected = wall - offsetAt(first, zone);
  return new Date(corrected).toISOString();
}

/** One contract type on the wire: the id as text, the stored name, the instant of its date, its usage. */
export function toResponse(
  row: ContractTypeRow,
  usage: ContractTypeUsage,
  zone: string,
): ContractTypesResponseDto {
  return contractTypesResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    dateCreated: row.datecreated === null ? null : instantOf(row.datecreated, zone),
    usage,
  });
}

/** One exported row: the id as text, the name, the instant of the date (or `null`); never the usage. */
export function toExportRow(row: ContractTypeRow, zone: string): ContractTypeExportRow {
  return {
    id: String(row.id),
    name: row.name,
    dateCreated: row.datecreated === null ? null : instantOf(row.datecreated, zone),
  };
}

/** The facade's shape: `{ id, name }`, never the wire DTO, never `created_by`. */
export function toContractType(row: ContractTypeRow): ContractType {
  return { id: row.id, name: row.name };
}

@Injectable()
export class ContractTypesTransformer {
  /** One record: `toResponse` with the usage the map holds for it (zeros when none). */
  toResponse(
    row: ContractTypeRow,
    usage: ReadonlyMap<number, ContractTypeUsage>,
    zone: string,
  ): ContractTypesResponseDto {
    return toResponse(row, usage.get(row.id) ?? NO_CONTRACT_TYPE_USAGE, zone);
  }

  toListResponse(
    rows: readonly ContractTypeRow[],
    usage: ReadonlyMap<number, ContractTypeUsage>,
    zone: string,
    meta: ListPageMeta,
  ): ContractTypesListResponseDto {
    return contractTypesListResponseSchema.parse({
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
