/**
 * ExpenseCategoriesTransformer and the description codec. The codec keeps the rows Perfex-shaped:
 * `toStoredDescription` is PHP's `nl2br` (a `<br />` before each line break, the break kept) and
 * `fromStoredDescription` is Perfex's `clear_textarea_breaks` (every `<br />`, `<br/>` and `<br>`
 * removed in any case, then trimmed; `NULL` reads as `''`). Both directions are proven here
 * (RESEARCH Pitfall 6), and a value read and saved again never grows a second `<br />`.
 */
import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { expenseCategoriesResponseSchema } from '../dto/expense-categories.dto.js';
import type { ExpenseCategory, ExpenseCategoryUsage } from '../model/expense-categories.model.js';
import {
  ExpenseCategoriesTransformer,
  fromStoredDescription,
  toStoredDescription,
} from '../service/expense-categories.transformer.js';

const ROW: ExpenseCategory = { id: 1, name: 'Travel', description: 'Taxi<br />\nand trains' };

const META = { nextCursor: 'n', prevCursor: null, total: 3, rangeStart: 1 };

const MULTI_LINE_SAMPLES = [
  'Fuel\nParking\nTolls',
  '  Office supplies\r\n\r\nPaper, toner\r\n',
  'One\rTwo\n\rThree',
];

describe('toStoredDescription (PHP nl2br)', () => {
  it.each([
    ['a\r\nb', 'a<br />\r\nb'],
    ['a\nb', 'a<br />\nb'],
    ['a\rb', 'a<br />\rb'],
    ['a\n\rb', 'a<br />\n\rb'],
  ])('%j is stored as %j: one <br /> before the line break, the break kept', (text, stored) => {
    expect(toStoredDescription(text)).toBe(stored);
  });

  it('a pair counts once, then a lone break after it counts again; text without a break is unchanged', () => {
    expect(toStoredDescription('a\n\r\nb')).toBe('a<br />\n\r<br />\nb');
    expect(toStoredDescription('a\r\n\nb')).toBe('a<br />\r\n<br />\nb');
    expect(toStoredDescription('Fuel < 50 km')).toBe('Fuel < 50 km');
    expect(toStoredDescription('')).toBe('');
  });
});

describe('fromStoredDescription (Perfex clear_textarea_breaks)', () => {
  it.each([
    ['a<br />\nb', 'a\nb'],
    ['<BR>x', 'x'],
    ['x<br/>', 'x'],
    ['  x  ', 'x'],
    ['a<Br />b<bR/>c<br>d', 'abcd'],
  ])('%j reads as %j', (stored, read) => {
    expect(fromStoredDescription(stored)).toBe(read);
  });

  it('a NULL column reads as the empty string', () => {
    expect(fromStoredDescription(null)).toBe('');
  });

  it('only the three break tags are removed: other markup is kept as text (T-4.1-07)', () => {
    expect(fromStoredDescription('<b>bold</b> <br  /> <script>x</script>')).toBe(
      '<b>bold</b> <br  /> <script>x</script>',
    );
  });

  it.each(MULTI_LINE_SAMPLES)(
    'reading what was stored gives the text back, trimmed: %j',
    (text) => {
      expect(fromStoredDescription(toStoredDescription(text))).toBe(text.trim());
    },
  );

  it.each(MULTI_LINE_SAMPLES)(
    'a read value saved again is stored exactly as before, never with a second <br />: %j',
    (text) => {
      const stored = toStoredDescription(text.trim());
      const again = toStoredDescription(fromStoredDescription(stored));
      expect(again).toBe(stored);
      expect(again.split('<br />')).toHaveLength(stored.split('<br />').length);
    },
  );
});

describe('ExpenseCategoriesTransformer', () => {
  const transformer = new ExpenseCategoriesTransformer();

  it('builds the DTO field by field: the id is a string, the description in its read form', () => {
    expect(transformer.toResponse(ROW)).toEqual({
      id: '1',
      name: 'Travel',
      description: 'Taxi\nand trains',
    });
    expect(transformer.toResponse({ id: 2, name: 'None', description: null })).toEqual({
      id: '2',
      name: 'None',
      description: '',
    });
  });

  it('the list rows carry the three usage counts; an id absent from the map counts zeros', () => {
    const usage = new Map<number, ExpenseCategoryUsage>([
      [1, { expenses: 4, accountingMappings: 1, pettyCashAdvances: 2 }],
    ]);
    const other: ExpenseCategory = { id: 9, name: 'Other', description: '' };
    expect(transformer.toListResponse([ROW, other], usage, META)).toEqual({
      data: [
        {
          id: '1',
          name: 'Travel',
          description: 'Taxi\nand trains',
          expenseCount: 4,
          mappingCount: 1,
          pettyCashCount: 2,
        },
        {
          id: '9',
          name: 'Other',
          description: '',
          expenseCount: 0,
          mappingCount: 0,
          pettyCashCount: 0,
        },
      ],
      meta: { ...META, exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS },
    });
  });

  it('copies the four page fields one by one: a page object passed as the meta carries nothing else', () => {
    const page = { ...META, items: [ROW] };
    expect(Object.keys(transformer.toListResponse([], new Map(), page).meta).sort()).toEqual([
      'exportLimit',
      'nextCursor',
      'prevCursor',
      'printLimit',
      'rangeStart',
      'total',
    ]);
  });

  it('the response schema rejects a missing field, so a partial build cannot leave the transformer', () => {
    expect(expenseCategoriesResponseSchema.safeParse({ id: '1', name: 'x' }).success).toBe(false);
    expect(
      expenseCategoriesResponseSchema.safeParse({ id: '1', name: 'x', description: '' }).success,
    ).toBe(true);
  });
});
