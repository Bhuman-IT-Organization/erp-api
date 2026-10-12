import type { FastifyReply } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import { CSV_BOM, CSV_CONTENT_TYPE, EXPORT_MAX_ROWS } from '../csv.js';
import { EXPORT_DISPLAY_DEFAULTS } from '../export-display.js';
import {
  EXPORT_FORMATS,
  EXPORT_KEYS_MAX,
  EXPORT_KEY_PATTERN,
  EXPORT_ROW_LIMITS,
  PRINT_CONTENT_TYPE,
  PRINT_MAX_ROWS,
  exportPrintRowsSchema,
  parseExportOptions,
  replyExport,
  runExport,
  type ExportCell,
  type ExportFile,
  type ExportFormat,
  type ExportKeyPolicy,
  type ExportListRequest,
  type ExportOptions,
  type ExportPage,
} from '../export.js';
import { encodeCursor, type DecodedCursor } from '../keyset.js';
import { LIST_QUERY_LIMITS } from '../pagination.js';
import { PDF_CONTENT_TYPE } from '../pdf.js';
import { XLSX_CONTENT_TYPE } from '../xlsx.js';

const COLUMNS = ['id', 'name', 'active', 'joined'] as const;
type Column = (typeof COLUMNS)[number];

interface Row {
  readonly id: number;
  readonly name: string;
  readonly active: boolean;
  readonly joined: string | null;
}

interface Request extends ExportListRequest<'id'> {
  readonly filter: string;
}

const CELLS: Readonly<Record<Column, ExportCell<Row>>> = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
  active: { value: (row) => row.active },
  joined: { value: (row) => row.joined, kind: 'dateTime' },
};

const NOW = new Date('2026-10-01T08:00:00Z');
const REQUEST: Request = { sortField: 'id', cursor: null, filter: 'all' };
const ANN: Row = { id: 1, name: 'Ann', active: true, joined: '2026-09-25T10:05:00Z' };
const HOSTILE: Row = { id: 2, name: '=HYPERLINK("x")', active: false, joined: null };
const ROWS: readonly Row[] = [ANN, HOSTILE];

function options(
  input: Readonly<Record<string, unknown>>,
  keys: ExportKeyPolicy = 'refuse',
): ExportOptions<Column> {
  return parseExportOptions(input, { columns: COLUMNS, keys });
}

/** Every refusal of the core is the one validation code on the parameter's own path. */
function rejectionOf(run: () => unknown): { path: unknown; params?: unknown } {
  const error = ((): unknown => {
    try {
      run();
      return undefined;
    } catch (e: unknown) {
      return e;
    }
  })();
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe('ERP-VALIDATION-0001');
  expect((error as AppError).status).toBe(400);
  const issues = (error as AppError).extras?.issues;
  expect(Array.isArray(issues) && issues.length === 1).toBe(true);
  return (issues as { path: unknown; params?: unknown }[])[0] ?? { path: null };
}

async function asyncRejectionOf(run: () => Promise<unknown>): Promise<unknown> {
  const error = await run().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe('ERP-VALIDATION-0001');
  const issues = (error as AppError).extras?.issues;
  expect(Array.isArray(issues)).toBe(true);
  return (issues as unknown[])[0];
}

function onePage(items: readonly Row[] = ROWS): {
  count: ReturnType<typeof vi.fn<(request: Request) => Promise<number>>>;
  page: ReturnType<typeof vi.fn<(request: Request) => Promise<ExportPage<Row>>>>;
} {
  return {
    count: vi.fn<(request: Request) => Promise<number>>().mockResolvedValue(items.length),
    page: vi
      .fn<(request: Request) => Promise<ExportPage<Row>>>()
      .mockResolvedValue({ items, nextCursor: null }),
  };
}

function exportOf(
  format: ExportFormat,
  extra: Readonly<Record<string, unknown>> = {},
  source = onePage(),
): Promise<ExportFile> {
  return runExport({
    stem: 'staff-members',
    cells: CELLS,
    options: options({ format, ...extra }),
    request: REQUEST,
    count: source.count,
    page: source.page,
    now: NOW,
  });
}

describe('export constants', () => {
  it('names four formats, the two caps per format, the key rule and the print type', () => {
    expect(EXPORT_FORMATS).toEqual(['csv', 'xlsx', 'pdf', 'print']);
    expect(PRINT_MAX_ROWS).toBe(1_000);
    expect(EXPORT_ROW_LIMITS).toEqual({
      csv: EXPORT_MAX_ROWS,
      xlsx: EXPORT_MAX_ROWS,
      pdf: PRINT_MAX_ROWS,
      print: PRINT_MAX_ROWS,
    });
    expect(EXPORT_KEYS_MAX).toBe(LIST_QUERY_LIMITS.max);
    expect(EXPORT_KEY_PATTERN.test('1')).toBe(true);
    expect(PRINT_CONTENT_TYPE).toBe('application/json; charset=utf-8');
  });
});

