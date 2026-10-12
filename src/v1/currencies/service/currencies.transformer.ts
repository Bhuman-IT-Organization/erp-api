/**
 * Transformer: entity to response DTO, the facade's `Currency`, the export rows, and the words of
 * every 409 detail. Every DTO is built field by field and then parsed through its zod response
 * schema, which strips any key the schema does not name, so nothing the wire shape does not declare
 * can ride along (T-2-14). The controller never imports this file (BE-08).
 *
 * The details name counts and plain words only, never a code, a symbol, an id or a price
 * (T-4.1-156). A list of groups is joined as the other Setup lists join theirs: `a, b and c`.
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import { CURRENCIES_EXPORT_COLUMNS } from '../currencies.routes.js';
import {
  currenciesBaseResponseSchema,
  currenciesListResponseSchema,
  currenciesResponseSchema,
  type CurrenciesBaseResponseDto,
  type CurrenciesListResponseDto,
  type CurrenciesResponseDto,
} from '../dto/currencies.dto.js';
import {
  CORE_USAGE_GROUPS,
  type Currency,
  type CurrencyLockUsage,
  type CurrencyReferenceCounts,
  type CurrencyRow,
  type CurrencyUsage,
} from '../model/currencies.model.js';

/** The counts a currency answers when nothing in a delete-counting group refers to it. */
export const NO_CURRENCY_USAGE: CurrencyUsage = {
  invoices: 0,
  expenses: 0,
  proposals: 0,
  estimates: 0,
  customers: 0,
  creditNotes: 0,
  subscriptions: 0,
  purchaseOrders: 0,
  purchaseRequests: 0,
  purchaseQuotations: 0,
  purchaseInvoices: 0,
  debitNotes: 0,
  fafRequests: 0,
  vendors: 0,
  goodsReceipts: 0,
  goodsDeliveries: 0,
  packingLists: 0,
  orderReturns: 0,
  fixedEquipmentCarts: 0,
  payslipsFrom: 0,
  payslipsTo: 0,
  purchaseConvertedFrom: 0,
  purchaseConvertedTo: 0,
  fixedEquipmentLocations: 0,
};

/** The lock-only counts of a currency nothing refers to. */
export const NO_CURRENCY_LOCK_USAGE: CurrencyLockUsage = {
  exchangeRates: 0,
  exchangeRateLogs: 0,
  payslipCodes: 0,
};

/** Both halves at zero: what an id absent from a usage answer reads as on a list row. */
export const NO_CURRENCY_REFERENCES: CurrencyReferenceCounts = {
  usage: NO_CURRENCY_USAGE,
  lockUsage: NO_CURRENCY_LOCK_USAGE,
};

/** Each delete-counting group's words in a 409 detail, in the order the detail lists them. */
export const USAGE_WORDS = [
  ['invoices', 'invoice(s)'],
  ['expenses', 'expense(s)'],
  ['proposals', 'proposal(s)'],
  ['estimates', 'estimate(s)'],
  ['customers', 'customer(s)'],
  ['creditNotes', 'credit note(s)'],
  ['subscriptions', 'subscription(s)'],
  ['purchaseOrders', 'purchase order(s)'],
  ['purchaseRequests', 'purchase request(s)'],
  ['purchaseQuotations', 'purchase quotation(s)'],
  ['purchaseInvoices', 'purchase invoice(s)'],
  ['debitNotes', 'debit note(s)'],
  ['fafRequests', 'FAF request(s)'],
  ['vendors', 'vendor(s)'],
  ['goodsReceipts', 'goods receipt(s)'],
  ['goodsDeliveries', 'goods delivery note(s)'],
  ['packingLists', 'packing list(s)'],
  ['orderReturns', 'order return(s)'],
  ['fixedEquipmentCarts', 'fixed equipment cart(s)'],
  ['payslipsFrom', 'payslip(s) converted from it'],
  ['payslipsTo', 'payslip(s) paid in it'],
  ['purchaseConvertedFrom', 'purchase document(s) converted from it'],
  ['purchaseConvertedTo', 'purchase document(s) converted to it'],
  ['fixedEquipmentLocations', 'fixed equipment location(s)'],
] as const satisfies readonly (readonly [keyof CurrencyUsage, string])[];

