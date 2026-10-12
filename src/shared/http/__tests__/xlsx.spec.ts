import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  XLSX_CONTENT_TYPE,
  XLSX_DEFAULT_SHEET,
  XLSX_SHEET_NAME_MAX,
  toXlsx,
  type XlsxCell,
} from '../xlsx.js';

/** The workbook's parts as text, read back from the real bytes. */
async function readBack(
  header: readonly string[],
  rows: readonly (readonly XlsxCell[])[],
  sheet?: string,
): Promise<{ readonly buffer: Buffer; readonly parts: Readonly<Record<string, string>> }> {
  const buffer = await toXlsx(header, rows, sheet);
  const files = unzipSync(new Uint8Array(buffer));
  const parts: Record<string, string> = {};
  for (const [name, bytes] of Object.entries(files)) parts[name] = strFromU8(bytes);
  return { buffer, parts };
}

function part(parts: Readonly<Record<string, string>>, name: string): string {
  const text = parts[name];
  if (text === undefined) throw new Error(`missing part ${name}`);
  return text;
}

const XML_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

function unescapeXml(text: string): string {
  return text.replaceAll(/&(?:amp|lt|gt|quot|apos);/g, (entity) => XML_ENTITIES[entity] ?? entity);
}

interface ReadCell {
  readonly ref: string;
  readonly style: string | null;
  readonly shared: boolean;
  readonly value: string | null;
}