describe('parseExportOptions: format (D-07)', () => {
  it('reads an absent format as csv', () => {
    expect(options({}).format).toBe('csv');
  });

  it.each(EXPORT_FORMATS)('accepts %s', (format) => {
    expect(options({ format }).format).toBe(format);
  });

  it('refuses docx, a repeated format and a non-text format on the format path', () => {
    expect(rejectionOf(() => options({ format: 'docx' })).path).toEqual(['format']);
    expect(rejectionOf(() => options({ format: ['csv', 'xlsx'] })).path).toEqual(['format']);
    expect(rejectionOf(() => options({ format: 1 })).path).toEqual(['format']);
  });

  it('refuses limit and cursor on their own paths (an export holds every row)', () => {
    expect(rejectionOf(() => options({ limit: '50' })).path).toEqual(['limit']);
    expect(rejectionOf(() => options({ cursor: 'abc' })).path).toEqual(['cursor']);
  });

  it('reads a non-object query as no parameters', () => {
    expect(parseExportOptions(null, { columns: COLUMNS, keys: 'refuse' })).toEqual({
      format: 'csv',
      columns: COLUMNS,
      headers: COLUMNS,
      keys: null,
      display: null,
    });
  });
});

describe('parseExportOptions: column and header (D-12, D-13)', () => {
  it('answers every column in canonical order when none is sent', () => {
    expect(options({}).columns).toEqual(COLUMNS);
    expect(options({}).headers).toEqual(COLUMNS);
  });

  it('answers the sent columns in canonical order, whatever order they arrive in', () => {
    expect(options({ column: ['name', 'id'] }).columns).toEqual(['id', 'name']);
    expect(options({ column: 'joined' }).columns).toEqual(['joined']);
  });

  it('refuses an unknown, repeated, empty or non-text column on the column path', () => {
    for (const column of [['nope'], ['id', 'id'], [], [1], { 0: 'id' }, 'secret']) {
      expect(rejectionOf(() => options({ column })).path).toEqual(['column']);
    }
  });

  it('checks the header count against the selected columns', () => {
    expect(options({ column: ['name', 'id'], header: ['Id', 'Name'] }).headers).toEqual([
      'Id',
      'Name',
    ]);
    expect(
      rejectionOf(() => options({ column: ['name', 'id'], header: ['Id', 'Name', 'Active'] })).path,
    ).toEqual(['header']);
  });
});

describe('parseExportOptions: key (D-03, D-27)', () => {
  it("refuses any key when the module's policy is refuse", () => {
    expect(rejectionOf(() => options({ key: '7' })).path).toEqual(['key']);
  });

  it('answers null when no key is sent', () => {
    expect(options({}, 'accept').keys).toBeNull();
  });

  it('answers the keys with duplicates removed, a single key as one', () => {
    expect(options({ key: ['7', '7', '9'] }, 'accept').keys).toEqual(['7', '9']);
    expect(options({ key: '12' }, 'accept').keys).toEqual(['12']);
  });

  it('accepts exactly 500 keys and refuses 501', () => {
    const keys = Array.from({ length: EXPORT_KEYS_MAX + 1 }, (_, i) => String(i + 1));
    expect(options({ key: keys.slice(0, EXPORT_KEYS_MAX) }, 'accept').keys).toHaveLength(500);
    expect(rejectionOf(() => options({ key: keys }, 'accept')).path).toEqual(['key']);
  });

  it.each([['0'], ['-1'], ['1.5'], ['abc'], ['1234567890123456']])('refuses the key %s', (key) => {
    expect(rejectionOf(() => options({ key }, 'accept')).path).toEqual(['key']);
  });

  it('refuses an empty key list and a non-text key', () => {
    expect(rejectionOf(() => options({ key: [] }, 'accept')).path).toEqual(['key']);
    expect(rejectionOf(() => options({ key: [7] }, 'accept')).path).toEqual(['key']);
  });
});

