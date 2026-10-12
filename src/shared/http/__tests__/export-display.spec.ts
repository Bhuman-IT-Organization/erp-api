import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import {
  EXPORT_DATE_FORMATS,
  EXPORT_DISPLAY_DEFAULTS,
  EXPORT_TIME_FORMATS,
  displayCell,
  formatExportDate,
  formatExportDateTime,
  parseExportDisplay,
  type ExportDisplay,
} from '../export-display.js';

/**
 * The instants and expectations are erp-web `src/lib/i18n/__tests__/format.test.ts`'s own vectors,
 * so a PDF or a Print page reads a date exactly as the screen does (D-25).
 */
const MORNING = '2026-09-25T10:00:00Z';
const LATE_UTC = '2026-09-25T22:30:00Z';
const AFTERNOON_DUBAI = '2026-09-25T10:05:00Z';
/** 12:25:22 UTC is 16:25:22 in Asia/Dubai: a time with non-zero seconds. */
const WITH_SECONDS = '2026-07-22T12:25:22Z';
/** Arabic-Indic and extended Arabic-Indic digits: never rendered (D-34). */
const NON_LATIN_DIGIT = /[٠-٩۰-۹]/;

const D = (over: Partial<ExportDisplay> = {}): ExportDisplay => ({
  ...EXPORT_DISPLAY_DEFAULTS,
  blanks: [],
  ...over,
});

/** Every display refusal is the one validation code on the parameter's own path. */
function displayRejection(raw: Readonly<Record<string, unknown>>, columns: number): unknown[] {
  const error = ((): unknown => {
    try {
      parseExportDisplay(raw, columns);
      return undefined;
    } catch (e: unknown) {
      return e;
    }
  })();
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe('ERP-VALIDATION-0001');
  expect((error as AppError).status).toBe(400);
  expect((error as AppError).message).toBe('Query is invalid');
  const issues = (error as AppError).extras?.issues;
  expect(Array.isArray(issues)).toBe(true);
  return (issues as unknown[]).map((issue) => (issue as { path: unknown }).path);
}

describe('export display constants', () => {
  it("are Perfex's seven date formats, 24/12 hour time and the Perfex install defaults", () => {
    expect(EXPORT_DATE_FORMATS).toEqual([
      'd-m-Y',
      'd/m/Y',
      'm-d-Y',
      'm.d.Y',
      'm/d/Y',
      'Y-m-d',
      'd.m.Y',
    ]);
    expect(EXPORT_TIME_FORMATS).toEqual(['24', '12']);
    expect(EXPORT_DISPLAY_DEFAULTS).toEqual({
      title: '',
      yes: '1',
      no: '0',
      dateFormat: 'Y-m-d',
      timeFormat: '24',
      timeZone: 'UTC',
    });
  });
});

describe('formatExportDate (Perfex _d(), the erp-web vectors)', () => {
  it.each([
    ['d-m-Y', '25-09-2026'],
    ['m/d/Y', '09/25/2026'],
    ['Y-m-d', '2026-09-25'],
    ['d.m.Y', '25.09.2026'],
    ['d/m/Y', '25/09/2026'],
    ['m-d-Y', '09-25-2026'],
    ['m.d.Y', '09.25.2026'],
  ] as const)('%s renders %s', (dateFormat, expected) => {
    expect(formatExportDate(D({ dateFormat, timeZone: 'Asia/Dubai' }), MORNING)).toBe(expected);
  });

  it('applies the sent zone: 22:30 UTC is the next day in Asia/Dubai, not in UTC', () => {
    expect(formatExportDate(D({ dateFormat: 'd-m-Y', timeZone: 'Asia/Dubai' }), LATE_UTC)).toBe(
      '26-09-2026',
    );
    expect(formatExportDate(D({ dateFormat: 'd-m-Y', timeZone: 'UTC' }), LATE_UTC)).toBe(
      '25-09-2026',
    );
  });

  it('takes a Date as well as an ISO string', () => {
    expect(formatExportDate(D(), new Date(MORNING))).toBe('2026-09-25');
  });
});

describe('formatExportDateTime (Perfex _dt(), the erp-web vectors)', () => {
  it('renders the date, one space and HH:mm:ss in 24-hour time (Perfex _dt() H:i:s)', () => {
    const d = D({ dateFormat: 'd-m-Y', timeFormat: '24', timeZone: 'Asia/Dubai' });
    expect(formatExportDateTime(d, AFTERNOON_DUBAI)).toBe('25-09-2026 14:05:00');
    expect(formatExportDateTime(d, WITH_SECONDS)).toBe('22-07-2026 16:25:22');
  });

  it('renders h:mm AM|PM in 12-hour time, no seconds (Perfex _dt() g:i A)', () => {
    const d = D({ dateFormat: 'd-m-Y', timeFormat: '12', timeZone: 'Asia/Dubai' });
    expect(formatExportDateTime(d, AFTERNOON_DUBAI)).toBe('25-09-2026 2:05 PM');
    expect(formatExportDateTime(d, WITH_SECONDS)).toBe('22-07-2026 4:25 PM');
  });

  it('renders Latin digits only (D-34)', () => {
    const text = formatExportDateTime(
      D({ dateFormat: 'd.m.Y', timeFormat: '12', timeZone: 'Asia/Riyadh' }),
      AFTERNOON_DUBAI,
    );
    expect(text).not.toMatch(NON_LATIN_DIGIT);
    expect(text).toBe('25.09.2026 1:05 PM');
  });
});

