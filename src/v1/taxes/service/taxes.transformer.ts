/**
 * Transformer: the rate arithmetic, Perfex's `default_tax` match, and entity to response DTO. Every
 * DTO is built field by field and then parsed through its zod response schema, which strips any key
 * the schema does not name, so nothing the wire shape does not declare can ride along (T-2-14). The
 * versioned wire shape lives here and in `dto/`; the controller never imports this file (BE-08).
 *
 * The rate is decimal TEXT end to end: `roundRate` rounds in string and integer arithmetic, never
 * through a float, so `'5.555'` is `'5.56'` exactly as MySQL's `DECIMAL(15,2)` would store it.
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import {
  RATE_PATTERN,
  TAXES_RATE_INTEGER_DIGITS,
  taxesListResponseSchema,
  taxesResponseSchema,
  type TaxesListResponseDto,
  type TaxesResponseDto,
} from '../dto/taxes.dto.js';
import type { Tax, TaxRow, TaxUsage } from '../model/taxes.model.js';

export { RATE_PATTERN };

/** Two decimal places: the scale of `DECIMAL(15,2)`. */
const SCALE = 100n;
/** One hundredth, added when the third decimal rounds the second up; none otherwise. */
const ONE_HUNDREDTH = 1n;
const NO_HUNDREDTHS = 0n;
/** The digit at or above which the third decimal rounds the second up (half away from zero). */
const HALF = 5;
/** The two decimal places kept, and the one read to round them. */
const KEPT_PLACES = 2;
const ROUNDING_PLACE = 2;

/** The counts a tax answers when the usage map has no entry for its id. */
export const NO_TAX_USAGE: TaxUsage = {
  items: 0,
  expenses: 0,
  subscriptions: 0,
  vendorItems: 0,
  purchaseLines: 0,
  warehouseLines: 0,
  fixedEquipmentLines: 0,
  salesReturnLines: 0,
  accounting: 0,
};

/** The magnitude of a rate in hundredths, rounded half away from zero, and its sign. */
interface Hundredths {
  readonly negative: boolean;
  readonly value: bigint;
}

/** `'-5.555'` as `{ negative: true, value: 556n }`: the third decimal rounds the second. */
function toHundredths(text: string): Hundredths {
  const negative = text.startsWith('-');
  const [whole = '', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const kept = fraction.padEnd(KEPT_PLACES, '0').slice(0, KEPT_PLACES);
  const roundUp = Number(fraction.charAt(ROUNDING_PLACE) || '0') >= HALF;
  const value =
    BigInt(whole || '0') * SCALE + BigInt(kept) + (roundUp ? ONE_HUNDREDTH : NO_HUNDREDTHS);
  return { negative, value };
}

/**
 * `text` (which matches `RATE_PATTERN`) rounded half away from zero to two places, as two-decimal
 * text: `'15'` is `'15.00'`, `'5.555'` is `'5.56'`, `'-5.555'` is `'-5.56'`, `'.5'` is `'0.50'`. A
 * result of zero is `'0.00'` (never `'-0.00'`). `null` when the rounded rate has more than
 * `TAXES_RATE_INTEGER_DIGITS` integer digits (the column could not hold it), or when `text` is not
 * a rate at all.
 */
export function roundRate(text: string): string | null {
  if (!RATE_PATTERN.test(text)) return null;
  const { negative, value } = toHundredths(text);
  const integer = (value / SCALE).toString();
  if (integer.length > TAXES_RATE_INTEGER_DIGITS) return null;
  const cents = (value % SCALE).toString().padStart(KEPT_PLACES, '0');
  const sign = negative && value !== NO_HUNDREDTHS ? '-' : '';
  return `${sign}${integer}.${cents}`;
}

/**
 * Whether Perfex's `default_tax` option names this tax: Perfex's own test, a substring match of
 * `<name>|<taxrate>` over the stored option (`Taxes_model.php:89-101`), so Node refuses exactly the
 * changes Perfex would have had to rewrite the option for (D-21).
 */
export function isNamedInDefaultTaxes(setting: string, name: string, taxrate: string): boolean {
  return setting.includes(`${name}|${taxrate}`);
}

/** One tax on the wire: the id as text, the rate as stored, its usage and the default flag. */
export function toResponse(row: TaxRow, usage: TaxUsage, isDefault: boolean): TaxesResponseDto {
  return taxesResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    rate: row.taxrate,
    usage,
    isDefault,
  });
}

/** The facade's shape: the rate under its public name. */
export function toTax(row: TaxRow): Tax {
  return { id: row.id, name: row.name, rate: row.taxrate };
}

@Injectable()
export class TaxesTransformer {
  /** One record: `toResponse` with the usage the map holds for it (zeros when none). */
  toResponse(
    row: TaxRow,
    usage: ReadonlyMap<number, TaxUsage>,
    defaultTax: string,
  ): TaxesResponseDto {
    return toResponse(
      row,
      usage.get(row.id) ?? NO_TAX_USAGE,
      isNamedInDefaultTaxes(defaultTax, row.name, row.taxrate),
    );
  }

  /**
   * The list envelope: each row with its usage (zeros when the map has no entry for the id) and its
   * default flag, the four page fields copied one by one (a page object passed as the meta carries
   * nothing else), `exportLimit` and `printLimit` from their one definition.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(
    rows: readonly TaxRow[],
    usage: ReadonlyMap<number, TaxUsage>,
    defaultTax: string,
    meta: ListPageMeta,
  ): TaxesListResponseDto {
    return taxesListResponseSchema.parse({
      data: rows.map((row) => this.toResponse(row, usage, defaultTax)),
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