describe('parseExportOptions: the presentation parameters (D-25)', () => {
  it('reads them only for pdf and print', () => {
    const hostile = { timeZone: 'Mars/Base', title: 'A'.repeat(101) };
    expect(options({ format: 'csv', ...hostile }).display).toBeNull();
    expect(options({ format: 'xlsx', ...hostile }).display).toBeNull();
    expect(rejectionOf(() => options({ format: 'pdf', timeZone: 'Mars/Base' })).path).toEqual([
      'timeZone',
    ]);
    expect(rejectionOf(() => options({ format: 'print', title: 'A'.repeat(101) })).path).toEqual([
      'title',
    ]);
  });

  it('sizes the blanks to the selected columns', () => {
    expect(options({ format: 'print', column: ['id', 'joined'] }).display).toEqual({
      ...EXPORT_DISPLAY_DEFAULTS,
      blanks: ['', ''],
    });
    expect(
      rejectionOf(() => options({ format: 'pdf', column: ['id', 'joined'], blank: ['a'] })).path,
    ).toEqual(['blank']);
  });
});

describe('runExport: the caps (D-06), counted before any page is read', () => {
  it.each([
    ['csv', EXPORT_MAX_ROWS],
    ['xlsx', EXPORT_MAX_ROWS],
    ['pdf', PRINT_MAX_ROWS],
    ['print', PRINT_MAX_ROWS],
  ] as const)('%s allows exactly %i rows', async (format, limit) => {
    const source = onePage([]);
    source.count.mockResolvedValue(limit);
    await exportOf(format, {}, source);
    expect(source.page).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['csv', EXPORT_MAX_ROWS],
    ['xlsx', EXPORT_MAX_ROWS],
    ['pdf', PRINT_MAX_ROWS],
    ['print', PRINT_MAX_ROWS],
  ] as const)('%s refuses %i + 1 on the export path with both numbers', async (format, limit) => {
    const source = onePage();
    source.count.mockResolvedValue(limit + 1);
    expect(await asyncRejectionOf(() => exportOf(format, {}, source))).toEqual({
      path: ['export'],
      message: 'too many rows to export',
      params: { limit, total: limit + 1 },
    });
    expect(source.count).toHaveBeenCalledWith(REQUEST);
    expect(source.page).not.toHaveBeenCalled();
  });
});

describe('runExport: the one keyset loop (D-17)', () => {
  it('follows nextCursor across three pages and stops on null', async () => {
    const first = encodeCursor('id', [1, 1], 'after');
    const second = encodeCursor('id', [2, 2], 'after');
    const pages: ExportPage<Row>[] = [
      { items: [ANN], nextCursor: first },
      { items: [HOSTILE], nextCursor: second },
      { items: [{ id: 3, name: 'Cy', active: true, joined: null }], nextCursor: null },
    ];
    const source = onePage();
    source.count.mockResolvedValue(3);
    source.page.mockImplementation((request) => {
      const index = request.cursor === null ? 0 : request.cursor.key[1];
      return Promise.resolve(pages[index] ?? { items: [], nextCursor: null });
    });
    const file = await exportOf('csv', {}, source);
    expect(source.page).toHaveBeenCalledTimes(3);
    const cursors = source.page.mock.calls.map(([request]) => request.cursor);
    const expected: (DecodedCursor<'id'> | null)[] = [
      null,
      { sort: 'id', key: [1, 1], direction: 'after' },
      { sort: 'id', key: [2, 2], direction: 'after' },
    ];
    expect(cursors).toEqual(expected);
    expect(source.page.mock.calls.every(([request]) => request.filter === 'all')).toBe(true);
    expect(file.body).toBe(
      `${CSV_BOM}id,name,active,joined\r\n1,Ann,1,2026-09-25T10:05:00Z\r\n2,"'=HYPERLINK(""x"")",0,\r\n3,Cy,1,\r\n`,
    );
  });

  it("refuses a nextCursor minted for another sort, as the list's own reader does", async () => {
    const source = onePage();
    source.page.mockResolvedValue({
      items: ROWS,
      nextCursor: encodeCursor('name', ['Ann', 1], 'after'),
    });
    expect(await asyncRejectionOf(() => exportOf('csv', {}, source))).toMatchObject({
      path: ['cursor'],
    });
  });
});

