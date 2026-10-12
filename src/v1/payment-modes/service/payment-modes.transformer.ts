/**
 * Transformer: Perfex's description storage, PHP's `(int)` cast of the credit-expense option, the
 * flags, the export rows and entity to response DTO. Every DTO is built field by field and then
 * parsed through its zod response schema, which strips any key the schema does not name, so nothing
 * the wire shape does not declare can ride along (T-2-14). The controller never imports this file
 * (BE-08). The codec is this module's own copy, never imported from another module (BE-03).
 *
 * The description (D-34). Perfex stores it through `nl2br_save_html` and shows it for editing
 * through `clear_textarea_breaks` (`application/helpers/template_helper.php` :116-136 and :92-107),
 * so Node writes the first form and reads the second: a row Node saves reads the same in Perfex's
 * PDFs and screens, a read value saved again is stored byte-identically, and a rollback finds
 * nothing Perfex would not have written itself.
 *
 * The credit-expense option (D-37). The client's expense code reads `expense_credit_payment_mode`
 * as PHP's `(int)` cast of the stored text and uses it only when it is above 0
 * (`application/models/Expenses_model.php:109`); `creditModeIdOf` is that cast.
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import {
  paymentModesActiveResponseSchema,
  paymentModesListResponseSchema,
  paymentModesResponseSchema,
  type PaymentModesActiveResponseDto,
  type PaymentModesListResponseDto,
  type PaymentModesResponseDto,
} from '../dto/payment-modes.dto.js';
import type {
  PaymentMode,
  PaymentModeRow,
  PaymentModeUsage,
} from '../model/payment-modes.model.js';
import { PAYMENT_MODES_EXPORT_COLUMNS } from '../payment-modes.routes.js';

/** The six characters PHP's `trim` and `rtrim` strip by default: space, tab, LF, CR, NUL, vertical tab. */
export const PHP_WHITESPACE = ' \t\n\r\u0000\u000b';

/** One line break as PHP's `nl2br` sees it: the two-character pairs first, then a lone LF or CR. */
const LINE_BREAK = /\r\n|\n\r|\n|\r/g;

/**
 * `nl2br_save_html`'s test for markup, `#</.*>#`: a closing tag on one line. PCRE's `.` stops only
 * at a LF (a CR is matched), so the class is "anything but LF", not JavaScript's `.`.
 */
const CLOSING_TAG_ON_ONE_LINE = /<\/[^\n]*>/;

/** `nl2br_save_html`'s per-line test, `#</?[^/<>]*>$#`: the line ends with an opening or closing tag. */
const ENDS_WITH_TAG = /<\/?[^/<>]*>$/;

/** The three tags `clear_textarea_breaks` removes, in the order `str_ireplace` applies them. */
const BREAK_TAGS = [/<br \/>/gi, /<br>/gi, /<br\/>/gi] as const;

/**
 * PHP's numeric-string prefix: leading whitespace (space, tab, LF, CR, vertical tab, form feed),
 * an optional sign, digits with an optional fraction or a leading-dot fraction, an optional
 * exponent. What follows the prefix is ignored, as `(int)` ignores it.
 */
const PHP_NUMERIC_PREFIX = /^[ \t\n\r\v\f]*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/;

/** The counts a payment mode answers when the usage map has no entry for its id. */
export const NO_PAYMENT_MODE_USAGE: PaymentModeUsage = {
  invoicePayments: 0,
  expenses: 0,
  creditNoteRefunds: 0,
  purchaseInvoicePayments: 0,
  purchaseOrderPayments: 0,
  debitNoteRefunds: 0,
  fixedEquipmentRefunds: 0,
  orderReturnRefunds: 0,
};

/** One exported row: the four export columns, the description in its read form. */
export interface PaymentModeExportRow {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly active: boolean;
}

/**
 * Each export column's cell over the exported row, keyed by the column name, so the column list in
 * `payment-modes.routes.ts` and what is written under it cannot drift (`satisfies`). `id`, `name`
 * and `description` are text; `active` is a boolean cell: `1`/`0` in CSV and Excel, the sent yes or
 * no word in PDF and Print.
 */
export const PAYMENT_MODES_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
  description: { value: (row) => row.description },
  active: { value: (row) => row.active },
} as const satisfies Record<
  (typeof PAYMENT_MODES_EXPORT_COLUMNS)[number],
  ExportCell<PaymentModeExportRow>
>;

/**
 * `text` without the PHP whitespace at its end, as `rtrim` strips it.
 *
 * @complexity O(n) over the trailing whitespace
 */
function stripEnd(text: string): string {
  let end = text.length;
  while (end > 0 && PHP_WHITESPACE.includes(text.charAt(end - 1))) end -= 1;
  return text.slice(0, end);
}

/**
 * `text` without the PHP whitespace at its start (the other half of `trim`).
 *
 * @complexity O(n) over the leading whitespace
 */
function stripStart(text: string): string {
  let start = 0;
  while (start < text.length && PHP_WHITESPACE.includes(text.charAt(start))) start += 1;
  return text.slice(start);
}

/** One line of `nl2br_save_html`'s markup branch: right-trimmed, `<br />` unless it ends in a tag, then LF. */
function storedLine(line: string): string {
  const trimmed = stripEnd(line);
  return `${trimmed}${ENDS_WITH_TAG.test(trimmed) ? '' : '<br />'}\n`;
}

