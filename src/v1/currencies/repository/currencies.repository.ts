/**
 * Repository: the module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Owner of the one table it writes (ADR-0029; `ownership.json` since plan 04.1-27, W2A-05):
 *   `tblcurrencies`   node: Perfex's five form columns, `name` (the ISO code, `VARCHAR(100)`),
 *                     `symbol` (`VARCHAR(10)`), `decimal_separator` and `thousand_separator`
 *                     (`VARCHAR(5)`), `placement` (`VARCHAR(10)`), written by a create and rewritten
 *                     whole by an update (Perfex's edit rewrites every field); and `isdefault`, the
 *                     base flag, written ONLY by the make-base switch (`setBase`), which sets it on
 *                     one row and clears it on every other in one database transaction, as
 *                     `Currencies_model.php` :153-161 does. `id` is assigned by the database. Every
 *                     read and write goes through the typed delegate, which the ownership guard
 *                     admits because the register names `node`.
 *
 * `CURRENCY_REFERENCES`: the ONE reference register (D-40, Currencies planning answer 1). Every
 * column that refers to a currency is listed once, with its group, its match kind and whether it
 * counts for a delete. Each is a Perfex or Perfex-module column, read only and never written. Every
 * kind is confirmed from the code that writes the column, read-only:
 *
 *   group                    owner (register)   table.column                          kind        delete
 *   invoices                 unattributed       tblinvoices.currency                  integerId   yes
 *   expenses                 perfex-core        tblexpenses.currency                  integerId   yes
 *   proposals                perfex-core        tblproposals.currency                 integerId   yes
 *   estimates                perfex-core        tblestimates.currency                 integerId   yes
 *   customers                unattributed       tblclients.default_currency           integerId   yes
 *   creditNotes              perfex-core        tblcreditnotes.currency               integerId   yes
 *   subscriptions            perfex-core        tblsubscriptions.currency             integerId   yes
 *     (the seven above are Perfex's own list, `App.php:518-547`, and the make-base rule's input)
 *   purchaseOrders           purchase           tblpur_orders.currency                integerId   yes
 *   purchaseRequests         purchase           tblpur_request.currency               integerId   yes
 *   purchaseQuotations       purchase           tblpur_estimates.currency             integerId   yes
 *   purchaseInvoices         purchase           tblpur_invoices.currency              integerId   yes
 *   debitNotes               purchase           tblpur_debit_notes.currency           integerId   yes
 *   fafRequests              purchase           tblpur_faf_requests.currency          integerId   yes
 *   vendors                  unattributed       tblpur_vendor.default_currency        integerId   yes
 *   goodsReceipts            warehouse          tblgoods_receipt.currency             integerId   yes
 *   goodsDeliveries          warehouse          tblgoods_delivery.currency            integerId   yes
 *   packingLists             warehouse          tblwh_packing_lists.currency          integerId   yes
 *   orderReturns             unattributed       tblwh_order_returns.currency          integerId   yes
 *   fixedEquipmentCarts      fixed_equipment    tblfe_cart.currency                   integerId   yes
 *   payslipsFrom             hr_payroll         tblhrp_payslips.from_currency_id      integerId   yes
 *   payslipsTo               hr_payroll         tblhrp_payslips.to_currency_id        integerId   yes
 *   purchaseConvertedFrom    purchase           tblpur_request, tblpur_estimates,     idAsText    yes
 *                                               tblpur_orders, tblpur_invoices
 *                                               .from_currency (four lines)
 *   purchaseConvertedTo      purchase           the same four tables .to_currency     idAsText    yes
 *   fixedEquipmentLocations  fixed_equipment    tblfe_locations.location_currency     idAsText    yes
 *   exchangeRates            unattributed       tblcurrency_rates.from_currency_id,   integerId   no
 *                                               .to_currency_id
 *                                               tblcurrency_rates.from_currency_name, codeAsText  no
 *                                               .to_currency_name
 *   exchangeRateLogs         unattributed       tblcurrency_rate_logs, the same four  as above    no
 *   payslipCodes             hr_payroll         tblhrp_payslips.from_currency_name,   codeAsText  no
 *                                               .to_currency_name (snapshots)
 *
 * The kinds. `integerId`: the column holds the currency's id as an integer. `idAsText`: a text
 * column holding the id's decimal text (purchase writes `to_currency` from the posted currency id,
 * `Purchase_model.php` :1256, :1396, :1791, :2004, and its forms post the base currency's id as
 * `from_currency`; fixed_equipment's location select is valued by id). `codeAsText`: a text column
 * holding the currency's CODE (the `name` column), written from the currency row by each module's
 * rate generator and by the payslip snapshot.
 *
 * Why the exchange rates never count for a delete (D-40): they are configuration and history, as the
 * accounting mappings were for D-33; Perfex counts only its seven core columns. They and the payslip
 * code snapshots still lock a code change (D-42 widened, answer 2): a renamed code would orphan the
 * by-code lookups and change what past documents show. Not in the register:
 * `tblcheque_management.currency` (answer 3: no code writes it; a line is added if a writer appears)
 * and `tblacc_checks.currency_display_name` (a typed label, not a reference).
 *
 * Exact matching (T-4.1-148). An integer line on an integer column binds the page ids as numbers. An
 * integer line the probe answers with any other type, and every `idAsText` line, compares the bytes
 * with `CAST(r.<c> AS BINARY) IN (...)` against each id's decimal text, so no collation folds case or
 * pads spaces and no numeric conversion reads `'07'`, `'7 '` or `' 7'` as 7. A `codeAsText` line
 * binds the page rows' STORED codes and compares the bytes the same way, so `usd` and `USD ` never
 * count for `USD`. An answer counts only when it is exactly a page id (a number equal to it, or text
 * byte-equal to its decimal text) or, for a code line, byte-equal to a page row's stored code. Never
 * a LIKE, a collation compare or a trim.
 *
 * The runtime probe (D-28, applied by D-40): before every usage read, ONE statement over
 * `information_schema.COLUMNS` (every register table and column name BOUND, never SQL text) answers
 * which lines exist in the connected schema and with which `DATA_TYPE`; only those run, and a missing
 * one counts 0 and raises no error. It is never cached: a module's table may be absent from one
 * install and present in another, and when a later slice adds or migrates a column this module counts
 * it with no code change. This module never adds or drops a column anywhere (Perfex's delete dropped
 * the warehouse's `tblitems.rate_currency_<id>` column; Node never does: D-28, D-41).
 *
 * Each present line is ONE tagged `$queryRaw`, the table and column literal SQL text and the values
 * bound with `Prisma.join` (no unsafe or raw-text variant, and no write keyword: the ownership guard
 * reads one as a write), all in one `Promise.all`.
 *
 * Fail closed: an error from the probe or from any statement is not caught, so `usageByCurrency`
 * rejects. The list then answers its retryable error, and a delete or a code change is refused,
 * never allowed on a count nobody could read.
 *
 * Every row is re-parsed through its zod schema, never trusted from the generic (BE-11).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { Prisma } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import type { DbTransaction } from '../../../shared/db/transaction.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import {
  CURRENCIES_FACADE_MAX_ROWS,
  type CurrenciesListRequest,
  type CurrenciesPage,
  type CurrenciesSortField,
  type CurrencyLockUsage,
  type CurrencyReferenceCounts,
  type CurrencyRow,
  type CurrencyUsage,
  type NewCurrency,
} from '../model/currencies.model.js';
import { NO_CURRENCY_LOCK_USAGE, NO_CURRENCY_USAGE } from '../service/currencies.transformer.js';

/** Prisma's "record to update not found". */
const RECORD_NOT_FOUND = 'P2025';

