/**
 * The PDF export (Phase 4.1.1, ADR-0043, D-14, D-16, D-24): A4 landscape, 20pt margins, the title
 * (Helvetica-Bold 14) and the export date (Helvetica 10) on top, then one table in Helvetica 10 with
 * a Helvetica-Bold header row repeated at the top of every page, a 1pt black rule under the header
 * and a 0.5pt grey rule under each body row. Every cell is display text (`export-display.ts`); a
 * cell over 1,000 characters is cut with an ellipsis so no row is taller than a page.
 *
 * Why one table per page: pdfkit's table has no repeat-header option and breaks a page on its own.
 * So every row is measured first, exactly as pdfkit measures it (`boundsOfString` in the cell's
 * width and font, plus the padding), the rows are split into pages, and each page is drawn as its
 * own table whose first row is the header. The page-two spec case pins it.
 *
 * Why the refusal (D-24): the standard fonts draw WinAnsi only, and pdfkit silently draws anything
 * else as garbage. `assertPdfDrawable` refuses the whole PDF with a 400 on path `['font']` instead;
 * Print keeps every script (Arabic PDF is parked, D-09).
 *
 * What this does NOT do: no logo, footer, page numbers or totals row (D-16), and no clock read: the
 * creation date is `createdAt`, given by the caller.
 */
import PDFDocument from 'pdfkit';
import { AppError } from '../errors/app-error.js';

/** The PDF `Content-Type`. */
export const PDF_CONTENT_TYPE = 'application/pdf';

/** One PDF export: its title and date line, the header labels and the display rows. */
export interface PdfTable {
  readonly title: string;
  readonly dateLine: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly createdAt: Date;
}

/** Writer options: `compress` defaults to true; the specs pass false to read the page contents. */
export interface PdfOptions {
  readonly compress?: boolean;
}

/** The margin on all four sides, narrow and still inside every printer's reach (D-14). */
const PDF_MARGIN_PT = 20;
/** The body, header and date line size. */
const PDF_BODY_SIZE_PT = 10;
/** The title size. */
const PDF_TITLE_SIZE_PT = 14;
/** The gap between the title and the date line. */
const PDF_DATE_GAP_PT = 4;
/** The gap between the date line and the table. */
const PDF_TABLE_GAP_PT = 12;
/** The padding inside every cell. */
const PDF_CELL_PADDING_PT = 3;
/** The rule under the header row. */
const PDF_HEADER_RULE_PT = 1;
/** The rule under each body row. */
const PDF_ROW_RULE_PT = 0.5;
/** The body rule's mid grey. */
const PDF_ROW_RULE_COLOUR = '#BFBFBF';
/** The header rule's colour. */
const PDF_HEADER_RULE_COLOUR = 'black';
/** A cell longer than this is cut and ends in the ellipsis. */
const PDF_CELL_MAX_CHARS = 1000;
/** At or below this many columns every column is the same width (Perfex `app.js:980-985`). */
const PDF_EQUAL_WIDTH_MAX_COLUMNS = 5;
/** A body row always fits under the header on a fresh page, with this much room to spare. */
const PDF_ROW_FIT_SLACK_PT = 1;
/** The ellipsis U+2026, drawable in WinAnsi (0x85). */
const ELLIPSIS = '\u2026';
const FONT_REGULAR = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

/**
 * The 27 characters Windows-1252 places in 0x80..0x9F, which the standard fonts' WinAnsi encoding
 * draws: the euro sign, the low and curly quotes, dagger, per mille, the Latin extras, the bullet,
 * the dashes, tilde and the trade mark. Escapes, never the characters themselves.
 */
const WIN_ANSI_EXTRAS =
  '\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u017E\u0178';

/**
 * Every character the standard fonts draw: TAB, LF, CR, printable ASCII, Latin-1 from the
 * no-break space up, and the extras (none of them is special inside a character class).
 */
