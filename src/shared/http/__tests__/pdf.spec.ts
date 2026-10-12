import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import {
  PDF_CONTENT_TYPE,
  assertPdfDrawable,
  isPdfDrawable,
  toPdf,
  type PdfTable,
} from '../pdf.js';

/** One drawn piece of text: its font, size, start position and WinAnsi-decoded characters. */
interface DrawnText {
  readonly font: string;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly text: string;
}

/** The WinAnsi bytes of 0x80..0x9F these specs draw, back to their characters. */
const WIN_ANSI_EXTRAS: Readonly<Record<number, string>> = { 0x80: '\u20AC', 0x85: '\u2026' };

function decodeWinAnsi(hex: string): string {
  const bytes = Buffer.from(hex, 'hex');
  return [...bytes].map((byte) => WIN_ANSI_EXTRAS[byte] ?? String.fromCharCode(byte)).join('');
}

function objectsOf(pdf: string): ReadonlyMap<string, string> {
  return new Map(
    [...pdf.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g)].map((m) => [m[1] ?? '', m[2] ?? '']),
  );
}

function ref(body: string, key: string): string {
  const id = new RegExp(`/${key} (\\d+) 0 R`).exec(body)?.[1];
  if (id === undefined) throw new Error(`no /${key} in ${body.slice(0, 80)}`);
  return id;
}

/**
 * Every page of an uncompressed pdfkit document, in `/Kids` order, as the text drawn on it: each
 * `TJ` array's hex strings joined (kerning splits one string into several) and decoded, with the
 * `BaseFont` its `Tf` resource names.
 */
function pagesOf(buffer: Buffer): readonly (readonly DrawnText[])[] {
  const pdf = buffer.toString('latin1');
  const objects = objectsOf(pdf);
  const kids = /\/Kids \[([^\]]*)\]/.exec(pdf)?.[1] ?? '';
  return [...kids.matchAll(/(\d+) 0 R/g)].map((kid) => {
    const page = objects.get(kid[1] ?? '') ?? '';
    const resources = objects.get(ref(page, 'Resources')) ?? '';
    const content = objects.get(ref(page, 'Contents')) ?? '';
    const drawn = /\nstream\n([\s\S]*)\nendstream/.exec(content)?.[1] ?? '';
    return [
      ...drawn.matchAll(/1 0 0 1 ([\d.]+) ([\d.]+) Tm\n\/(F\d+) ([\d.]+) Tf\n\[(.*?)\] TJ/g),
    ].map((m) => {
      const fontObject = objects.get(ref(resources, m[3] ?? '')) ?? '';
      const hex = [...(m[5] ?? '').matchAll(/<([0-9a-f]*)>/g)].map((h) => h[1] ?? '').join('');
      return {
        font: /\/BaseFont \/(\S+)/.exec(fontObject)?.[1] ?? '',
        size: Number(m[4]),
        x: Number(m[1]),
        y: Number(m[2]),
        text: decodeWinAnsi(hex),
      };
    });
  });
}

function textsOf(page: readonly DrawnText[]): readonly string[] {
  return page.map((drawn) => drawn.text);
}

const CREATED_AT = new Date('2026-10-01T08:00:00Z');
const HEADERS = ['Id', 'First', 'Last', 'Email', 'Role', 'Active', 'Seen'];
const MANY_ROWS: readonly (readonly string[])[] = Array.from({ length: 1000 }, (_, r) =>
  HEADERS.map((_label, c) => `r${String(r)}c${String(c)}`),
);

function table(over: Partial<PdfTable> = {}): PdfTable {
  return {
    title: 'Staff members',
    dateLine: '2026-10-01 12:00:00',
    headers: ['Name', 'Email'],
    rows: [['Ann', 'ann@example.com']],
    createdAt: CREATED_AT,
    ...over,
  };
}

const FONT_ISSUES = [
  { path: ['font'], message: 'the PDF font cannot draw this text; print the list instead' },
];

/** The D-24 refusal: the one validation code; answers its issues. */
function fontIssuesOf(value: PdfTable): unknown {
  const error = ((): unknown => {
    try {
      assertPdfDrawable(value);
      return undefined;
    } catch (e: unknown) {
      return e;
    }
  })();
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe('ERP-VALIDATION-0001');
  expect((error as AppError).status).toBe(400);
  return (error as AppError).extras?.issues;
}