/** The largest value of MySQL's signed `INT` (the id column): a longer all-digit `q` is not an id. */
const MAX_INT_ID = 2_147_483_647;

/** The `information_schema.COLUMNS.DATA_TYPE` values an integer line is compared as numbers on. */
const INTEGER_TYPES: ReadonlySet<string> = new Set([
  'tinyint',
  'smallint',
  'mediumint',
  'int',
  'integer',
  'bigint',
]);

/** The seven columns of the table; nothing else is selected. */
const COLUMNS = {
  id: true,
  name: true,
  symbol: true,
  decimal_separator: true,
  thousand_separator: true,
  placement: true,
  isdefault: true,
} as const;

const rowSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    symbol: z.string(),
    decimal_separator: z.string().nullable(),
    thousand_separator: z.string().nullable(),
    placement: z.string().nullable(),
    isdefault: z.boolean(),
  })
  .transform((row): CurrencyRow => ({
    id: row.id,
    name: row.name,
    symbol: row.symbol,
    decimalSeparator: row.decimal_separator,
    thousandSeparator: row.thousand_separator,
    placement: row.placement,
    isBase: row.isdefault,
  }));
const rowsSchema = z.array(rowSchema);

/** `COUNT(*)` and an integer column arrive from MySQL as a bigint or a number. */
const integerSchema = z.union([z.bigint(), z.number().int()]).transform(Number);
/** An answer of a statement compared as numbers: the column's integer and its count. */
const valueRowsSchema = z.array(z.object({ id: integerSchema, n: integerSchema }));
/** An answer of a statement compared as bytes: the column's stored text and its count. */
const textRowsSchema = z.array(z.object({ id: z.string(), n: integerSchema }));
const presentColumnsSchema = z.array(z.object({ t: z.string(), c: z.string(), d: z.string() }));

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];
type RawClient = PrismaService['client'];

