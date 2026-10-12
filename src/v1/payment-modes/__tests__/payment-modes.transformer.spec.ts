/**
 * The description codec (Perfex's `nl2br_save_html` to store, `clear_textarea_breaks` to read,
 * `application/helpers/template_helper.php` :92-107 and :116-136), PHP's `(int)` cast of the
 * credit-expense option (`Expenses_model.php:109`), the flags read as Perfex reads each box (`== 1`),
 * the DTOs, the export cells and the facade's shape. Every case of the plan's interfaces is here,
 * both ways, and every stored value the cases produce is stored again byte-identically when its read
 * form is saved (D-34).
 */
import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { PaymentModeRow, PaymentModeUsage } from '../model/payment-modes.model.js';
import {
  creditModeIdOf,
  fromFlag,
  fromStoredDescription,
  isCreditExpenseMode,
  NO_PAYMENT_MODE_USAGE,
  PAYMENT_MODES_EXPORT_CELLS,
  PaymentModesTransformer,
  toExportRow,
  toFlag,
  toPaymentMode,
  toResponse,
  toStoredDescription,
} from '../service/payment-modes.transformer.js';

/** A no-break space, written by code point so the source stays ASCII. */
const NBSP = String.fromCharCode(0xa0);

/** `to` cases of the interfaces: [what the form sends, what Perfex stores]. */
const TO_CASES: readonly (readonly [string, string])[] = [
  ['', ''],
  ['a', 'a'],
  ['a\nb', 'a<br />\nb'],
  ['a\r\nb', 'a<br />\r\nb'],
  ['a\n\rb', 'a<br />\n\rb'],
  ['<b>x</b>\ny', '<b>x</b>\ny<br />\n'],
  ['x</b>', 'x</b>\n'],
  ['a <i>b</i> c\nd', 'a <i>b</i> c<br />\nd<br />\n'],
  ['<p>a</p>\r\n\r\nb  ', '<p>a</p>\n<br />\nb<br />\n'],
  ['a</\n>', 'a</<br />\n>'],
];

/** `from` cases of the interfaces: [what is stored, what the form shows]. */
const FROM_CASES: readonly (readonly [string | null, string])[] = [
  [null, ''],
  ['', ''],
  ['a<br />\nb', 'a\nb'],
  ['<b>x</b>\ny<br />\n', '<b>x</b>\ny'],
  ['A<BR>b<br/>c', 'Abc'],
  ['a <br />\nb', 'a \nb'],
  ['x<br  />', 'x<br  />'],
  [` ${NBSP}x${NBSP} `, `${NBSP}x${NBSP}`],
];

const ROW: PaymentModeRow = {
  id: 7,
  name: 'Bank <transfer>',
  description: 'Line one<br />\nline two',
  active: true,
  showOnPdf: 1,
  selectedByDefault: 0,
  invoicesOnly: 2,
  expensesOnly: 0,
};
const USED: PaymentModeUsage = { ...NO_PAYMENT_MODE_USAGE, expenses: 3, invoicePayments: 1 };
const META = { nextCursor: 'n', prevCursor: null, total: 3, rangeStart: 1 };

describe('toStoredDescription: Perfex nl2br_save_html (template_helper.php :116-136)', () => {
  it.each(TO_CASES)('stores %j as %j', (text, stored) => {
    expect(toStoredDescription(text)).toBe(stored);
  });

  it('a closing tag only counts on one line: a CR does not end the line, a LF does', () => {
    expect(toStoredDescription('a</\r>')).toBe('a</<br />\n><br />\n');
    expect(toStoredDescription('a</\n>')).toBe('a</<br />\n>');
  });

  it('strips PHP whitespace (space, tab, NUL, vertical tab) at each line end, never a no-break space', () => {
    expect(toStoredDescription('<p>x</p> \t\u0000\u000b\ny')).toBe('<p>x</p>\ny<br />\n');
    expect(toStoredDescription(`<p>x</p>\ny${NBSP}`)).toBe(`<p>x</p>\ny${NBSP}<br />\n`);
  });

  it('a line ending in an opening tag gets no <br />; one ending in <br /> does (it holds a slash)', () => {
    expect(toStoredDescription('<p>x</p>\n<div>')).toBe('<p>x</p>\n<div>\n');
    expect(toStoredDescription('<p>x</p>\ny<br />')).toBe('<p>x</p>\ny<br /><br />\n');
  });
});

describe('fromStoredDescription: Perfex clear_textarea_breaks (template_helper.php :92-107)', () => {
  it.each(FROM_CASES)('reads %j as %j', (stored, text) => {
    expect(fromStoredDescription(stored)).toBe(text);
  });

  it('removes the three tags one after another, as str_ireplace does with an array', () => {
    expect(fromStoredDescription('a<br<br />>b')).toBe('ab');
    expect(fromStoredDescription('a<br/<br>>b')).toBe('ab');
  });

  it('trims only PHP whitespace from both ends', () => {
    expect(fromStoredDescription('\u0000\t a \u000b\r\n')).toBe('a');
  });
});

