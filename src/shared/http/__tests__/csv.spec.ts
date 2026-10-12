import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import {
  CSV_BOM,
  CSV_CONTENT_TYPE,
  EXPORT_HEADER_MAX_LENGTH,
  EXPORT_FILE_EXTENSIONS,
  EXPORT_MAX_ROWS,
  csvCell,
  escapeFormula,
  exportFilename,
  parseExportHeaders,
  toCsvLine,
} from '../csv.js';

/** Every header refusal is the one validation code on the `header` path (D-42). */
function headerRejection(raw: unknown, fallback: readonly string[]): AppError {
  const error = ((): unknown => {
    try {
      parseExportHeaders(raw, fallback);
      return undefined;
    } catch (e: unknown) {
      return e;
    }
  })();
  expect(error).toBeInstanceOf(AppError);
  expect((error as AppError).code).toBe('ERP-VALIDATION-0001');
  expect((error as AppError).status).toBe(400);
  expect((error as AppError).extras?.issues).toEqual([
    expect.objectContaining({ path: ['header'] }),
  ]);
  return error as AppError;
}

describe('csv constants', () => {
  it('the BOM is U+FEFF, the cap 10,000 rows, a header at most 100 characters, the type text/csv in UTF-8', () => {
    expect(CSV_BOM).toBe('\uFEFF');
    expect(EXPORT_MAX_ROWS).toBe(10_000);
    expect(EXPORT_HEADER_MAX_LENGTH).toBe(100);
    expect(CSV_CONTENT_TYPE).toBe('text/csv; charset=utf-8');
  });
});

describe('csvCell (RFC 4180 quoting, OWASP CSV injection)', () => {
  it('writes plain text as is', () => {
    expect(csvCell('plain')).toBe('plain');
  });
  it('quotes a cell holding a comma', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
  });
  it('quotes a cell holding a double quote and doubles the quote', () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
  it('quotes a cell holding a line feed', () => {
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
  });
  it('writes null as an empty cell', () => {
    expect(csvCell(null)).toBe('');
  });
  it('writes true as 1 and false as 0', () => {
    expect(csvCell(true)).toBe('1');
    expect(csvCell(false)).toBe('0');
  });
  it('writes a number in its plain decimal form', () => {
    expect(csvCell(12)).toBe('12');
  });
  it('prefixes a leading = with an apostrophe', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
  });
  it('prefixes a leading + with an apostrophe', () => {
    expect(csvCell('+1')).toBe("'+1");
  });
  it('prefixes a leading - with an apostrophe', () => {
    expect(csvCell('-2')).toBe("'-2");
  });
  it('prefixes a leading @ with an apostrophe', () => {
    expect(csvCell('@x')).toBe("'@x");
  });
  it('prefixes a leading TAB with an apostrophe (and quotes it only when it needs quoting)', () => {
    expect(csvCell('\tx')).toBe("'\tx");
    expect(csvCell('\tx,y')).toBe('"\'\tx,y"');
  });
  it('prefixes a leading CR with an apostrophe and quotes it, because it holds a CR', () => {
    expect(csvCell('\rx')).toBe('"\'\rx"');
  });
  it('escapes first, then quotes', () => {
    expect(csvCell('=a,b')).toBe('"\'=a,b"');
  });
  it('leaves a formula character that is not first alone', () => {
    expect(csvCell('a=b')).toBe('a=b');
  });
});

describe('escapeFormula (the one formula escape for CSV and Excel, D-11)', () => {
  it('prefixes a cell that starts like a formula with an apostrophe', () => {
    expect(escapeFormula('=1+1')).toBe("'=1+1");
    expect(escapeFormula('+1')).toBe("'+1");
    expect(escapeFormula('-1')).toBe("'-1");
    expect(escapeFormula('@x')).toBe("'@x");
    expect(escapeFormula('\tx')).toBe("'\tx");
    expect(escapeFormula('\rx')).toBe("'\rx");
  });
  it('leaves a formula character that is not first alone, and never quotes', () => {
    expect(escapeFormula('a=b')).toBe('a=b');
    expect(escapeFormula('a,b')).toBe('a,b');
    expect(escapeFormula('')).toBe('');
  });
});

