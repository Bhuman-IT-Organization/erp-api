/**
 * The one CSV rule every export writes through (D-26): a UTF-8 BOM, CRLF line ends, RFC 4180
 * quoting, and the OWASP CSV-injection escape — written once, here, with a spec case per rule, so no
 * module concatenates its own commas.
 *
 * Why the escape: the file is opened by Excel or LibreOffice, which evaluate a cell that starts with
 * `=`, `+`, `-` or `@` (and, in some versions, a TAB or CR before one) as a formula. A staff member
 * named `=HYPERLINK(…)` would otherwise run in the reader's spreadsheet. Such a cell gets a leading
 * apostrophe first, then the ordinary quoting (OWASP "CSV Injection",
 * https://owasp.org/www-community/attacks/CSV_Injection).
 *
 * D-42: the header row is the web's translated labels, sent by the browser. They are untrusted
 * input like any query value: `parseExportHeaders` checks their count and length, and the header row
 * goes through the same `toCsvLine`, so a label gets the same escape as a data cell.
 *
 * Phase 4.1.1 (ADR-0043, D-11): `escapeFormula` is the one formula escape for CSV and Excel; the
 * Excel writer (`xlsx.ts`) calls it on every string cell and header label, so both files defend the
 * reader's spreadsheet the same way.
 *
 * The download's file name is `exportFilename(constantStem, now, extension)`: the stem is a module
 * constant and the extension comes from the validated format (`csv`, `xlsx` or `pdf`, D-15), so no
 * request input ever reaches the `Content-Disposition` header.
 *
 * What this does NOT do: it reads no rows and sets no header. The service pages the rows and the
 * controller sets `CSV_CONTENT_TYPE`; this file only turns values into text.
 */
import { AppError } from '../errors/app-error.js';

/** Excel reads a BOM-less CSV in the machine's code page, which garbles Arabic names. */
export const CSV_BOM = '\uFEFF';

/** More matching rows than this is refused before any row is read (issue path `['export']`). */
export const EXPORT_MAX_ROWS = 10_000;

/** The longest translated header label `parseExportHeaders` admits (D-42). */
export const EXPORT_HEADER_MAX_LENGTH = 100;

/** The export's `Content-Type`. */
export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';

/** A cell a spreadsheet would evaluate: `= + - @`, TAB or CR first (OWASP). */
const FORMULA_START = /^[=+\-@\t\r]/;

/** RFC 4180: a field holding a quote, a comma, CR or LF is wrapped in quotes. */
const NEEDS_QUOTES = /[",\r\n]/;

/** A file-name stem is a lowercase constant such as `staff-members` or `form-1099`, never input: no quote, space, CR or semicolon can reach `Content-Disposition`. */
const FILE_STEM = /^[a-z][a-z0-9-]*$/;

/** `YYYY-MM-DD` is the first ten characters of `Date.prototype.toISOString()` (UTC). */
const ISO_DATE_LENGTH = 10;

/** The download extensions an export file may carry; Print is not a file (D-15, D-28). */
export const EXPORT_FILE_EXTENSIONS = ['csv', 'xlsx', 'pdf'] as const;

/** One of `EXPORT_FILE_EXTENSIONS`, chosen from the validated format, never from input. */
export type ExportFileExtension = (typeof EXPORT_FILE_EXTENSIONS)[number];

export type CsvValue = string | number | boolean | null;

/**
 * The OWASP formula escape alone: a leading apostrophe when `text` starts with `=`, `+`, `-`, `@`,
 * TAB or CR; anything else is answered unchanged. No quoting: that is `csvCell`'s job for CSV, and
 * Excel stores the text as a typed string (D-11).
 */
export function escapeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/**
 * One cell: `null` → empty, `true`/`false` → `1`/`0`, a number in its plain form, a string as is —
 * then a leading apostrophe if it starts like a formula, then RFC 4180 quoting (wrap in `"` when it
 * holds `"`, `,`, CR or LF; double every embedded `"`). Escape first, so the apostrophe is inside
 * the quotes.
 */
export function csvCell(value: CsvValue): string {
  let text: string;
  if (value === null) text = '';
  else if (typeof value === 'boolean') text = value ? '1' : '0';
  else text = String(value);
  text = escapeFormula(text);
  return NEEDS_QUOTES.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** One record: the cells joined by `,`, ended by CRLF (RFC 4180). */
export function toCsvLine(cells: readonly CsvValue[]): string {
  return `${cells.map(csvCell).join(',')}\r\n`;
}

function refuseHeader(message: string): never {
  throw new AppError('ERP-VALIDATION-0001', 'Query is invalid', {
    issues: [{ path: ['header'], message }],
  });
}

/**
 * D-42: the web's translated column labels, from the repeated `header` query parameter. Absent →
 * `fallback` (the wire field names). A single string is a one-element array (that is how Fastify's
 * query parser leaves a parameter sent once). Otherwise every entry must be a string of at most
 * `EXPORT_HEADER_MAX_LENGTH` characters and the count must equal `fallback.length`; anything else is
 * a 400 `ERP-VALIDATION-0001` on the `header` path. The labels are returned as sent: escaping is
 * `toCsvLine`'s job, the same as for a data cell.
 */
export function parseExportHeaders(raw: unknown, fallback: readonly string[]): readonly string[] {
  if (raw === undefined) return fallback;
  if (typeof raw !== 'string' && !Array.isArray(raw)) {
    return refuseHeader('header must be one label per exported column');
  }
  const labels: readonly unknown[] = typeof raw === 'string' ? [raw] : raw;
  if (labels.length !== fallback.length) {
    return refuseHeader(
      `header must be sent once per exported column (${String(fallback.length)})`,
    );
  }
  const checked: string[] = [];
  for (const label of labels) {
    if (typeof label !== 'string') return refuseHeader('header must be text');
    if (label.length > EXPORT_HEADER_MAX_LENGTH) {
      return refuseHeader(
        `header labels are at most ${String(EXPORT_HEADER_MAX_LENGTH)} characters`,
      );
    }
    checked.push(label);
  }
  return checked;
}

/**
 * `${stem}-YYYY-MM-DD.<extension>`, the date in UTC from `now`, the extension `csv` unless the
 * validated format names `xlsx` or `pdf` (D-15). `stem` is a module constant; one that is not
 * `/^[a-z][a-z0-9-]*$/` throws (a programming error, not a 400), so nothing that could break out of
 * the `Content-Disposition` quotes can reach the header.
 */
export function exportFilename(
  stem: string,
  now: Date,
  extension: ExportFileExtension = 'csv',
): string {
  if (!FILE_STEM.test(stem))
    throw new Error(`export file stem "${stem}" is not a lowercase constant`);
  return `${stem}-${now.toISOString().slice(0, ISO_DATE_LENGTH)}.${extension}`;
}