/** Each lock-only group's words in the 0005 detail, after the delete-counting groups. */
export const LOCK_USAGE_WORDS = [
  ['exchangeRates', 'exchange rate reference(s)'],
  ['exchangeRateLogs', 'exchange rate log reference(s)'],
  ['payslipCodes', 'payslip(s) showing its code'],
] as const satisfies readonly (readonly [keyof CurrencyLockUsage, string])[];

/** The detail when a count could not be read: an unknown count refuses (fail closed). */
export const NOT_COUNTED = 'its use could not be counted';

/** The 0002 detail: Perfex refuses to delete the base currency. */
export const BASE_DETAIL = 'it is the base currency; make another currency the base first';

/** One registered counter's answer for one currency: its key, its noun and the number. */
export interface RegisteredCount {
  readonly key: string;
  readonly noun: string;
  readonly count: number;
}

/** One exported row: the three export columns. */
export interface CurrencyExportRow {
  readonly name: string;
  readonly symbol: string;
  readonly isBase: boolean;
}

/**
 * Each export column's cell over the exported row, keyed by the column name, so the column list in
 * `currencies.routes.ts` and what is written under it cannot drift (`satisfies`). `name` and
 * `symbol` are text; `isBase` is a boolean cell.
 */
export const CURRENCIES_EXPORT_CELLS = {
  name: { value: (row) => row.name },
  symbol: { value: (row) => row.symbol },
  isBase: { value: (row) => row.isBase },
} as const satisfies Record<
  (typeof CURRENCIES_EXPORT_COLUMNS)[number],
  ExportCell<CurrencyExportRow>
>;

/**
 * `a`, `a and b`, `a, b and c`: the join every Setup list's detail uses; `null` for no part.
 *
 * @complexity O(n) over the parts
 */
function joinParts(parts: readonly string[]): string | null {
  const last = parts.at(-1);
  if (last === undefined) return null;
  const head = parts.slice(0, -1);
  return head.length === 0 ? last : `${head.join(', ')} and ${last}`;
}

/**
 * `N <words>` for each group of `words` whose count is above 0, in the words' order.
 *
 * @complexity O(g) over the groups
 */
function countedParts<K extends string>(
  counts: Readonly<Record<K, number>>,
  words: readonly (readonly [K, string])[],
): string[] {
  return words
    .filter(([group]) => counts[group] > 0)
    .map(([group, label]) => `${String(counts[group])} ${label}`);
}

/**
 * `N <noun>(s)` for each registered counter above 0, in the order given (the registry's key order).
 *
 * @complexity O(r) over the counters
 */
function registeredParts(registered: readonly RegisteredCount[]): string[] {
  return registered
    .filter((entry) => entry.count > 0)
    .map((entry) => `${String(entry.count)} ${entry.noun}(s)`);
}

/**
 * The sum of Perfex's seven core groups (D-39's input).
 *
 * @complexity O(7)
 */
export function coreInUse(usage: CurrencyUsage): number {
  return CORE_USAGE_GROUPS.reduce((sum, group) => sum + usage[group], 0);
}

/** The non-zero delete-counting groups' words, in order (the 0001 list). */
export function inUseGroups(usage: CurrencyUsage): readonly string[] {
  return countedParts(usage, USAGE_WORDS);
}

/** The non-zero lock-only groups' words, in order. */
export function lockGroups(lockUsage: CurrencyLockUsage): readonly string[] {
  return countedParts(lockUsage, LOCK_USAGE_WORDS);
}

/**
 * Answer 8 c: true when any delete-counting group, any lock-only group or any registered counter
 * is above 0. Any use at all locks the code.
 *
 * @complexity O(g + r) over the groups and the counters
 */
export function isInUseAtAll(
  usage: CurrencyUsage,
  lockUsage: CurrencyLockUsage,
  registeredUsage: Readonly<Record<string, number>>,
): boolean {
  return (
    inUseGroups(usage).length > 0 ||
    lockGroups(lockUsage).length > 0 ||
    Object.values(registeredUsage).some((count) => count > 0)
  );
}

