/**
 * The one list export (Phase 4.1.1, ADR-0043, D-17): every list's `GET <list>/export` parses its
 * query with `parseExportOptions`, then hands `runExport` its rows reader, its cells and its file
 * stem. The core counts first and refuses over the format's cap before any page is read (D-06),
 * follows the keyset `nextCursor` in one loop, and writes the chosen format: CSV and Excel carry the
 * wire values (D-10, D-11), PDF and Print the display values the web sent the words and formats for
 * (D-25), and Print answers JSON rows the browser prints (D-28).
 *
 * Why here: the loop, the cap check and the header check existed as hand copies in every module
 * with an export; one core means one place to get each right, and a generated module inherits it.
 *
 * What this does NOT do: it reads no clock (the service passes `now`), knows no module (the list
 * request and the reader come in as values; `shared/` never imports `v1/`, BE-20), and applies no
 * filter, scope or key itself: the module builds its list request with those, from the first row,
 * in batches of `LIST_QUERY_LIMITS.max`.
 */
import type { FastifyReply } from 'fastify';
import { z } from 'zod';
import { AppError } from '../errors/app-error.js';
import {
  CSV_BOM,
  CSV_CONTENT_TYPE,
  EXPORT_MAX_ROWS,
  exportFilename,
  parseExportHeaders,
  toCsvLine,
  type CsvValue,
} from './csv.js';
import {
  EXPORT_DATE_FORMATS,
  EXPORT_DISPLAY_DEFAULTS,
  EXPORT_TIME_FORMATS,
  displayCell,
  formatExportDateTime,
  parseExportDisplay,
  type ExportCellKind,
  type ExportDisplay,
} from './export-display.js';
import { decodeCursor, type DecodedCursor } from './keyset.js';
import { LIST_QUERY_LIMITS } from './pagination.js';
import { PDF_CONTENT_TYPE, assertPdfDrawable, toPdf } from './pdf.js';
import { XLSX_CONTENT_TYPE, toXlsx } from './xlsx.js';

/** The four formats of the Export menu (D-01, D-07); an absent `format` is `csv`. */
export const EXPORT_FORMATS = ['csv', 'xlsx', 'pdf', 'print'] as const;

/** One of `EXPORT_FORMATS`. */
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

/** The PDF and Print cap (D-06): a printed list longer than this is not read by anybody. */
export const PRINT_MAX_ROWS = 1_000;

/** The inclusive row cap per format (D-06): CSV and Excel `EXPORT_MAX_ROWS`, PDF and Print `PRINT_MAX_ROWS`. */
export const EXPORT_ROW_LIMITS: Readonly<Record<ExportFormat, number>> = Object.freeze({
  csv: EXPORT_MAX_ROWS,
  xlsx: EXPORT_MAX_ROWS,
  pdf: PRINT_MAX_ROWS,
  print: PRINT_MAX_ROWS,
});

/** The most row keys one export takes (the web sends at most one page of ticked rows). */
export const EXPORT_KEYS_MAX = LIST_QUERY_LIMITS.max;

/** A row key: a positive integer of at most 15 digits, as the lists' numeric ids are. */
export const EXPORT_KEY_PATTERN = /^[1-9]\d{0,14}$/;

/** The Print answer's `Content-Type`: JSON rows, not a file (D-28). */
export const PRINT_CONTENT_TYPE = 'application/json; charset=utf-8';

/** Whether a list takes ticked row keys (`accept`) or has no row selection (`refuse`, D-27). */
export type ExportKeyPolicy = 'accept' | 'refuse';

/** A checked export query: the format, the columns in canonical order, their labels, the keys, the display. */
export interface ExportOptions<C extends string> {
  readonly format: ExportFormat;
  readonly columns: readonly C[];
  readonly headers: readonly string[];
  readonly keys: readonly string[] | null;
  readonly display: ExportDisplay | null;
}

/** One column of a module's export: the wire value of a row, and how PDF and Print show a string. */
export interface ExportCell<Row> {
  readonly value: (row: Row) => CsvValue;
  readonly kind?: ExportCellKind;
}