/**
 * The stored form, exactly as Perfex's `nl2br_save_html` writes it: with no closing tag on one line,
 * PHP's `nl2br` (`<br />` before each `\r\n`, `\n\r`, `\n` or `\r`, a pair counting once); otherwise
 * every `\r\n`, then every remaining `\r`, becomes `\n`, and each line is right-trimmed, given
 * `<br />` unless it ends in a tag, and ended with `\n`.
 *
 * @complexity O(n) over the text's characters
 */
export function toStoredDescription(text: string): string {
  if (!CLOSING_TAG_ON_ONE_LINE.test(text)) return text.replace(LINE_BREAK, '<br />$&');
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n').map(storedLine).join('');
}

/**
 * The read form, exactly as Perfex's `clear_textarea_breaks` answers it: `<br />`, then `<br>`,
 * then `<br/>` removed in any letter case (nothing else, so `<br  />` stays), then PHP whitespace
 * trimmed from both ends (never a Unicode space). `NULL` and `''` read as `''`.
 *
 * @complexity O(n) over the stored text, once per tag
 */
export function fromStoredDescription(stored: string | null): string {
  if (stored === null || stored === '') return '';
  const cleared = BREAK_TAGS.reduce((text, tag) => text.replace(tag, ''), stored);
  return stripStart(stripEnd(cleared));
}

/**
 * PHP's `(int)` cast of the option's text (`Expenses_model.php:109`): the longest leading numeric
 * prefix after leading whitespace, truncated toward zero; `null`, no prefix or a value that is not
 * finite is 0.
 */
export function creditModeIdOf(setting: string | null): number {
  const prefix = setting === null ? undefined : PHP_NUMERIC_PREFIX.exec(setting)?.[1];
  const value = prefix === undefined ? 0 : Math.trunc(Number(prefix));
  // `+ 0` turns a `-0` (from `-0` or `-0.5`) into 0, as PHP has no negative zero integer.
  return Number.isFinite(value) ? value + 0 : 0;
}

/** D-37: the option names this mode, as the expense code reads it (`> 0` and equal to the id). */
export function isCreditExpenseMode(id: number, setting: string | null): boolean {
  const credit = creditModeIdOf(setting);
  return credit > 0 && credit === id;
}

/** A stored box as Perfex reads it: `== 1`, so `2` is unticked. */
export function toFlag(stored: number): boolean {
  return stored === 1;
}

/** A box as Perfex saves it: ticked is 1, unticked or absent is 0. */
export function fromFlag(value: boolean | undefined): 0 | 1 {
  return value === true ? 1 : 0;
}

/** One payment mode on the wire: the id as text, the read form, the boxes, its usage and the lock. */
export function toResponse(
  row: PaymentModeRow,
  usage: PaymentModeUsage,
  setting: string | null,
): PaymentModesResponseDto {
  return paymentModesResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    description: fromStoredDescription(row.description),
    active: row.active,
    showOnPdf: toFlag(row.showOnPdf),
    selectedByDefault: toFlag(row.selectedByDefault),
    invoicesOnly: toFlag(row.invoicesOnly),
    expensesOnly: toFlag(row.expensesOnly),
    usage,
    isCreditExpenseMode: isCreditExpenseMode(row.id, setting),
  });
}

/** One exported row: the id as text, the name, the read form, `active`; never the usage or the lock. */
export function toExportRow(row: PaymentModeRow): PaymentModeExportRow {
  return {
    id: String(row.id),
    name: row.name,
    description: fromStoredDescription(row.description),
    active: row.active,
  };
}

/** The facade's shape: the id, the name and every flag a boolean; never the description or the DTO. */
export function toPaymentMode(row: PaymentModeRow): PaymentMode {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    invoicesOnly: toFlag(row.invoicesOnly),
    expensesOnly: toFlag(row.expensesOnly),
    selectedByDefault: toFlag(row.selectedByDefault),
    showOnPdf: toFlag(row.showOnPdf),
  };
}

@Injectable()
export class PaymentModesTransformer {
  /** One record: `toResponse` with the usage the map holds for it (zeros when none). */
  toResponse(
    row: PaymentModeRow,
    usage: ReadonlyMap<number, PaymentModeUsage>,
    setting: string | null,
  ): PaymentModesResponseDto {
    return toResponse(row, usage.get(row.id) ?? NO_PAYMENT_MODE_USAGE, setting);
  }

  /**
   * The list envelope: each row with its usage (zeros when the map has no entry for the id) and
   * the lock, the four page fields copied one by one (a page object passed as the meta carries
   * nothing else), `exportLimit` and `printLimit` from their one definition.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(
    rows: readonly PaymentModeRow[],
    usage: ReadonlyMap<number, PaymentModeUsage>,
    setting: string | null,
    meta: ListPageMeta,
  ): PaymentModesListResponseDto {
    return paymentModesListResponseSchema.parse({
      data: rows.map((row) => this.toResponse(row, usage, setting)),
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

  /** The switch's answer: the id as text and the flag now stored. */
  toActiveResponse(id: number, active: boolean): PaymentModesActiveResponseDto {
    return paymentModesActiveResponseSchema.parse({ id: String(id), active });
  }
}