describe('displayCell (the PDF and Print value of one cell, D-10)', () => {
  const d = D({ yes: 'Yes', no: 'No', dateFormat: 'd-m-Y', timeZone: 'Asia/Dubai' });

  it('reads a boolean as the sent yes/no labels', () => {
    expect(displayCell(true, undefined, '', d)).toBe('Yes');
    expect(displayCell(false, undefined, '', d)).toBe('No');
  });

  it("reads null as the column's blank label", () => {
    expect(displayCell(null, undefined, 'Never', d)).toBe('Never');
    expect(displayCell(null, 'dateTime', '', d)).toBe('');
  });

  it('reads a number in plain Latin digits with no grouping', () => {
    expect(displayCell(1240, undefined, '', d)).toBe('1240');
    expect(displayCell(-3.5, undefined, '', d)).toBe('-3.5');
  });

  it('formats a date or a date-time string by its column kind', () => {
    expect(displayCell(LATE_UTC, 'date', '', d)).toBe('26-09-2026');
    expect(displayCell(AFTERNOON_DUBAI, 'dateTime', '', d)).toBe('25-09-2026 14:05:00');
  });

  it('answers an unparseable date string unchanged', () => {
    expect(displayCell('not a date', 'date', '', d)).toBe('not a date');
    expect(displayCell('', 'dateTime', '', d)).toBe('');
  });

  it('answers any other string as is, with no formula escape (a spreadsheet defence, D-11)', () => {
    expect(displayCell('=SUM(A1)', undefined, '', d)).toBe('=SUM(A1)');
    expect(displayCell(MORNING, undefined, '', d)).toBe(MORNING);
  });
});

describe('parseExportDisplay (the presentation parameters are untrusted, D-25)', () => {
  it('answers the defaults and one empty blank per column when nothing is sent', () => {
    expect(parseExportDisplay({}, 3)).toEqual({ ...EXPORT_DISPLAY_DEFAULTS, blanks: ['', '', ''] });
  });

  it('answers the sent values', () => {
    expect(
      parseExportDisplay(
        {
          title: 'Staff',
          yes: 'Yes',
          no: 'No',
          blank: ['', 'Never'],
          dateFormat: 'd-m-Y',
          timeFormat: '12',
          timeZone: 'Asia/Dubai',
        },
        2,
      ),
    ).toEqual({
      title: 'Staff',
      yes: 'Yes',
      no: 'No',
      blanks: ['', 'Never'],
      dateFormat: 'd-m-Y',
      timeFormat: '12',
      timeZone: 'Asia/Dubai',
    });
  });

  it('treats a single blank string as a one-element array (one column)', () => {
    expect(parseExportDisplay({ blank: 'Never' }, 1).blanks).toEqual(['Never']);
  });

  it('accepts labels of exactly 100 characters and a zone such as Etc/GMT+4', () => {
    const label = 'A'.repeat(100);
    expect(parseExportDisplay({ title: label, timeZone: 'Etc/GMT+4' }, 1)).toMatchObject({
      title: label,
      timeZone: 'Etc/GMT+4',
    });
  });

  it.each(['title', 'yes', 'no'] as const)('refuses a 101-character %s on its own path', (key) => {
    expect(displayRejection({ [key]: 'A'.repeat(101) }, 1)).toEqual([[key]]);
  });

  it.each(['title', 'yes', 'no'] as const)('refuses a repeated or non-text %s', (key) => {
    expect(displayRejection({ [key]: ['a', 'b'] }, 1)).toEqual([[key]]);
    expect(displayRejection({ [key]: { 0: 'a' } }, 1)).toEqual([[key]]);
  });

  it('refuses a blank count unlike the column count, a non-text blank and a long blank', () => {
    expect(displayRejection({ blank: ['a', 'b'] }, 3)).toEqual([['blank']]);
    expect(displayRejection({ blank: 'a' }, 2)).toEqual([['blank']]);
    expect(displayRejection({ blank: [1] }, 1)).toEqual([['blank']]);
    expect(displayRejection({ blank: ['A'.repeat(101)] }, 1)).toEqual([['blank']]);
    expect(displayRejection({ blank: { 0: 'a' } }, 1)).toEqual([['blank']]);
  });

  it('refuses a date format Perfex does not offer', () => {
    expect(displayRejection({ dateFormat: 'Y/m/d' }, 1)).toEqual([['dateFormat']]);
    expect(displayRejection({ dateFormat: ['Y-m-d'] }, 1)).toEqual([['dateFormat']]);
  });

  it('refuses a time format other than 24 or 12', () => {
    expect(displayRejection({ timeFormat: '13' }, 1)).toEqual([['timeFormat']]);
  });

  it('refuses an unknown zone, a path-like zone and an offset, never falling back', () => {
    expect(displayRejection({ timeZone: 'Mars/Base' }, 1)).toEqual([['timeZone']]);
    expect(displayRejection({ timeZone: '../etc' }, 1)).toEqual([['timeZone']]);
    expect(displayRejection({ timeZone: '+04:00' }, 1)).toEqual([['timeZone']]);
    expect(displayRejection({ timeZone: ['UTC'] }, 1)).toEqual([['timeZone']]);
  });
});