/** How a register line holds the currency (the docblock's kinds). */
export type CurrencyMatch = 'integerId' | 'idAsText' | 'codeAsText';

/** A register group: a delete-counting `usage` group or a lock-only `lockUsage` group. */
export type CurrencyReferenceGroup = keyof CurrencyUsage | keyof CurrencyLockUsage;

/** One line of the register: the group it counts toward, where it lives, how it matches, its statements. */
export interface CurrencyReference {
  readonly group: CurrencyReferenceGroup;
  readonly table: string;
  readonly column: string;
  readonly match: CurrencyMatch;
  /** Whether the line counts for a delete (D-40); every line locks a code change (D-42 widened). */
  readonly countsForDelete: boolean;
  /** `integerId` lines only: `WHERE r.<c> IN (<ids bound as numbers>)`, rows `{ id, n }`. */
  readonly byValue?: (client: RawClient, values: Prisma.Sql) => Promise<unknown>;
  /** `WHERE CAST(r.<c> AS BINARY) IN (<texts bound>)`, rows `{ id, n }` with `id` the stored text. */
  readonly byBytes: (client: RawClient, values: Prisma.Sql) => Promise<unknown>;
}

/** One currency's counts while the answers are summed into them. */
interface MutableCounts {
  readonly usage: Record<keyof CurrencyUsage, number>;
  readonly lockUsage: Record<keyof CurrencyLockUsage, number>;
}

/**
 * The register (Currencies planning answer 1): every line once, in the detail's order. A column a
 * later finding adds joins here in the same shape; the probe decides at every read whether it runs.
 */