describe('pdf constants', () => {
  it('names the PDF content type', () => {
    expect(PDF_CONTENT_TYPE).toBe('application/pdf');
  });
});

describe('isPdfDrawable (the standard font draws WinAnsi only, D-24)', () => {
  it.each([
    ['ASCII', 'Plain text 123 =+-@'],
    ['Latin-1', 'caf\u00E9 Zo\u00EB \u00D8re \u00DF'],
    ['the euro sign', '\u20AC 12'],
    ['the ellipsis', 'cut\u2026'],
    ['a newline, a TAB and a CR', 'a\nb\tc\rd'],
    ['the curly quotes and dashes of Windows-1252', '\u2018a\u2019 \u201Cb\u201D \u2013 \u2014'],
    ['the empty string', ''],
  ])('draws %s', (_name, text) => {
    expect(isPdfDrawable(text)).toBe(true);
  });

  it.each([
    ['Arabic', '\u0645\u062D\u0645\u062F'],
    ['Cyrillic', '\u0418\u0432\u0430\u043D'],
    ['CJK', '\u5F20\u4F1F'],
    ['a C0 control', 'a\u0001b'],
    ['a C1 control that is not a Windows-1252 extra', 'a\u0081b'],
  ])('refuses %s', (_name, text) => {
    expect(isPdfDrawable(text)).toBe(false);
  });
});

describe('assertPdfDrawable (the whole PDF is refused, never garbled)', () => {
  it('passes a table of Latin text', () => {
    expect(() => {
      assertPdfDrawable(table({ rows: [['Zo\u00EB', 'z@example.com']] }));
    }).not.toThrow();
  });

  it('refuses an Arabic cell on the font path', () => {
    const rows = [
      ['Ann', 'a@example.com'],
      ['\u0645\u062D\u0645\u062F', 'm@x'],
    ];
    expect(fontIssuesOf(table({ rows }))).toEqual(FONT_ISSUES);
  });

  it('refuses an Arabic header on the font path', () => {
    expect(fontIssuesOf(table({ headers: ['\u0627\u0644\u0627\u0633\u0645', 'Email'] }))).toEqual(
      FONT_ISSUES,
    );
  });

  it('refuses an Arabic title on the font path', () => {
    expect(
      fontIssuesOf(table({ title: '\u0627\u0644\u0645\u0648\u0638\u0641\u0648\u0646' })),
    ).toEqual(FONT_ISSUES);
  });
});