describe('stability: a read value saved again is stored byte-identically (D-34)', () => {
  const stored = [...TO_CASES.map(([, value]) => value), 'a <i>b</i> c<br />\nd<br />\n'];

  it.each(stored.map((value) => [value]))('to(from(%j)) is the same bytes', (value) => {
    expect(toStoredDescription(fromStoredDescription(value))).toBe(value);
  });
});

describe("creditModeIdOf: PHP's (int) cast of the option (Expenses_model.php :109)", () => {
  it.each([
    [null, 0],
    ['', 0],
    ['7', 7],
    [' 7', 7],
    ['7abc', 7],
    ['abc', 0],
    ['7.9', 7],
    ['-3', -3],
    ['+4', 4],
    ['1e1', 10],
    ['\t\n 12', 12],
    ['.5', 0],
    ['-0', 0],
    [' 7abc', 7],
  ])('casts %j to %d', (setting, id) => {
    expect(creditModeIdOf(setting)).toBe(id);
  });
});

describe('isCreditExpenseMode (D-37)', () => {
  it.each([
    [7, '7', true],
    [7, ' 7abc', true],
    [7, '7.9', true],
    [7, '8', false],
    [7, '0', false],
    [7, '', false],
    [7, 'abc', false],
    [7, null, false],
    [3, '-3', false],
  ])('mode %d with the option %j: %s', (id, setting, expected) => {
    expect(isCreditExpenseMode(id, setting)).toBe(expected);
  });
});

describe('the flags (Perfex reads each box as == 1)', () => {
  it('toFlag reads 1 only as true; fromFlag writes 1 only for true', () => {
    expect([0, 1, 2, -1].map(toFlag)).toEqual([false, true, false, false]);
    expect([true, false, undefined].map(fromFlag)).toEqual([1, 0, 0]);
  });
});

describe('toResponse, toExportRow, toPaymentMode', () => {
  it('writes the id as text, the read form, the flags as booleans, the usage and the lock', () => {
    expect(toResponse(ROW, USED, '7')).toEqual({
      id: '7',
      name: 'Bank <transfer>',
      description: 'Line one\nline two',
      active: true,
      showOnPdf: true,
      selectedByDefault: false,
      invoicesOnly: false,
      expensesOnly: false,
      usage: USED,
      isCreditExpenseMode: true,
    });
    expect(toResponse({ ...ROW, description: null }, USED, null)).toMatchObject({
      description: '',
      isCreditExpenseMode: false,
    });
    expect(toResponse(ROW, USED, '0').isCreditExpenseMode).toBe(false);
  });

  it('the export row is the four columns: the id as text, the name, the read form, active', () => {
    const exported = toExportRow(ROW);
    expect(exported).toEqual({
      id: '7',
      name: 'Bank <transfer>',
      description: 'Line one\nline two',
      active: true,
    });
    expect(Object.keys(PAYMENT_MODES_EXPORT_CELLS)).toEqual([
      'id',
      'name',
      'description',
      'active',
    ]);
    expect(PAYMENT_MODES_EXPORT_CELLS.active.value(exported)).toBe(true);
    expect(PAYMENT_MODES_EXPORT_CELLS.description.value(exported)).toBe('Line one\nline two');
  });

  it("the facade's shape: the id as a number and every flag a boolean, never the description", () => {
    expect(toPaymentMode(ROW)).toEqual({
      id: 7,
      name: 'Bank <transfer>',
      active: true,
      invoicesOnly: false,
      expensesOnly: false,
      selectedByDefault: false,
      showOnPdf: true,
    });
  });
});

describe('PaymentModesTransformer', () => {
  const transformer = new PaymentModesTransformer();

  it('one record with the usage the map holds for it, zeros when none', () => {
    expect(transformer.toResponse(ROW, new Map([[7, USED]]), null).usage).toEqual(USED);
    expect(transformer.toResponse(ROW, new Map(), null).usage).toEqual(NO_PAYMENT_MODE_USAGE);
  });

  it('the list envelope: each row with its usage and lock, the four page fields and both limits', () => {
    const other: PaymentModeRow = { ...ROW, id: 8, name: 'Cash', description: null };
    const answer = transformer.toListResponse([ROW, other], new Map([[7, USED]]), '8', {
      ...META,
      extra: 'dropped',
    } as typeof META);
    expect(answer.data.map((row) => [row.id, row.usage, row.isCreditExpenseMode])).toEqual([
      ['7', USED, false],
      ['8', NO_PAYMENT_MODE_USAGE, true],
    ]);
    expect(answer.meta).toEqual({
      ...META,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });

  it('the switch answer: the id as text and the flag', () => {
    expect(transformer.toActiveResponse(7, false)).toEqual({ id: '7', active: false });
  });

  it('NO_PAYMENT_MODE_USAGE is the eight groups at zero', () => {
    expect(NO_PAYMENT_MODE_USAGE).toEqual({
      invoicePayments: 0,
      expenses: 0,
      creditNoteRefunds: 0,
      purchaseInvoicePayments: 0,
      purchaseOrderPayments: 0,
      debitNoteRefunds: 0,
      fixedEquipmentRefunds: 0,
      orderReturnRefunds: 0,
    });
  });
});
