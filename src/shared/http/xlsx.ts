/**
 * The Excel export (Phase 4.1.1, ADR-0043, D-11): one sheet named by the file stem, a bold header
 * row frozen at the top, and typed cells: a number is a number, a boolean the number `1` or `0`
 * (D-10, the same wire value as the CSV), a string is text with the CSV formula escape, and null is
 * an empty cell. No cell is ever of the `Formula` type, so nothing a user typed runs in the
 * reader's spreadsheet; header labels (the web's translations, untrusted) get the same escape.
 *
 * The signature is the one Phase 4.2 planned for its item list (`toXlsx(header, rows, sheet?)`,
 * D-23), so that module reuses this file.
 *
 * What this does NOT do: it reads no rows, sets no header and adds no footer or totals row (D-16).
 * `export.ts` pages the rows and chooses this writer for `format=xlsx`.
 */
import writeExcelFile, { type Cell, type Row } from 'write-excel-file/node';
import { escapeFormula, type CsvValue } from './csv.js';

/** The `.xlsx` `Content-Type`. */
export const XLSX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Excel refuses a sheet name longer than 31 characters. */
export const XLSX_SHEET_NAME_MAX = 31;

/** The sheet name when the caller names none. */
export const XLSX_DEFAULT_SHEET = 'export';

/** A cell of the Excel export: the same wire values as a CSV cell. */
export type XlsxCell = CsvValue;

/** Rows frozen at the top of the sheet: the header row. */
const HEADER_ROWS = 1;

function headerCell(label: string, fill: string | undefined): Cell {
  const cell: Cell = { value: escapeFormula(label), type: String, fontWeight: 'bold' };
  return fill === undefined ? cell : { ...cell, backgroundColor: fill };
}

function dataCell(value: XlsxCell): Cell {
  if (value === null) return null;
  if (typeof value === 'number') return { value, type: Number };
  if (typeof value === 'boolean') return { value: value ? 1 : 0, type: Number };
  return { value: escapeFormula(value), type: String };
}

/**
 * The `.xlsx` bytes of one sheet: the header row (bold, frozen) then one row per entry of `rows`.
 * `sheet` is cut to `XLSX_SHEET_NAME_MAX` characters; absent, the sheet is `XLSX_DEFAULT_SHEET`.
 * `headerFills` (optional, `#rrggbb` by column, `undefined` for none) colours header cells, as a
 * Perfex template that tells the user which columns to fill did (the serial file, UAT 2026-10-07).
 */
export function toXlsx(
  header: readonly string[],
  rows: readonly (readonly XlsxCell[])[],
  sheet: string = XLSX_DEFAULT_SHEET,
  headerFills: readonly (string | undefined)[] = [],
): Promise<Buffer> {
  const data: Row[] = [
    header.map((label, index) => headerCell(label, headerFills[index])),
    ...rows.map((row) => row.map(dataCell)),
  ];
  return writeExcelFile(data, {
    sheet: sheet.slice(0, XLSX_SHEET_NAME_MAX),
    stickyRowsCount: HEADER_ROWS,
  }).toBuffer();
}