describe('toPdf (A4 landscape, pdfkit standard fonts, D-14)', () => {
  it('is a PDF whose first page is A4 landscape', async () => {
    const buffer = await toPdf(table(), { compress: false });
    expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    const pdf = buffer.toString('latin1');
    expect(/\/MediaBox [^\n]*/.exec(pdf)?.[0]).toBe('/MediaBox [0 0 841.89 595.28]');
  });

  it('compresses by default', async () => {
    const pdf = (await toPdf(table())).toString('latin1');
    expect(pdf).toContain('/Filter /FlateDecode');
  });

  it('carries the title and the creation date in its metadata, read from createdAt (no clock)', async () => {
    const pdf = (await toPdf(table(), { compress: false })).toString('latin1');
    expect(pdf).toContain('(Staff members)');
    expect(pdf).toContain('(D:20261001080000Z)');
  });

  it('draws the title in Helvetica-Bold 14, the date line in Helvetica 10, then the table', async () => {
    const [first] = pagesOf(await toPdf(table(), { compress: false }));
    expect(first?.slice(0, 2).map(({ font, size, x, text }) => ({ font, size, x, text }))).toEqual([
      { font: 'Helvetica-Bold', size: 14, x: 20, text: 'Staff members' },
      { font: 'Helvetica', size: 10, x: 20, text: '2026-10-01 12:00:00' },
    ]);
    const [title, date, header] = first ?? [];
    // PDF y grows upwards: the title sits under the 20pt top margin, then each line lower.
    expect(title?.y).toBeLessThan(595.28 - 20);
    expect((title?.y ?? 0) - (date?.y ?? 0)).toBeGreaterThan(4);
    expect((date?.y ?? 0) - (header?.y ?? 0)).toBeGreaterThan(12);
    expect(first?.slice(2).map(({ font, size, text }) => ({ font, size, text }))).toEqual([
      { font: 'Helvetica-Bold', size: 10, text: 'Name' },
      { font: 'Helvetica-Bold', size: 10, text: 'Email' },
      { font: 'Helvetica', size: 10, text: 'Ann' },
      { font: 'Helvetica', size: 10, text: 'ann@example.com' },
    ]);
  });

  it('draws no title line when the title is empty', async () => {
    const [first] = pagesOf(await toPdf(table({ title: '' }), { compress: false }));
    expect(textsOf(first ?? []).slice(0, 2)).toEqual(['2026-10-01 12:00:00', 'Name']);
  });

  it('gives five columns or fewer equal widths inside the 20pt margins', async () => {
    const headers = ['A', 'B', 'C', 'D'];
    const [first] = pagesOf(
      await toPdf(table({ headers, rows: [['1', '2', '3', '4']] }), { compress: false }),
    );
    const usable = 841.89 - 40;
    const xs = (first ?? []).filter((d) => headers.includes(d.text)).map((d) => d.x);
    expect(xs.map((x) => Number(x.toFixed(2)))).toEqual(
      headers.map((_h, i) => Number((20 + 3 + (i * usable) / 4).toFixed(2))),
    );
  });

  it('draws a 1pt black rule under the header and a 0.5pt #BFBFBF rule under each body row, no other border', async () => {
    const pdf = (
      await toPdf(
        table({
          rows: [
            ['Ann', 'a@x'],
            ['Bob', 'b@x'],
          ],
        }),
        { compress: false },
      )
    ).toString('latin1');
    const widths = [...pdf.matchAll(/\n([\d.]+) w\n/g)].map((m) => m[1]);
    expect(widths.filter((w) => w === '1')).toHaveLength(2);
    expect(widths.filter((w) => w === '0.5')).toHaveLength(4);
    expect(widths.every((w) => w === '1' || w === '0.5')).toBe(true);
    expect(pdf).toContain('0.7490196078431373 0.7490196078431373 0.7490196078431373 SCN');
  });

  it('repeats the header row at the top of every page and draws nothing beyond it and the rows (no footer, D-16)', async () => {
    const pages = pagesOf(
      await toPdf(table({ headers: HEADERS, rows: MANY_ROWS }), { compress: false }),
    );
    expect(pages.length).toBeGreaterThan(1);
    expect(textsOf(pages[0] ?? []).slice(0, 2 + HEADERS.length)).toEqual([
      'Staff members',
      '2026-10-01 12:00:00',
      ...HEADERS,
    ]);
    for (const page of pages.slice(1)) {
      expect(textsOf(page).slice(0, HEADERS.length)).toEqual(HEADERS);
    }
    const drawnCells = pages.flatMap((page, index) =>
      textsOf(page).slice((index === 0 ? 2 : 0) + HEADERS.length),
    );
    expect(drawnCells).toEqual(MANY_ROWS.flat());
  });

  it('cuts a cell over 1,000 characters to 1,000 plus the ellipsis', async () => {
    const long = 'x'.repeat(1000) + 'Z'.repeat(200);
    const [first] = pagesOf(await toPdf(table({ rows: [[long, 'b']] }), { compress: false }));
    const cell = textsOf(first ?? [])
      .slice(4)
      .filter((text) => text !== 'b')
      .join('')
      .replaceAll(/\s/g, '');
    expect(cell).toBe(`${'x'.repeat(1000)}\u2026`);
  });

  it('keeps a cell of exactly 1,000 characters whole', async () => {
    const exact = 'y'.repeat(1000);
    const [first] = pagesOf(await toPdf(table({ rows: [[exact, 'b']] }), { compress: false }));
    const cell = textsOf(first ?? [])
      .slice(4)
      .filter((text) => text !== 'b')
      .join('')
      .replaceAll(/\s/g, '');
    expect(cell).toBe(exact);
  });

  it('draws a table with no rows as the header row alone', async () => {
    const [first] = pagesOf(await toPdf(table({ rows: [] }), { compress: false }));
    expect(textsOf(first ?? [])).toEqual(['Staff members', '2026-10-01 12:00:00', 'Name', 'Email']);
  });
});