describe('runExport: one writer per format', () => {
  it('csv: the BOM, the header line of the selected columns, the wire values', async () => {
    const file = await exportOf('csv', { column: ['name', 'id'], header: ['Id', 'Name'] });
    expect(file.filename).toBe('staff-members-2026-10-01.csv');
    expect(file.contentType).toBe(CSV_CONTENT_TYPE);
    expect(file.body).toBe(`${CSV_BOM}Id,Name\r\n1,Ann\r\n2,"'=HYPERLINK(""x"")"\r\n`);
  });

  it('xlsx: a zip buffer named .xlsx', async () => {
    const file = await exportOf('xlsx');
    expect(file.filename).toBe('staff-members-2026-10-01.xlsx');
    expect(file.contentType).toBe(XLSX_CONTENT_TYPE);
    expect(Buffer.isBuffer(file.body)).toBe(true);
    expect((file.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('pdf: a PDF buffer named .pdf', async () => {
    const file = await exportOf('pdf', { title: 'Staff', yes: 'Yes', no: 'No' });
    expect(file.filename).toBe('staff-members-2026-10-01.pdf');
    expect(file.contentType).toBe(PDF_CONTENT_TYPE);
    expect(Buffer.isBuffer(file.body)).toBe(true);
    expect((file.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('print: the display rows as JSON, no file name (D-28)', async () => {
    const file = await exportOf('print', {
      header: ['Id', 'Name', 'Active', 'Joined'],
      yes: 'Yes',
      no: 'No',
      blank: ['', '', '', 'Never'],
      dateFormat: 'd-m-Y',
      timeFormat: '12',
      timeZone: 'Asia/Dubai',
    });
    expect(file.filename).toBeNull();
    expect(file.contentType).toBe(PRINT_CONTENT_TYPE);
    expect(exportPrintRowsSchema.parse(file.body)).toEqual({
      exportedAt: '2026-10-01T08:00:00.000Z',
      headers: ['Id', 'Name', 'Active', 'Joined'],
      rows: [
        ['1', 'Ann', 'Yes', '25-09-2026 2:05 PM'],
        ['2', '=HYPERLINK("x")', 'No', 'Never'],
      ],
    });
  });

  it('print: an absent presentation reads the wire 1/0 and ISO-like UTC dates', async () => {
    const file = await exportOf('print');
    expect(exportPrintRowsSchema.parse(file.body).rows).toEqual([
      ['1', 'Ann', '1', '2026-09-25 10:05:00'],
      ['2', '=HYPERLINK("x")', '0', ''],
    ]);
  });

  it('refuses an Arabic row as pdf on the font path and prints it', async () => {
    const arabic: readonly Row[] = [
      { id: 1, name: '\u0645\u062D\u0645\u062F', active: true, joined: null },
    ];
    expect(await asyncRejectionOf(() => exportOf('pdf', {}, onePage(arabic)))).toMatchObject({
      path: ['font'],
    });
    const printed = await exportOf('print', {}, onePage(arabic));
    expect(exportPrintRowsSchema.parse(printed.body).rows).toEqual([
      ['1', '\u0645\u062D\u0645\u062F', '1', ''],
    ]);
  });

  it('writes a pdf of a hand-built option set with no display as the defaults', async () => {
    const file = await runExport({
      stem: 'staff-members',
      cells: CELLS,
      options: { format: 'pdf', columns: COLUMNS, headers: COLUMNS, keys: null, display: null },
      request: REQUEST,
      ...onePage(),
      now: NOW,
    });
    expect((file.body as Buffer).subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

describe('replyExport (D-15)', () => {
  function fakeReply(): { reply: FastifyReply; headers: Map<string, string> } {
    const headers = new Map<string, string>();
    const reply = {
      header(key: string, value: string) {
        headers.set(key, value);
        return reply;
      },
    };
    return { reply: reply as unknown as FastifyReply, headers };
  }

  it('sets the type, no-store and the attachment name for a file, and answers the body', () => {
    const { reply, headers } = fakeReply();
    const file: ExportFile = {
      filename: 'staff-members-2026-10-01.pdf',
      contentType: PDF_CONTENT_TYPE,
      body: Buffer.from('%PDF-'),
    };
    expect(replyExport(reply, file)).toBe(file.body);
    expect(Object.fromEntries(headers)).toEqual({
      'content-type': PDF_CONTENT_TYPE,
      'cache-control': 'no-store',
      'content-disposition': 'attachment; filename="staff-members-2026-10-01.pdf"',
    });
  });

  it('sets no-store and no attachment for print rows', () => {
    const { reply, headers } = fakeReply();
    const body = { exportedAt: NOW.toISOString(), headers: ['Id'], rows: [['1']] };
    expect(replyExport(reply, { filename: null, contentType: PRINT_CONTENT_TYPE, body })).toBe(
      body,
    );
    expect(Object.fromEntries(headers)).toEqual({
      'content-type': PRINT_CONTENT_TYPE,
      'cache-control': 'no-store',
    });
  });
});