/** One keyset page of the module's list read. */
export interface ExportPage<Row> {
  readonly items: readonly Row[];
  readonly nextCursor: string | null;
}

/** The part of a module's list request the loop touches: the sort the cursor is bound to, the cursor. */
export interface ExportListRequest<S extends string> {
  readonly sortField: S;
  readonly cursor: DecodedCursor<S> | null;
}

/** The Print answer (D-28): the api's export moment, the labels and the display rows, all text. */
export const exportPrintRowsSchema = z
  .object({
    exportedAt: z.string(),
    headers: z.array(z.string()),
    rows: z.array(z.array(z.string())),
  })
  .readonly();

/** The Print answer's type. */
export type PrintRows = z.infer<typeof exportPrintRowsSchema>;

/** What `replyExport` sends: a file (a name, a type, bytes or text) or the Print rows (no name). */
export interface ExportFile {
  readonly filename: string | null;
  readonly contentType: string;
  readonly body: string | Buffer | PrintRows;
}

/** Everything `runExport` needs from a module; `page` is its keyset read, `now` its clock (UTIL-02). */
export interface ExportSpec<
  S extends string,
  Req extends ExportListRequest<S>,
  Row,
  C extends string,
> {
  readonly stem: string;
  readonly cells: Readonly<Record<C, ExportCell<Row>>>;
  readonly options: ExportOptions<C>;
  readonly request: Req;
  readonly count: (request: Req) => Promise<number>;
  readonly page: (request: Req) => Promise<ExportPage<Row>>;
  readonly now: Date;
}

/** What a format's writer gets: the checked options and the wire values in column order. */
interface WriterInput {
  readonly stem: string;
  readonly now: Date;
  readonly options: ExportOptions<string>;
  readonly kinds: readonly (ExportCellKind | undefined)[];
  readonly values: readonly (readonly CsvValue[])[];
}

type Writer = (input: WriterInput) => Promise<ExportFile>;

/** The two paging keys an export refuses: it holds every matching row. */
const EXPORT_PAGING_KEYS = ['limit', 'cursor'] as const;