const WIN_ANSI_TEXT = new RegExp(
  `^[\\t\\n\\r\\u0020-\\u007E\\u00A0-\\u00FF${WIN_ANSI_EXTRAS}]*$`,
  'u',
);

/** Six columns or more: pdfkit shares the width out itself (`'*'`, a style every column takes). */
const AUTO_WIDTH: PDFKit.Mixins.ColumnStyle = { width: '*' };

const HEADER_BORDER = { top: 0, right: 0, bottom: PDF_HEADER_RULE_PT, left: 0 } as const;
const BODY_BORDER = { top: 0, right: 0, bottom: PDF_ROW_RULE_PT, left: 0 } as const;

/** The room a cell's text has: the column minus its padding, the page minus its padding. */
interface TextBox {
  readonly width: number;
  readonly height: number;
}

/** The page geometry and the row styles every page's table shares. */
interface PdfLayout {
  readonly box: TextBox;
  readonly columnStyles: number[] | PDFKit.Mixins.ColumnStyle;
  readonly headerRow: readonly PDFKit.Mixins.CellOptions[];
  readonly headerHeight: number;
  readonly rowMaxHeight: number;
  readonly maxY: number;
}

/**
 * True when the standard fonts can draw every character of `text`: TAB, LF, CR, U+0020..U+007E,
 * U+00A0..U+00FF and the 27 Windows-1252 extras of 0x80..0x9F.
 */
export function isPdfDrawable(text: string): boolean {
  return WIN_ANSI_TEXT.test(text);
}

/**
 * D-24: the title, the date line, every header and every cell must be drawable, or the whole PDF
 * is refused with 400 `ERP-VALIDATION-0001` on the `['font']` path (the web offers Print instead).
 */
export function assertPdfDrawable(table: PdfTable): void {
  const texts = [table.title, table.dateLine, ...table.headers, ...table.rows.flat()];
  if (texts.every(isPdfDrawable)) return;
  throw new AppError('ERP-VALIDATION-0001', 'Query is invalid', {
    issues: [
      { path: ['font'], message: 'the PDF font cannot draw this text; print the list instead' },
    ],
  });
}

function cutCell(text: string): string {
  return text.length > PDF_CELL_MAX_CHARS ? text.slice(0, PDF_CELL_MAX_CHARS) + ELLIPSIS : text;
}

function cutRow(row: readonly string[]): string[] {
  return row.map(cutCell);
}

/**
 * The text height of one cell in the current font, as pdfkit's table measures it. The overload
 * without `x, y`: given coordinates, `boundsOfString` leaves the document's cursor there.
 */
function textHeight(doc: PDFKit.PDFDocument, text: string, box: TextBox): number {
  if (text === '') return 0;
  return doc.boundsOfString(text, {
    width: box.width,
    height: box.height,
    ellipsis: true,
    align: 'left',
  }).height;
}

/** A row's height: its tallest cell plus the padding, capped at `maxHeight`. */
function rowHeight(
  doc: PDFKit.PDFDocument,
  cells: readonly string[],
  box: TextBox,
  maxHeight: number,
): number {
  const tallest = Math.max(0, ...cells.map((text) => textHeight(doc, text, box)));
  return Math.min(tallest + 2 * PDF_CELL_PADDING_PT, maxHeight);
}

function headerCell(text: string): PDFKit.Mixins.CellOptions {
  return {
    text,
    type: 'TH',
    font: { src: FONT_BOLD },
    border: HEADER_BORDER,
    borderColor: { bottom: PDF_HEADER_RULE_COLOUR },
  };
}

