/**
 * The rate arithmetic (`roundRate`: half away from zero to two places in string arithmetic, the
 * `DECIMAL(15,2)` bound), Perfex's `default_tax` match (`isNamedInDefaultTaxes`, its own substring
 * test) and the DTOs: the id as a string, the rate as stored, the usage and the default flag on
 * every row, the facade's `{ id, name, rate }`.
 */
import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { taxesResponseSchema } from '../dto/taxes.dto.js';
import type { TaxRow, TaxUsage } from '../model/taxes.model.js';
import {
  isNamedInDefaultTaxes,
  NO_TAX_USAGE,
  RATE_PATTERN,
  roundRate,
  TaxesTransformer,
  toResponse,
  toTax,
} from '../service/taxes.transformer.js';

const ROW: TaxRow = { id: 7, name: 'VAT', taxrate: '5.00' };
const META = { nextCursor: 'n', prevCursor: null, total: 3, rangeStart: 1 };
const USED: TaxUsage = { ...NO_TAX_USAGE, items: 2, accounting: 1 };

describe('roundRate (DECIMAL(15,2), half away from zero, no float)', () => {
  it.each([
    ['15', '15.00'],
    ['5.555', '5.56'],
    ['-5.555', '-5.56'],
    ['5.554', '5.55'],
    ['0.004', '0.00'],
    ['-0.004', '0.00'],
    ['.5', '0.50'],
    ['007.1', '7.10'],
    ['12.', '12.00'],
    ['9999999999999.994', '9999999999999.99'],
    ['0.125', '0.13'],
    ['1.005', '1.01'],
    ['-0', '0.00'],
    ['-12.345', '-12.35'],
  ])('%s rounds to %s', (text, rounded) => {
    expect(roundRate(text)).toBe(rounded);
  });

  it.each(['9999999999999.995', '10000000000000', '-99999999999999'])(
    '%s is null: more than 13 integer digits after rounding',
    (text) => {
      expect(roundRate(text)).toBeNull();
    },
  );

  it.each(['1,000.5', 'abc', '1e3', '', '-', '+1', ' 1'])(
    'RATE_PATTERN refuses %j, and roundRate answers null for it',
    (text) => {
      expect(RATE_PATTERN.test(text)).toBe(false);
      expect(roundRate(text)).toBeNull();
    },
  );
});

describe("isNamedInDefaultTaxes (Perfex's own substring match, Taxes_model.php:89-101)", () => {
  const setting = 'a:1:{i:0;s:8:"VAT|5.00";}';

  it('is true when <name>|<rate> appears in the setting', () => {
    expect(isNamedInDefaultTaxes(setting, 'VAT', '5.00')).toBe(true);
  });

  it('is false for another rate or another name', () => {
    expect(isNamedInDefaultTaxes(setting, 'VAT', '5.50')).toBe(false);
    expect(isNamedInDefaultTaxes(setting, 'GST', '5.00')).toBe(false);
  });

  it('is false for an empty setting (the option absent)', () => {
    expect(isNamedInDefaultTaxes('', 'VAT', '5.00')).toBe(false);
  });
});

describe('the DTOs', () => {
  it('toResponse writes String(id), the stored two-decimal rate, the usage and the flag', () => {
    expect(toResponse(ROW, USED, true)).toEqual({
      id: '7',
      name: 'VAT',
      rate: '5.00',
      usage: USED,
      isDefault: true,
    });
  });

  it('toTax maps taxrate to rate, keeping the numeric id', () => {
    expect(toTax(ROW)).toEqual({ id: 7, name: 'VAT', rate: '5.00' });
  });

  it('the response schema strips what it does not name and refuses a missing field', () => {
    expect(
      taxesResponseSchema.parse({ ...toResponse(ROW, USED, false), taxrate: '5.00' }),
    ).not.toHaveProperty('taxrate');
    expect(taxesResponseSchema.safeParse({ id: '1', name: 'x', rate: '1.00' }).success).toBe(false);
  });
});

describe('TaxesTransformer', () => {
  const transformer = new TaxesTransformer();

  it('a record reads its usage from the map (zeros when absent) and its flag from the setting', () => {
    expect(transformer.toResponse(ROW, new Map([[7, USED]]), 'VAT|5.00')).toMatchObject({
      usage: USED,
      isDefault: true,
    });
    expect(transformer.toResponse(ROW, new Map(), '')).toMatchObject({
      usage: NO_TAX_USAGE,
      isDefault: false,
    });
  });

  it('the list rows carry their usage and flag; the meta copies the four page fields and the limits', () => {
    const other: TaxRow = { id: 9, name: 'GST', taxrate: '10.00' };
    const page = { ...META, items: [ROW] };
    const body = transformer.toListResponse([ROW, other], new Map([[7, USED]]), 'GST|10.00', page);
    expect(body.data.map((row) => [row.id, row.usage.items, row.isDefault])).toEqual([
      ['7', 2, false],
      ['9', 0, true],
    ]);
    expect(body.meta).toEqual({
      ...META,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });
});