describe('toCsvLine', () => {
  it('joins the cells with commas and ends the line with CRLF', () => {
    expect(toCsvLine(['a', null, 'b"c'])).toBe('a,,"b""c"\r\n');
  });
  it('escapes a translated header label like any cell (D-42)', () => {
    expect(toCsvLine(['=HYPERLINK("x")'])).toBe('"\'=HYPERLINK(""x"")"\r\n');
  });
});

describe('parseExportHeaders (D-42: the translated labels are untrusted)', () => {
  it('answers the fallback (the wire names) when no header is sent', () => {
    expect(parseExportHeaders(undefined, ['x', 'y'])).toEqual(['x', 'y']);
  });
  it('answers the labels when their count equals the columns', () => {
    expect(parseExportHeaders(['Name', 'Email'], ['x', 'y'])).toEqual(['Name', 'Email']);
  });
  it('treats a single string as a one-element array', () => {
    expect(parseExportHeaders('Name', ['x'])).toEqual(['Name']);
  });
  it('refuses a count that differs from the columns', () => {
    expect(headerRejection(['A'], ['x', 'y']).message).toBe('Query is invalid');
  });
  it('refuses a label longer than 100 characters', () => {
    expect(headerRejection(['A'.repeat(101), 'B'], ['x', 'y']).message).toBe('Query is invalid');
  });
  it('accepts a label of exactly 100 characters', () => {
    expect(parseExportHeaders(['A'.repeat(100), 'B'], ['x', 'y'])).toEqual(['A'.repeat(100), 'B']);
  });
  it('refuses labels that are not strings', () => {
    expect(headerRejection([1, 2], ['x', 'y']).message).toBe('Query is invalid');
  });
  it('refuses a header that is neither a string nor an array', () => {
    expect(headerRejection({ 0: 'A' }, ['x']).message).toBe('Query is invalid');
  });
});

describe('exportFilename (built from constants, never from input)', () => {
  it('is the stem and the UTC date', () => {
    expect(exportFilename('staff-members', new Date('2026-09-25T23:30:00Z'))).toBe(
      'staff-members-2026-09-25.csv',
    );
  });
  it('throws on a stem outside /^[a-z][a-z0-9-]*$/', () => {
    expect(() => exportFilename('Bad Stem', new Date('2026-09-25T00:00:00Z'))).toThrow();
    expect(() => exportFilename('a"b', new Date('2026-09-25T00:00:00Z'))).toThrow();
  });
  it('admits digits after the first letter (a generated module may be named form-1099); upper case, a space and a quote still throw', () => {
    const now = new Date('2026-09-26T00:00:00Z');
    expect(exportFilename('form-1099', now)).toBe('form-1099-2026-09-26.csv');
    expect(() => exportFilename('Form', now)).toThrow();
    expect(() => exportFilename('a b', now)).toThrow();
    expect(() => exportFilename('a"b', now)).toThrow();
    expect(() => exportFilename('1099-form', now)).toThrow();
  });
  it('takes the extension from the validated enum, csv by default (D-15)', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    expect(EXPORT_FILE_EXTENSIONS).toEqual(['csv', 'xlsx', 'pdf']);
    expect(exportFilename('roles', now, 'xlsx')).toBe('roles-2026-10-01.xlsx');
    expect(exportFilename('roles', now, 'pdf')).toBe('roles-2026-10-01.pdf');
    expect(exportFilename('roles', now, 'csv')).toBe('roles-2026-10-01.csv');
    expect(exportFilename('roles', now)).toBe('roles-2026-10-01.csv');
  });
  it('still throws on a stem that is not a lowercase constant, whatever the extension', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    expect(() => exportFilename('Roles X', now, 'xlsx')).toThrow(Error);
    expect(() => exportFilename('Roles X', now, 'pdf')).toThrow(Error);
  });
});