function pageLayout(doc: PDFKit.PDFDocument, headers: readonly string[]): PdfLayout {
  const { page } = doc;
  const usable = page.width - page.margins.left - page.margins.right;
  const contentHeight = page.maxY() - page.margins.top;
  const count = Math.max(headers.length, 1);
  const columnWidth = usable / count;
  const box = {
    width: columnWidth - 2 * PDF_CELL_PADDING_PT,
    height: contentHeight - 2 * PDF_CELL_PADDING_PT,
  };
  doc.font(FONT_BOLD).fontSize(PDF_BODY_SIZE_PT);
  const headerHeight = rowHeight(doc, headers, box, contentHeight);
  doc.font(FONT_REGULAR).fontSize(PDF_BODY_SIZE_PT);
  return {
    box,
    columnStyles:
      headers.length <= PDF_EQUAL_WIDTH_MAX_COLUMNS ? headers.map(() => columnWidth) : AUTO_WIDTH,
    headerRow: headers.map(headerCell),
    headerHeight,
    rowMaxHeight: contentHeight - headerHeight - PDF_ROW_FIT_SLACK_PT,
    maxY: page.maxY(),
  };
}

/** The title (when there is one) and the date line; the table starts at `doc.y` after them. */
function drawHeading(doc: PDFKit.PDFDocument, table: PdfTable): void {
  if (table.title !== '') {
    doc.font(FONT_BOLD).fontSize(PDF_TITLE_SIZE_PT).text(table.title);
    doc.y += PDF_DATE_GAP_PT;
  }
  doc.font(FONT_REGULAR).fontSize(PDF_BODY_SIZE_PT).text(table.dateLine);
  doc.y += PDF_TABLE_GAP_PT;
}

/**
 * The rows split into pages: a row that would reach the bottom margin starts the next page, below
 * that page's header row, exactly where pdfkit would otherwise break on its own.
 */
function splitPages(
  heights: readonly number[],
  rows: readonly (readonly string[])[],
  firstTop: number,
  layout: PdfLayout,
): (readonly string[])[][] {
  const pages: (readonly string[])[][] = [[]];
  let y = firstTop + layout.headerHeight;
  for (const [index, row] of rows.entries()) {
    const height = heights[index] ?? 0;
    if (y + height >= layout.maxY) {
      pages.push([]);
      y = PDF_MARGIN_PT + layout.headerHeight;
    }
    pages.at(-1)?.push(row);
    y += height;
  }
  return pages;
}

function bodyCell(text: string): PDFKit.Mixins.CellOptions {
  return { text, border: BODY_BORDER, borderColor: { bottom: PDF_ROW_RULE_COLOUR } };
}

function bodyRow(row: readonly string[]): PDFKit.Mixins.CellOptions[] {
  return row.map(bodyCell);
}

/** One page's table: the header row first, then the page's rows. */
function drawPage(
  doc: PDFKit.PDFDocument,
  layout: PdfLayout,
  rows: readonly (readonly string[])[],
  index: number,
): void {
  if (index > 0) doc.addPage();
  doc.font(FONT_REGULAR).fontSize(PDF_BODY_SIZE_PT);
  doc.table({
    columnStyles: layout.columnStyles,
    rowStyles: { maxHeight: layout.rowMaxHeight },
    defaultStyle: { padding: PDF_CELL_PADDING_PT },
    data: [[...layout.headerRow], ...rows.map(bodyRow)],
  });
}

function drawDocument(doc: PDFKit.PDFDocument, table: PdfTable): void {
  drawHeading(doc, table);
  const layout = pageLayout(doc, table.headers);
  const rows = table.rows.map(cutRow);
  const heights = rows.map((row) => rowHeight(doc, row, layout.box, layout.rowMaxHeight));
  splitPages(heights, rows, doc.y, layout).forEach((pageRows, index) => {
    drawPage(doc, layout, pageRows, index);
  });
}

/**
 * The PDF bytes of `table` (D-14). Call `assertPdfDrawable` first: this writer draws what it is
 * given. `options.compress` defaults to true.
 */
export function toPdf(table: PdfTable, options: PdfOptions = {}): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'landscape',
      margins: {
        top: PDF_MARGIN_PT,
        bottom: PDF_MARGIN_PT,
        left: PDF_MARGIN_PT,
        right: PDF_MARGIN_PT,
      },
      compress: options.compress ?? true,
      info: { Title: table.title, CreationDate: table.createdAt },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
    drawDocument(doc, table);
    doc.end();
  });
}