/** The 0001 detail (delete), or `null` when no delete-counting group holds the currency. */
export function inUseDetail(usage: CurrencyUsage): string | null {
  const list = joinParts(inUseGroups(usage));
  return list === null ? null : `used by ${list}`;
}

/** The 0003 detail (delete), or `null` when every registered counter answered 0. */
export function registeredDetail(registered: readonly RegisteredCount[]): string | null {
  const list = joinParts(registeredParts(registered));
  return list === null ? null : `used by ${list}; remove them first`;
}

/** The 0004 detail (make-base), or `null` when the base has no use in Perfex's seven core groups. */
export function baseLockedDetail(baseUsage: CurrencyUsage): string | null {
  const core = USAGE_WORDS.filter(([group]) =>
    (CORE_USAGE_GROUPS as readonly string[]).includes(group),
  );
  const list = joinParts(countedParts(baseUsage, core));
  return list === null
    ? null
    : `the base currency is used by ${list}; Perfex does not allow changing the base currency once it has transactions`;
}

/** The 0005 detail (a code change), or `null` when nothing at all uses the currency (answer 8 c). */
export function codeLockedDetail(
  counts: CurrencyReferenceCounts,
  registered: readonly RegisteredCount[],
): string | null {
  const list = joinParts([
    ...inUseGroups(counts.usage),
    ...lockGroups(counts.lockUsage),
    ...registeredParts(registered),
  ]);
  return list === null
    ? null
    : `it is in use (${list}), so its code cannot change: past records would show another code; the symbol, the separators and the placement can`;
}

/**
 * The registered counters' answers as the wire's `registeredUsage` record, keyed by counter key.
 *
 * @complexity O(r) over the counters
 */
export function registeredRecord(registered: readonly RegisteredCount[]): Record<string, number> {
  return Object.fromEntries(registered.map((entry) => [entry.key, entry.count]));
}

/** One currency on the wire: the id as text, the stored fields, every count and `canMakeBase`. */
export function toResponse(
  row: CurrencyRow,
  counts: CurrencyReferenceCounts,
  registered: readonly RegisteredCount[],
  baseLocked: boolean,
): CurrenciesResponseDto {
  return currenciesResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    symbol: row.symbol,
    decimalSeparator: row.decimalSeparator,
    thousandSeparator: row.thousandSeparator,
    placement: row.placement,
    isBase: row.isBase,
    usage: counts.usage,
    lockUsage: counts.lockUsage,
    registeredUsage: registeredRecord(registered),
    canMakeBase: !row.isBase && !baseLocked,
  });
}

/** One exported row: the code, the symbol and whether it is the base; never a count. */
export function toExportRow(row: CurrencyRow): CurrencyExportRow {
  return { name: row.name, symbol: row.symbol, isBase: row.isBase };
}

/** The facade's shape (D-44): the stored fields, `isBase` a boolean; never a count or the DTO. */
export function toCurrency(row: CurrencyRow): Currency {
  return {
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    decimalSeparator: row.decimalSeparator,
    thousandSeparator: row.thousandSeparator,
    placement: row.placement,
    isBase: row.isBase,
  };
}

@Injectable()
export class CurrenciesTransformer {
  /**
   * The list envelope: each row with its counts (zeros when the map has no entry for the id), the
   * registered counters' answers for its id and `canMakeBase` from the page's one base state; the
   * four page fields copied one by one, `exportLimit` and `printLimit` from their one definition.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(
    rows: readonly CurrencyRow[],
    counts: ReadonlyMap<number, CurrencyReferenceCounts>,
    registered: ReadonlyMap<number, readonly RegisteredCount[]>,
    baseLocked: boolean,
    meta: ListPageMeta,
  ): CurrenciesListResponseDto {
    return currenciesListResponseSchema.parse({
      data: rows.map((row) =>
        toResponse(
          row,
          counts.get(row.id) ?? NO_CURRENCY_REFERENCES,
          registered.get(row.id) ?? [],
          baseLocked,
        ),
      ),
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

  /** The make-base answer: the id as text and `isBase: true`. */
  toBaseResponse(id: number): CurrenciesBaseResponseDto {
    return currenciesBaseResponseSchema.parse({ id: String(id), isBase: true });
  }
}