export const CURRENCY_REFERENCES: readonly CurrencyReference[] = Object.freeze([
  {
    group: 'invoices',
    table: 'tblinvoices',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblinvoices r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblinvoices r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'expenses',
    table: 'tblexpenses',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblexpenses r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblexpenses r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'proposals',
    table: 'tblproposals',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblproposals r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblproposals r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'estimates',
    table: 'tblestimates',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblestimates r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblestimates r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'customers',
    table: 'tblclients',
    column: 'default_currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.default_currency AS id, COUNT(*) AS n FROM tblclients r WHERE r.default_currency IN (${values}) GROUP BY r.default_currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.default_currency AS id, COUNT(*) AS n FROM tblclients r WHERE CAST(r.default_currency AS BINARY) IN (${values}) GROUP BY r.default_currency`,
  },
  {
    group: 'creditNotes',
    table: 'tblcreditnotes',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblcreditnotes r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblcreditnotes r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'subscriptions',
    table: 'tblsubscriptions',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblsubscriptions r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblsubscriptions r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'purchaseOrders',
    table: 'tblpur_orders',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblpur_orders r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblpur_orders r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'purchaseRequests',
    table: 'tblpur_request',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblpur_request r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblpur_request r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'purchaseQuotations',
    table: 'tblpur_estimates',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblpur_estimates r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblpur_estimates r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'purchaseInvoices',
    table: 'tblpur_invoices',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblpur_invoices r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblpur_invoices r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'debitNotes',
    table: 'tblpur_debit_notes',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblpur_debit_notes r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblpur_debit_notes r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'fafRequests',
    table: 'tblpur_faf_requests',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblpur_faf_requests r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblpur_faf_requests r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'vendors',
    table: 'tblpur_vendor',
    column: 'default_currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.default_currency AS id, COUNT(*) AS n FROM tblpur_vendor r WHERE r.default_currency IN (${values}) GROUP BY r.default_currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.default_currency AS id, COUNT(*) AS n FROM tblpur_vendor r WHERE CAST(r.default_currency AS BINARY) IN (${values}) GROUP BY r.default_currency`,
  },
  {
    group: 'goodsReceipts',
    table: 'tblgoods_receipt',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblgoods_receipt r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblgoods_receipt r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'goodsDeliveries',
    table: 'tblgoods_delivery',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblgoods_delivery r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblgoods_delivery r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'packingLists',
    table: 'tblwh_packing_lists',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblwh_packing_lists r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblwh_packing_lists r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'orderReturns',
    table: 'tblwh_order_returns',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblwh_order_returns r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblwh_order_returns r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'fixedEquipmentCarts',
    table: 'tblfe_cart',
    column: 'currency',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblfe_cart r WHERE r.currency IN (${values}) GROUP BY r.currency`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.currency AS id, COUNT(*) AS n FROM tblfe_cart r WHERE CAST(r.currency AS BINARY) IN (${values}) GROUP BY r.currency`,
  },
  {
    group: 'payslipsFrom',
    table: 'tblhrp_payslips',
    column: 'from_currency_id',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.from_currency_id AS id, COUNT(*) AS n FROM tblhrp_payslips r WHERE r.from_currency_id IN (${values}) GROUP BY r.from_currency_id`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.from_currency_id AS id, COUNT(*) AS n FROM tblhrp_payslips r WHERE CAST(r.from_currency_id AS BINARY) IN (${values}) GROUP BY r.from_currency_id`,
  },
  {
    group: 'payslipsTo',
    table: 'tblhrp_payslips',
    column: 'to_currency_id',
    match: 'integerId',
    countsForDelete: true,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.to_currency_id AS id, COUNT(*) AS n FROM tblhrp_payslips r WHERE r.to_currency_id IN (${values}) GROUP BY r.to_currency_id`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.to_currency_id AS id, COUNT(*) AS n FROM tblhrp_payslips r WHERE CAST(r.to_currency_id AS BINARY) IN (${values}) GROUP BY r.to_currency_id`,
  },
  {
    group: 'purchaseConvertedFrom',
    table: 'tblpur_request',
    column: 'from_currency',
    match: 'idAsText',
    countsForDelete: true,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.from_currency AS id, COUNT(*) AS n FROM tblpur_request r WHERE CAST(r.from_currency AS BINARY) IN (${values}) GROUP BY r.from_currency`,
  },
  {
    group: 'purchaseConvertedFrom',
    table: 'tblpur_estimates',
    column: 'from_currency',
    match: 'idAsText',
    countsForDelete: true,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.from_currency AS id, COUNT(*) AS n FROM tblpur_estimates r WHERE CAST(r.from_currency AS BINARY) IN (${values}) GROUP BY r.from_currency`,
  },
  {
    group: 'purchaseConvertedFrom',
    table: 'tblpur_orders',
    column: 'from_currency',
    match: 'idAsText',
    countsForDelete: true,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.from_currency AS id, COUNT(*) AS n FROM tblpur_orders r WHERE CAST(r.from_currency AS BINARY) IN (${values}) GROUP BY r.from_currency`,
  },
  {
    group: 'purchaseConvertedFrom',
    table: 'tblpur_invoices',
    column: 'from_currency',
    match: 'idAsText',
    countsForDelete: true,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.from_currency AS id, COUNT(*) AS n FROM tblpur_invoices r WHERE CAST(r.from_currency AS BINARY) IN (${values}) GROUP BY r.from_currency`,
  },
  {
    group: 'purchaseConvertedTo',
    table: 'tblpur_request',
    column: 'to_currency',
    match: 'idAsText',
    countsForDelete: true,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.to_currency AS id, COUNT(*) AS n FROM tblpur_request r WHERE CAST(r.to_currency AS BINARY) IN (${values}) GROUP BY r.to_currency`,
  },
  {
    group: 'purchaseConvertedTo',
    table: 'tblpur_estimates',
    column: 'to_currency',
    match: 'idAsText',
    countsForDelete: true,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.to_currency AS id, COUNT(*) AS n FROM tblpur_estimates r WHERE CAST(r.to_currency AS BINARY) IN (${values}) GROUP BY r.to_currency`,
  },
  {
    group: 'purchaseConvertedTo',
    table: 'tblpur_orders',
    column: 'to_currency',
    match: 'idAsText',
    countsForDelete: true,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.to_currency AS id, COUNT(*) AS n FROM tblpur_orders r WHERE CAST(r.to_currency AS BINARY) IN (${values}) GROUP BY r.to_currency`,
  },
  {
    group: 'purchaseConvertedTo',
    table: 'tblpur_invoices',
    column: 'to_currency',
    match: 'idAsText',
    countsForDelete: true,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.to_currency AS id, COUNT(*) AS n FROM tblpur_invoices r WHERE CAST(r.to_currency AS BINARY) IN (${values}) GROUP BY r.to_currency`,
  },
  {
    group: 'fixedEquipmentLocations',
    table: 'tblfe_locations',
    column: 'location_currency',
    match: 'idAsText',
    countsForDelete: true,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.location_currency AS id, COUNT(*) AS n FROM tblfe_locations r WHERE CAST(r.location_currency AS BINARY) IN (${values}) GROUP BY r.location_currency`,
  },
  {
    group: 'exchangeRates',
    table: 'tblcurrency_rates',
    column: 'from_currency_id',
    match: 'integerId',
    countsForDelete: false,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.from_currency_id AS id, COUNT(*) AS n FROM tblcurrency_rates r WHERE r.from_currency_id IN (${values}) GROUP BY r.from_currency_id`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.from_currency_id AS id, COUNT(*) AS n FROM tblcurrency_rates r WHERE CAST(r.from_currency_id AS BINARY) IN (${values}) GROUP BY r.from_currency_id`,
  },
  {
    group: 'exchangeRates',
    table: 'tblcurrency_rates',
    column: 'to_currency_id',
    match: 'integerId',
    countsForDelete: false,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.to_currency_id AS id, COUNT(*) AS n FROM tblcurrency_rates r WHERE r.to_currency_id IN (${values}) GROUP BY r.to_currency_id`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.to_currency_id AS id, COUNT(*) AS n FROM tblcurrency_rates r WHERE CAST(r.to_currency_id AS BINARY) IN (${values}) GROUP BY r.to_currency_id`,
  },
  {
    group: 'exchangeRates',
    table: 'tblcurrency_rates',
    column: 'from_currency_name',
    match: 'codeAsText',
    countsForDelete: false,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.from_currency_name AS id, COUNT(*) AS n FROM tblcurrency_rates r WHERE CAST(r.from_currency_name AS BINARY) IN (${values}) GROUP BY r.from_currency_name`,
  },
  {
    group: 'exchangeRates',
    table: 'tblcurrency_rates',
    column: 'to_currency_name',
    match: 'codeAsText',
    countsForDelete: false,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.to_currency_name AS id, COUNT(*) AS n FROM tblcurrency_rates r WHERE CAST(r.to_currency_name AS BINARY) IN (${values}) GROUP BY r.to_currency_name`,
  },
  {
    group: 'exchangeRateLogs',
    table: 'tblcurrency_rate_logs',
    column: 'from_currency_id',
    match: 'integerId',
    countsForDelete: false,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.from_currency_id AS id, COUNT(*) AS n FROM tblcurrency_rate_logs r WHERE r.from_currency_id IN (${values}) GROUP BY r.from_currency_id`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.from_currency_id AS id, COUNT(*) AS n FROM tblcurrency_rate_logs r WHERE CAST(r.from_currency_id AS BINARY) IN (${values}) GROUP BY r.from_currency_id`,
  },
  {
    group: 'exchangeRateLogs',
    table: 'tblcurrency_rate_logs',
    column: 'to_currency_id',
    match: 'integerId',
    countsForDelete: false,
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.to_currency_id AS id, COUNT(*) AS n FROM tblcurrency_rate_logs r WHERE r.to_currency_id IN (${values}) GROUP BY r.to_currency_id`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.to_currency_id AS id, COUNT(*) AS n FROM tblcurrency_rate_logs r WHERE CAST(r.to_currency_id AS BINARY) IN (${values}) GROUP BY r.to_currency_id`,
  },
  {
    group: 'exchangeRateLogs',
    table: 'tblcurrency_rate_logs',
    column: 'from_currency_name',
    match: 'codeAsText',
    countsForDelete: false,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.from_currency_name AS id, COUNT(*) AS n FROM tblcurrency_rate_logs r WHERE CAST(r.from_currency_name AS BINARY) IN (${values}) GROUP BY r.from_currency_name`,
  },
  {
    group: 'exchangeRateLogs',
    table: 'tblcurrency_rate_logs',
    column: 'to_currency_name',
    match: 'codeAsText',
    countsForDelete: false,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.to_currency_name AS id, COUNT(*) AS n FROM tblcurrency_rate_logs r WHERE CAST(r.to_currency_name AS BINARY) IN (${values}) GROUP BY r.to_currency_name`,
  },
  {
    group: 'payslipCodes',
    table: 'tblhrp_payslips',
    column: 'from_currency_name',
    match: 'codeAsText',
    countsForDelete: false,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.from_currency_name AS id, COUNT(*) AS n FROM tblhrp_payslips r WHERE CAST(r.from_currency_name AS BINARY) IN (${values}) GROUP BY r.from_currency_name`,
  },
  {
    group: 'payslipCodes',
    table: 'tblhrp_payslips',
    column: 'to_currency_name',
    match: 'codeAsText',
    countsForDelete: false,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.to_currency_name AS id, COUNT(*) AS n FROM tblhrp_payslips r WHERE CAST(r.to_currency_name AS BINARY) IN (${values}) GROUP BY r.to_currency_name`,
  },
]);

/** The key a line answers by: `table.column`, as declared. */
export function referenceKey(reference: Pick<CurrencyReference, 'table' | 'column'>): string {
  return `${reference.table}.${reference.column}`;
}

/** Whether a group is a delete-counting `usage` group (else a lock-only `lockUsage` group). */
function isUsageGroup(group: CurrencyReferenceGroup): group is keyof CurrencyUsage {
  return Object.hasOwn(NO_CURRENCY_USAGE, group);
}

/** `?q=`: the code or the symbol contains it; an all-digit `q` that fits the id column also matches the id. */
function matchOf(search: string | null): WhereValue {
  if (search === null) return {};
  const or: WhereValue[] = [{ name: { contains: search } }, { symbol: { contains: search } }];
  if (/^\d+$/.test(search) && Number(search) <= MAX_INT_ID) or.push({ id: Number(search) });
  return { OR: or };
}

function keyOf(row: CurrencyRow, sortField: CurrenciesSortField): Key {
  if (sortField === 'name') return [row.name, row.id];
  if (sortField === 'symbol') return [row.symbol, row.id];
  return [row.id, row.id];
}

/** A `before` cursor reads the rows just before it in the reversed order, then reverses them back. */
function readDirection(request: CurrenciesListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

/** Next exists while rows remain after the page, Previous while rows exist before it. */
function pageMeta(
  sortField: CurrenciesSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<CurrenciesPage, 'items'> {
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

/** Adds `n` to one group of one currency's counts. */
function addTo(counts: MutableCounts | undefined, group: CurrencyReferenceGroup, n: number): void {
  if (counts === undefined) return;
  if (isUsageGroup(group)) counts.usage[group] += n;
  else counts.lockUsage[group] += n;
}

/** What a page's rows bind and how an answer is matched back to them. */
interface PageKeys {
  readonly totals: ReadonlyMap<number, MutableCounts>;
  /** A page id's decimal text -> the id. */
  readonly idTexts: ReadonlyMap<string, number>;
  /** A stored code -> every page id holding it (two currencies may share a code). */
  readonly codes: ReadonlyMap<string, readonly number[]>;
}

/**
 * Adds one statement's rows to the line's group: an integer answer counts only when it is a page id;
 * a text answer of an id line only when it is byte-equal to a page id's decimal text; a text answer
 * of a code line only when it is byte-equal to a page row's stored code (for every row holding it).
 *
 * @complexity O(r) over the answer's rows (a shared code adds one step per row holding it)
 */
function addAnswer(
  keys: PageKeys,
  reference: CurrencyReference,
  numeric: boolean,
  answer: unknown,
): void {
  if (numeric) {
    for (const { id, n } of valueRowsSchema.parse(answer)) {
      addTo(keys.totals.get(id), reference.group, n);
    }
    return;
  }
  for (const { id, n } of textRowsSchema.parse(answer)) {
    const ids = reference.match === 'codeAsText' ? keys.codes.get(id) : [keys.idTexts.get(id)];
    addToEach(keys, reference.group, ids ?? [], n);
  }
}

/** `addTo` for each id of a matched answer (`undefined` ids are no match). */
function addToEach(
  keys: PageKeys,
  group: CurrencyReferenceGroup,
  ids: readonly (number | undefined)[],
  n: number,
): void {
  ids.forEach((id) => {
    if (id !== undefined) addTo(keys.totals.get(id), group, n);
  });
}

/** The ids of the rows holding one code (named, so the caller's `map` holds no nested callback). */
function idsOf(holders: readonly Pick<CurrencyRow, 'id'>[]): number[] {
  return holders.map((row) => row.id);
}

/**
 * The page's ids, their decimal texts and its stored codes.
 *
 * @complexity O(n) over the page's rows
 */
function pageKeys(rows: readonly Pick<CurrencyRow, 'id' | 'name'>[]): PageKeys {
  const totals = new Map<number, MutableCounts>(
    rows.map((row) => [
      row.id,
      { usage: { ...NO_CURRENCY_USAGE }, lockUsage: { ...NO_CURRENCY_LOCK_USAGE } },
    ]),
  );
  const idTexts = new Map(rows.map((row) => [String(row.id), row.id]));
  const codes = Map.groupBy(rows, (row) => row.name);
  return {
    totals,
    idTexts,
    codes: new Map([...codes].map(([code, holders]) => [code, idsOf(holders)])),
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

/** The five columns a create or an update writes; never `isdefault`. */
function dataOf(input: NewCurrency) {
  return {
    name: input.name,
    symbol: input.symbol,
    decimal_separator: input.decimalSeparator,
    thousand_separator: input.thousandSeparator,
    placement: input.placement,
  };
}

@Injectable()
export class CurrenciesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One keyset page ordered by `(sort column, id)`, then `total` (the match without the cursor) and
   * the rank of the first row, both through `count`.
   */
  async list(request: CurrenciesListRequest): Promise<CurrenciesPage> {
    const { sortField, order, cursor, limit } = request;
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.prisma.client.tblcurrencies.findMany({
      where:
        cursor === null ? match : { AND: [match, keysetWhere(sortField, 'id', cursor, order)] },
      orderBy: [{ [sortField]: read }, { id: read }],
      take: limit,
      select: COLUMNS,
    });
    const items = rowsSchema.parse(rows);
    if (read !== order) items.reverse();
    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tblcurrencies.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblcurrencies.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  sortField,
                  'id',
                  { sort: sortField, key: first, direction: 'before' },
                  order,
                ),
              ],
            },
          }),
    ]);
    return { items, ...pageMeta(sortField, keys, total, before) };
  }

  /** The list's own match without the cursor: what the export counts before it reads a row. */
  count(request: CurrenciesListRequest): Promise<number> {
    return this.prisma.client.tblcurrencies.count({ where: matchOf(request.search) });
  }

  /** One row in its stored form, or `null` when the id is missing. */
  async findById(id: number): Promise<CurrencyRow | null> {
    const row = await this.prisma.client.tblcurrencies.findFirst({
      where: { id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  /** The base currency: the first `isdefault` row by id, or `null` when none is set (branding's read, D-44). */
  async findBase(): Promise<CurrencyRow | null> {
    const row = await this.prisma.client.tblcurrencies.findFirst({
      where: { isdefault: true },
      orderBy: { id: 'asc' },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  /** Inserts a row with the five columns; `isdefault` is left to the column's default 0, as Perfex's `add`. */
  async create(input: NewCurrency): Promise<CurrencyRow> {
    const row = await this.prisma.client.tblcurrencies.create({
      data: dataOf(input),
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  /** Rewrites the five columns, as Perfex's edit does; `null` when the id is missing (Prisma P2025). */
  async update(id: number, input: NewCurrency): Promise<CurrencyRow | null> {
    try {
      const row = await this.prisma.client.tblcurrencies.update({
        where: { id },
        data: dataOf(input),
        select: COLUMNS,
      });
      return rowSchema.parse(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /** The make-base switch in ONE database transaction (`setBaseIn`); `false` when the id is missing. */
  setBase(id: number): Promise<boolean> {
    return this.prisma.client.$transaction((tx) => this.setBaseIn(tx, id));
  }

  /**
   * Perfex's base switch (`Currencies_model.php` :153-161) on a transaction's client: `isdefault`
   * set on the id; when no row matched, `false` and nothing else runs; otherwise every other row
   * cleared, then `true`.
   */
  async setBaseIn(tx: DbTransaction, id: number): Promise<boolean> {
    const { count } = await tx.tblcurrencies.updateMany({
      where: { id },
      data: { isdefault: true },
    });
    if (count === 0) return false;
    await tx.tblcurrencies.updateMany({ where: { id: { not: id } }, data: { isdefault: false } });
    return true;
  }

  /** Deletes a row; `false` when nothing was deleted (the id was missing). */
  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tblcurrencies.deleteMany({ where: { id } });
    return count > 0;
  }

  /**
   * The register's lines the connected schema has right now: `table.column` (as declared) to its
   * `DATA_TYPE` (lower case). ONE `information_schema.COLUMNS` read with every name bound, matched
   * exactly (letter case folded on both sides, as MySQL may answer a name in another case). An absent
   * table or column is simply not in the map. Never cached (D-28).
   *
   * @complexity O(r + c) over the answer's rows and the register's lines
   */
  async presentReferences(): Promise<ReadonlyMap<string, string>> {
    const tables = [...new Set(CURRENCY_REFERENCES.map((reference) => reference.table))];
    const columns = [...new Set(CURRENCY_REFERENCES.map((reference) => reference.column))];
    const rows = presentColumnsSchema.parse(
      await this.prisma.client
        .$queryRaw`SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${Prisma.join(tables)}) AND COLUMN_NAME IN (${Prisma.join(columns)})`,
    );
    const found = new Map(
      rows.map((row) => [`${row.t}.${row.c}`.toLowerCase(), row.d.toLowerCase()]),
    );
    const present = new Map<string, string>();
    for (const key of CURRENCY_REFERENCES.map(referenceKey)) {
      const type = found.get(key.toLowerCase());
      if (type !== undefined) present.set(key, type);
    }
    return present;
  }

  /**
   * What refers to each currency of `rows`: the probe first, then one statement per PRESENT line in
   * one `Promise.all` (ids bound as numbers on an integer column, as decimal text otherwise; the
   * rows' stored codes bound as text on a code line), then both halves per id: every id a key, zeros
   * where nothing refers to it and for every missing line. No rows, no query. An error from the probe
   * or any statement rejects the whole answer (fail closed).
   *
   * @complexity O(l + r) over the register's lines and the answers' rows
   */
  async usageByCurrency(
    rows: readonly Pick<CurrencyRow, 'id' | 'name'>[],
  ): Promise<ReadonlyMap<number, CurrencyReferenceCounts>> {
    if (rows.length === 0) return new Map();
    const present = await this.presentReferences();
    const keys = pageKeys(rows);
    const ids = Prisma.join(rows.map((row) => row.id));
    const idTexts = Prisma.join([...keys.idTexts.keys()]);
    const codes = Prisma.join([...keys.codes.keys()]);
    const reads = CURRENCY_REFERENCES.flatMap((reference) => {
      const type = present.get(referenceKey(reference));
      if (type === undefined) return [];
      const numeric = reference.byValue !== undefined && INTEGER_TYPES.has(type);
      return [{ reference, numeric }];
    });
    const answers = await Promise.all(
      reads.map(({ reference, numeric }) => {
        if (numeric && reference.byValue !== undefined) {
          return reference.byValue(this.prisma.client, ids);
        }
        const values = reference.match === 'codeAsText' ? codes : idTexts;
        return reference.byBytes(this.prisma.client, values);
      }),
    );
    reads.forEach(({ reference, numeric }, index) => {
      addAnswer(keys, reference, numeric, answers[index]);
    });
    return keys.totals;
  }

  /**
   * Every currency, the id ascending: the facade's `listAll` (D-44). Reads one row more than
   * `CURRENCIES_FACADE_MAX_ROWS` and refuses loudly when it finds it, never answering a truncated list.
   */
  async listAll(): Promise<readonly CurrencyRow[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tblcurrencies.findMany({
        orderBy: { id: 'asc' },
        take: CURRENCIES_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > CURRENCIES_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(CURRENCIES_FACADE_MAX_ROWS)} currencies: the full list was refused, not truncated`,
      );
    }
    return rows;
  }
}