function refuseExport(path: string, message: string): never {
  throw new AppError('ERP-VALIDATION-0001', 'Query is invalid', {
    issues: [{ path: [path], message }],
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asList(raw: unknown): readonly unknown[] {
  return Array.isArray(raw) ? raw : [raw];
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function isKey(value: unknown): value is string {
  return typeof value === 'string' && EXPORT_KEY_PATTERN.test(value);
}

function refusePaging(raw: Readonly<Record<string, unknown>>): void {
  const sent = EXPORT_PAGING_KEYS.find((key) => raw[key] !== undefined);
  if (sent !== undefined) {
    refuseExport(sent, `an export holds every matching row; it takes no ${sent}`);
  }
}

function parseFormat(raw: unknown): ExportFormat {
  if (raw === undefined) return 'csv';
  if (isOneOf(EXPORT_FORMATS, raw)) return raw;
  return refuseExport('format', `format must be one of ${EXPORT_FORMATS.join(', ')}`);
}

/** The sent columns, each a distinct member of `columns`, answered in `columns` order (D-13). */
function parseColumns<C extends string>(raw: unknown, columns: readonly C[]): readonly C[] {
  if (raw === undefined) return columns;
  const sent = asList(raw);
  const chosen = columns.filter((column) => sent.includes(column));
  if (sent.length === 0 || chosen.length !== sent.length) {
    return refuseExport('column', `column must name distinct columns of ${columns.join(', ')}`);
  }
  return chosen;
}

/** D-27: ticked row keys, only for a list that opted in; duplicates removed. */
function parseKeys(raw: unknown, policy: ExportKeyPolicy): readonly string[] | null {
  if (raw === undefined) return null;
  if (policy === 'refuse') {
    return refuseExport('key', 'this list has no row selection; it takes no key');
  }
  const sent = asList(raw);
  const keys = sent.filter(isKey);
  if (keys.length === 0 || keys.length !== sent.length || keys.length > EXPORT_KEYS_MAX) {
    return refuseExport(
      'key',
      `key must be 1 to ${String(EXPORT_KEYS_MAX)} positive integer row keys`,
    );
  }
  return [...new Set(keys)];
}

/**
 * The export query (D-07, D-12, D-13, D-25, D-27): `limit` or `cursor` is a 400; `format` absent is
 * `csv`; `column` absent is every column, else distinct known columns in canonical order; `header`
 * one label per selected column (`parseExportHeaders`); `key` only when `spec.keys` is `accept`;
 * the presentation parameters only for `pdf` and `print`. Every refusal is 400
 * `ERP-VALIDATION-0001` on the parameter's own path.
 */
export function parseExportOptions<C extends string>(
  input: unknown,
  spec: { readonly columns: readonly C[]; readonly keys: ExportKeyPolicy },
): ExportOptions<C> {
  const raw = isRecord(input) ? input : {};
  refusePaging(raw);
  const format = parseFormat(raw.format);
  const columns = parseColumns(raw.column, spec.columns);
  const headers = parseExportHeaders(raw.header, columns);
  const keys = parseKeys(raw.key, spec.keys);
  const display =
    format === 'pdf' || format === 'print' ? parseExportDisplay(raw, columns.length) : null;
  return { format, columns, headers, keys, display };
}

function refuseOverCap(limit: number, total: number): never {
  throw new AppError('ERP-VALIDATION-0001', 'Query is invalid', {
    issues: [{ path: ['export'], message: 'too many rows to export', params: { limit, total } }],
  });
}

/** Every row the list request matches: page after page, each cursor from the page before. */
async function readAll<S extends string, Req extends ExportListRequest<S>, Row>(
  first: Req,
  page: (request: Req) => Promise<ExportPage<Row>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  let request = first;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- keyset paging: each page's cursor comes from the previous page, so the reads are sequential by design (BE-19)
    const read = await page(request);
    rows.push(...read.items);
    const cursor = decodeCursor(read.nextCursor, first.sortField);
    if (cursor === null) return rows;
    request = { ...first, cursor };
  }
}

function displayOf(options: ExportOptions<string>): ExportDisplay {
  return (
    options.display ?? {
      ...EXPORT_DISPLAY_DEFAULTS,
      blanks: options.columns.map(() => ''),
    }
  );
}

function displayRows(input: WriterInput, display: ExportDisplay): string[][] {
  const showRow = (row: readonly CsvValue[]): string[] =>
    row.map((value, index) =>
      displayCell(value, input.kinds[index], display.blanks[index] ?? '', display),
    );
  return input.values.map(showRow);
}

function writeCsv(input: WriterInput): Promise<ExportFile> {
  const lines = [toCsvLine(input.options.headers), ...input.values.map(toCsvLine)];
  return Promise.resolve({
    filename: exportFilename(input.stem, input.now, 'csv'),
    contentType: CSV_CONTENT_TYPE,
    body: CSV_BOM + lines.join(''),
  });
}

async function writeXlsx(input: WriterInput): Promise<ExportFile> {
  return {
    filename: exportFilename(input.stem, input.now, 'xlsx'),
    contentType: XLSX_CONTENT_TYPE,
    body: await toXlsx(input.options.headers, input.values, input.stem),
  };
}

async function writePdf(input: WriterInput): Promise<ExportFile> {
  const display = displayOf(input.options);
  const table = {
    title: display.title,
    dateLine: formatExportDateTime(display, input.now),
    headers: input.options.headers,
    rows: displayRows(input, display),
    createdAt: input.now,
  };
  assertPdfDrawable(table);
  return {
    filename: exportFilename(input.stem, input.now, 'pdf'),
    contentType: PDF_CONTENT_TYPE,
    body: await toPdf(table),
  };
}

function writePrint(input: WriterInput): Promise<ExportFile> {
  const display = displayOf(input.options);
  return Promise.resolve({
    filename: null,
    contentType: PRINT_CONTENT_TYPE,
    body: {
      exportedAt: input.now.toISOString(),
      headers: [...input.options.headers],
      rows: displayRows(input, display),
    },
  });
}

/** One writer per format, so `runExport` chooses without a branch (TS-10). */
const WRITERS: Readonly<Record<ExportFormat, Writer>> = Object.freeze({
  csv: writeCsv,
  xlsx: writeXlsx,
  pdf: writePdf,
  print: writePrint,
});

/**
 * The export (D-06, D-17): `count` first, and over `EXPORT_ROW_LIMITS[format]` a 400 on path
 * `['export']` with `params: { limit, total }` before any page is read; then every page through
 * `page`, following `nextCursor`; then the format's writer. A PDF whose text the standard font
 * cannot draw is refused on `['font']` (D-24).
 */
export async function runExport<
  S extends string,
  Req extends ExportListRequest<S>,
  Row,
  C extends string,
>(spec: ExportSpec<S, Req, Row, C>): Promise<ExportFile> {
  const { options, cells } = spec;
  const limit = EXPORT_ROW_LIMITS[options.format];
  const total = await spec.count(spec.request);
  if (total > limit) refuseOverCap(limit, total);
  const rows = await readAll(spec.request, spec.page);
  const valuesOf = (row: Row): CsvValue[] => options.columns.map((c) => cells[c].value(row));
  return WRITERS[options.format]({
    stem: spec.stem,
    now: spec.now,
    options,
    kinds: options.columns.map((column) => cells[column].kind),
    values: rows.map(valuesOf),
  });
}

/**
 * Sends an export (D-15): its `Content-Type`, `Cache-Control: no-store` for every format (Print
 * included), and `Content-Disposition: attachment` only for a file. Answers the body to return.
 */
export function replyExport(reply: FastifyReply, file: ExportFile): ExportFile['body'] {
  reply.header('content-type', file.contentType).header('cache-control', 'no-store');
  if (file.filename !== null) {
    reply.header('content-disposition', `attachment; filename="${file.filename}"`);
  }
  return file.body;
}

/*
 * Documentation-only fields for an export DTO's literal `.extend({ ... })` keys (BE-23): they put
 * the parameters in the OpenAPI document; `parseExportOptions` is the gate that checks them.
 */

/** `header`: one translated label per exported column (D-12). */
export const exportHeaderField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .meta({ description: 'One translated label per exported column, in column order' });

/** `format`: `csv` (default), `xlsx`, `pdf` or `print` (D-07). */
export const exportFormatField = z
  .enum(EXPORT_FORMATS)
  .optional()
  .meta({ description: 'csv (default), xlsx, pdf, or print (JSON display rows)' });

/** `column`: the visible columns to export, any order; answered in canonical order (D-13). */
export const exportColumnField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .meta({ description: 'The columns to export; absent means every column' });

/** `key`: the ticked rows' keys, only on a list that takes a row selection (D-27). */
export const exportKeyField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .meta({ description: 'The ticked row keys, at most 500; only where the list selects rows' });

/** `title`: the PDF and Print title (D-25). */
export const exportTitleField = z
  .string()
  .optional()
  .meta({ description: 'PDF and print: the title, at most 100 characters' });

/** `yes`: how PDF and Print show a true value (D-25). */
export const exportYesField = z
  .string()
  .optional()
  .meta({ description: 'PDF and print: the label of a true value' });

/** `no`: how PDF and Print show a false value (D-25). */
export const exportNoField = z
  .string()
  .optional()
  .meta({ description: 'PDF and print: the label of a false value' });

/** `blank`: how PDF and Print show an empty cell, one per exported column (D-26). */
export const exportBlankField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .meta({ description: 'PDF and print: the label of an empty cell, one per exported column' });

/** `dateFormat`: the customer's Perfex date format (D-25). */
export const exportDateFormatField = z
  .enum(EXPORT_DATE_FORMATS)
  .optional()
  .meta({ description: 'PDF and print: the Perfex date format' });

/** `timeFormat`: 24 or 12 hour time (D-25). */
export const exportTimeFormatField = z
  .enum(EXPORT_TIME_FORMATS)
  .optional()
  .meta({ description: 'PDF and print: 24 or 12 hour time' });

/** `timeZone`: the IANA zone dates are shown in (D-25). */
export const exportTimeZoneField = z
  .string()
  .optional()
  .meta({ description: 'PDF and print: the IANA time zone, such as Asia/Dubai' });