/** Every `<c>` of the sheet, a shared string resolved to its text. */
function readCells(parts: Readonly<Record<string, string>>): readonly ReadCell[] {
  const strings = [...part(parts, 'xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)].map(
    (match) => unescapeXml((match[1] ?? '').replaceAll(/<[^>]+>/g, '')),
  );
  const sheet = part(parts, 'xl/worksheets/sheet1.xml');
  return [...sheet.matchAll(/<c ([^>]*?)(?:\/>|>(.*?)<\/c>)/gs)].map((match) => {
    const attributes = match[1] ?? '';
    const ref = /\br="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? '';
    const style = /\bs="(\d+)"/.exec(attributes)?.[1] ?? null;
    const shared = /\bt="s"/.test(attributes);
    const raw = /<v>(.*?)<\/v>/s.exec(match[2] ?? '')?.[1];
    const value = raw === undefined ? null : shared ? (strings[Number(raw)] ?? null) : raw;
    return { ref, style, shared, value };
  });
}

function cellAt(cells: readonly ReadCell[], ref: string): ReadCell | undefined {
  return cells.find((cell) => cell.ref === ref);
}

describe('xlsx constants', () => {
  it('names the content type, the 31-character sheet cap and the default sheet', () => {
    expect(XLSX_CONTENT_TYPE).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(XLSX_SHEET_NAME_MAX).toBe(31);
    expect(XLSX_DEFAULT_SHEET).toBe('export');
  });
});

describe('toXlsx (typed cells, never a formula, D-11)', () => {
  const header = ['Name', 'Count', 'Active', '=HYPERLINK("x")'];
  const rows: readonly (readonly XlsxCell[])[] = [
    ['Ann', 12.5, true, '=HYPERLINK("x")'],
    ['Bob', 0, false, null],
    ['@me', -3, true, 'plain'],
  ];

  it('is a zip (starts with PK) holding exactly one worksheet', async () => {
    const { buffer, parts } = await readBack(header, rows, 'staff-members');
    expect(Buffer.isBuffer(buffer)).toBe(true);
    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
    expect(Object.keys(parts).filter((name) => name.startsWith('xl/worksheets/sheet'))).toEqual([
      'xl/worksheets/sheet1.xml',
    ]);
    expect([...part(parts, 'xl/workbook.xml').matchAll(/<sheet /g)]).toHaveLength(1);
    expect(part(parts, 'xl/workbook.xml')).toContain('name="staff-members"');
  });

  it('cuts the sheet name to 31 characters (a 40-character stem)', async () => {
    const stem = 'a'.repeat(20) + 'b'.repeat(20);
    const { parts } = await readBack(header, rows, stem);
    expect(part(parts, 'xl/workbook.xml')).toContain(`name="${stem.slice(0, 31)}"`);
    expect(part(parts, 'xl/workbook.xml')).not.toContain(`name="${stem}"`);
  });

  it('names the sheet "export" when no sheet is given', async () => {
    const { parts } = await readBack(header, rows);
    expect(part(parts, 'xl/workbook.xml')).toContain('name="export"');
  });

  it('writes no formula element anywhere', async () => {
    const { parts } = await readBack(header, rows, 'staff');
    for (const [name, text] of Object.entries(parts)) {
      expect(text, name).not.toMatch(/<f[\s>/]/);
    }
  });

  it('types numbers as numbers and booleans as the numbers 1 and 0 (D-10)', async () => {
    const { parts } = await readBack(header, rows, 'staff');
    const cells = readCells(parts);
    expect(cellAt(cells, 'B2')).toMatchObject({ shared: false, value: '12.5' });
    expect(cellAt(cells, 'B3')).toMatchObject({ shared: false, value: '0' });
    expect(cellAt(cells, 'B4')).toMatchObject({ shared: false, value: '-3' });
    expect(cellAt(cells, 'C2')).toMatchObject({ shared: false, value: '1' });
    expect(cellAt(cells, 'C3')).toMatchObject({ shared: false, value: '0' });
    expect(part(parts, 'xl/worksheets/sheet1.xml')).not.toMatch(/\bt="b"/);
  });

  it('types strings as text, with the formula escape on a data cell and on a header label', async () => {
    const { parts } = await readBack(header, rows, 'staff');
    const cells = readCells(parts);
    expect(cellAt(cells, 'A2')).toMatchObject({ shared: true, value: 'Ann' });
    expect(cellAt(cells, 'D2')).toMatchObject({ shared: true, value: '\'=HYPERLINK("x")' });
    expect(cellAt(cells, 'A4')).toMatchObject({ shared: true, value: "'@me" });
    expect(cellAt(cells, 'D1')).toMatchObject({ shared: true, value: '\'=HYPERLINK("x")' });
  });

  it('writes null as an empty cell', async () => {
    const { parts } = await readBack(header, rows, 'staff');
    expect(cellAt(readCells(parts), 'D3')?.value ?? null).toBeNull();
  });

  it('makes the header row bold and frozen', async () => {
    const { parts } = await readBack(header, rows, 'staff');
    const styles = part(parts, 'xl/styles.xml');
    const fonts = [...styles.matchAll(/<font(?:\s[^>]*)?>(.*?)<\/font>/gs)].map((m) => m[1] ?? '');
    const cellXfs = /<cellXfs[^>]*>(.*?)<\/cellXfs>/s.exec(styles)?.[1] ?? '';
    const xfs = [...cellXfs.matchAll(/<xf\b([^>]*)>/g)].map((m) => m[1] ?? '');
    const isBold = (style: string | null): boolean => {
      const fontId = /\bfontId="(\d+)"/.exec(xfs[Number(style ?? '0')] ?? '')?.[1] ?? '0';
      return (fonts[Number(fontId)] ?? '').includes('<b/>');
    };
    const cells = readCells(parts);
    for (const ref of ['A1', 'B1', 'C1', 'D1'])
      expect(isBold(cellAt(cells, ref)?.style ?? null), ref).toBe(true);
    for (const ref of ['A2', 'B2', 'C2'])
      expect(isBold(cellAt(cells, ref)?.style ?? null), ref).toBe(false);
    const sheet = part(parts, 'xl/worksheets/sheet1.xml');
    expect(sheet).toMatch(/<pane [^>]*ySplit="1"/);
    expect(sheet).toMatch(/<pane [^>]*state="frozen"/);
  });

  it('fills a header cell given a colour and leaves the rest unfilled (headerFills)', async () => {
    const buffer = await toXlsx(header, rows, 'staff', ['#ff9800', undefined, '#03a9f4']);
    const files = unzipSync(new Uint8Array(buffer));
    const styles = strFromU8(files['xl/styles.xml'] ?? new Uint8Array());
    const fills = [...styles.matchAll(/<fill>(.*?)<\/fill>/gs)].map(
      (m) => /<fgColor rgb="(\w+)"/.exec(m[1] ?? '')?.[1] ?? null,
    );
    const cellXfs = /<cellXfs[^>]*>(.*?)<\/cellXfs>/s.exec(styles)?.[1] ?? '';
    const xfs = [...cellXfs.matchAll(/<xf\b([^>]*)>/g)].map((m) => m[1] ?? '');
    const parts: Record<string, string> = {};
    for (const [name, bytes] of Object.entries(files)) parts[name] = strFromU8(bytes);
    const fillOf = (ref: string): string | null => {
      const xf = xfs[Number(cellAt(readCells(parts), ref)?.style ?? '0')] ?? '';
      const fillId = /\bfillId="(\d+)"/.exec(xf)?.[1];
      return fillId === undefined ? null : (fills[Number(fillId)] ?? null);
    };
    expect([fillOf('A1'), fillOf('B1'), fillOf('C1'), fillOf('D1'), fillOf('A2')]).toEqual([
      'FFFF9800',
      null,
      'FF03A9F4',
      null,
      null,
    ]);
  });

  it('has exactly the rows plus the header row, no footer (D-16)', async () => {
    const { parts } = await readBack(header, rows, 'staff');
    expect([...part(parts, 'xl/worksheets/sheet1.xml').matchAll(/<row /g)]).toHaveLength(
      rows.length + 1,
    );
  });
});
