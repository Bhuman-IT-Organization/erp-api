/**
 * The transformer: the response built field by field, `canMakeBase`, the facade's `Currency`, the
 * export rows, the group helpers (`coreInUse`, `inUseGroups`, `lockGroups`, `isInUseAtAll`) and the
 * words of the five refusals (counts and plain words only, joined `a, b and c`).
 */
import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { CurrencyLockUsage, CurrencyUsage } from '../model/currencies.model.js';
import {
  baseLockedDetail,
  codeLockedDetail,
  coreInUse,
  CURRENCIES_EXPORT_CELLS,
  CurrenciesTransformer,
  inUseDetail,
  inUseGroups,
  isInUseAtAll,
  lockGroups,
  LOCK_USAGE_WORDS,
  NO_CURRENCY_LOCK_USAGE,
  NO_CURRENCY_REFERENCES,
  NO_CURRENCY_USAGE,
  registeredDetail,
  registeredRecord,
  toCurrency,
  toExportRow,
  toResponse,
  USAGE_WORDS,
} from '../service/currencies.transformer.js';
import { SEED_CURRENCIES } from './fakes.js';

const [BASE, EUR_TWO, , AED] = SEED_CURRENCIES;
if (BASE === undefined || EUR_TWO === undefined || AED === undefined) throw new Error('seed');

const usage = (overrides: Partial<CurrencyUsage>): CurrencyUsage => ({
  ...NO_CURRENCY_USAGE,
  ...overrides,
});
const lockUsage = (overrides: Partial<CurrencyLockUsage>): CurrencyLockUsage => ({
  ...NO_CURRENCY_LOCK_USAGE,
  ...overrides,
});
const PROBE_ROWS = (count: number) => [{ key: 'probeRows', noun: 'probe row', count }];

describe('the groups', () => {
  it('lists the 24 delete-counting groups and the 3 lock-only groups, in the detail order', () => {
    expect(USAGE_WORDS.map(([group]) => group)).toEqual(Object.keys(NO_CURRENCY_USAGE));
    expect(USAGE_WORDS).toHaveLength(24);
    expect(LOCK_USAGE_WORDS.map(([group]) => group)).toEqual([
      'exchangeRates',
      'exchangeRateLogs',
      'payslipCodes',
    ]);
  });

  it('coreInUse sums Perfex seven core groups only', () => {
    expect(coreInUse(usage({ invoices: 2, subscriptions: 1, purchaseOrders: 9 }))).toBe(3);
    expect(coreInUse(usage({ vendors: 4, fixedEquipmentLocations: 1 }))).toBe(0);
  });

  it('inUseGroups and lockGroups name the non-zero groups only', () => {
    expect(inUseGroups(usage({ expenses: 1, payslipsTo: 2 }))).toEqual([
      '1 expense(s)',
      '2 payslip(s) paid in it',
    ]);
    expect(lockGroups(lockUsage({ exchangeRateLogs: 3 }))).toEqual([
      '3 exchange rate log reference(s)',
    ]);
  });

  it('isInUseAtAll is true for any group of the three (answer 8 c)', () => {
    expect(isInUseAtAll(NO_CURRENCY_USAGE, NO_CURRENCY_LOCK_USAGE, {})).toBe(false);
    expect(isInUseAtAll(NO_CURRENCY_USAGE, NO_CURRENCY_LOCK_USAGE, { probeRows: 0 })).toBe(false);
    expect(isInUseAtAll(usage({ vendors: 1 }), NO_CURRENCY_LOCK_USAGE, {})).toBe(true);
    expect(isInUseAtAll(NO_CURRENCY_USAGE, lockUsage({ exchangeRates: 1 }), {})).toBe(true);
    expect(isInUseAtAll(NO_CURRENCY_USAGE, NO_CURRENCY_LOCK_USAGE, { probeRows: 1 })).toBe(true);
  });
});

describe('the refusal details', () => {
  it('0001 names every non-zero delete group, joined a, b and c; null when none', () => {
    expect(inUseDetail(NO_CURRENCY_USAGE)).toBeNull();
    expect(inUseDetail(usage({ invoices: 1 }))).toBe('used by 1 invoice(s)');
    expect(inUseDetail(usage({ invoices: 2, fafRequests: 1, fixedEquipmentLocations: 3 }))).toBe(
      'used by 2 invoice(s), 1 FAF request(s) and 3 fixed equipment location(s)',
    );
  });

  it('0001 has the words of all 24 groups in order', () => {
    const all = usage(Object.fromEntries(USAGE_WORDS.map(([group]) => [group, 1])));
    expect(inUseDetail(all)).toBe(
      'used by 1 invoice(s), 1 expense(s), 1 proposal(s), 1 estimate(s), 1 customer(s), 1 credit note(s), 1 subscription(s), 1 purchase order(s), 1 purchase request(s), 1 purchase quotation(s), 1 purchase invoice(s), 1 debit note(s), 1 FAF request(s), 1 vendor(s), 1 goods receipt(s), 1 goods delivery note(s), 1 packing list(s), 1 order return(s), 1 fixed equipment cart(s), 1 payslip(s) converted from it, 1 payslip(s) paid in it, 1 purchase document(s) converted from it, 1 purchase document(s) converted to it and 1 fixed equipment location(s)',
    );
  });

  it('0003 names each registered counter above 0 by its noun', () => {
    expect(registeredDetail(PROBE_ROWS(0))).toBeNull();
    expect(registeredDetail(PROBE_ROWS(2))).toBe('used by 2 probe row(s); remove them first');
    expect(
      registeredDetail([
        { key: 'a', noun: 'probe row', count: 1 },
        { key: 'b', noun: 'shelf label', count: 4 },
      ]),
    ).toBe('used by 1 probe row(s) and 4 shelf label(s); remove them first');
  });

  it('0004 names the non-zero core groups of the base only', () => {
    expect(baseLockedDetail(usage({ vendors: 3 }))).toBeNull();
    expect(baseLockedDetail(usage({ invoices: 2, expenses: 1, vendors: 3 }))).toBe(
      'the base currency is used by 2 invoice(s) and 1 expense(s); Perfex does not allow changing the base currency once it has transactions',
    );
  });

  it('0005 names every use: delete groups, lock groups, then registered counters', () => {
    expect(codeLockedDetail(NO_CURRENCY_REFERENCES, PROBE_ROWS(0))).toBeNull();
    expect(
      codeLockedDetail(
        {
          usage: usage({ invoices: 1 }),
          lockUsage: lockUsage({ exchangeRates: 2, payslipCodes: 1 }),
        },
        PROBE_ROWS(5),
      ),
    ).toBe(
      'it is in use (1 invoice(s), 2 exchange rate reference(s), 1 payslip(s) showing its code and 5 probe row(s)), so its code cannot change: past records would show another code; the symbol, the separators and the placement can',
    );
    expect(codeLockedDetail(NO_CURRENCY_REFERENCES, PROBE_ROWS(1))).toBe(
      'it is in use (1 probe row(s)), so its code cannot change: past records would show another code; the symbol, the separators and the placement can',
    );
  });
});

describe('the response, the facade shape and the export', () => {
  it('builds the record field by field, the id as text', () => {
    const counts = { usage: usage({ invoices: 1 }), lockUsage: lockUsage({ exchangeRates: 2 }) };
    expect(toResponse(EUR_TWO, counts, PROBE_ROWS(3), false)).toEqual({
      id: '2',
      name: 'EUR',
      symbol: 'EUR',
      decimalSeparator: ',',
      thousandSeparator: '.',
      placement: 'after',
      isBase: false,
      usage: counts.usage,
      lockUsage: counts.lockUsage,
      registeredUsage: { probeRows: 3 },
      canMakeBase: true,
    });
  });

  it('keeps NULL separators and placement as null', () => {
    const answer = toResponse(AED, NO_CURRENCY_REFERENCES, [], false);
    expect([answer.decimalSeparator, answer.thousandSeparator, answer.placement]).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('canMakeBase: never for the base, never while the base is locked', () => {
    expect(toResponse(BASE, NO_CURRENCY_REFERENCES, [], false).canMakeBase).toBe(false);
    expect(toResponse(EUR_TWO, NO_CURRENCY_REFERENCES, [], true).canMakeBase).toBe(false);
    expect(toResponse(EUR_TWO, NO_CURRENCY_REFERENCES, [], false).canMakeBase).toBe(true);
  });

  it('registeredRecord keys each counter by its key', () => {
    expect(registeredRecord([])).toEqual({});
    expect(registeredRecord(PROBE_ROWS(0))).toEqual({ probeRows: 0 });
  });

  it('the facade shape carries the stored fields and isBase, never a count', () => {
    expect(toCurrency(BASE)).toEqual({
      id: 1,
      name: 'USD',
      symbol: '$',
      decimalSeparator: '.',
      thousandSeparator: ',',
      placement: 'before',
      isBase: true,
    });
  });

  it('the export row is the code, the symbol and isBase, and each cell reads its column', () => {
    const row = toExportRow(BASE);
    expect(row).toEqual({ name: 'USD', symbol: '$', isBase: true });
    expect(CURRENCIES_EXPORT_CELLS.name.value(row)).toBe('USD');
    expect(CURRENCIES_EXPORT_CELLS.symbol.value(row)).toBe('$');
    expect(CURRENCIES_EXPORT_CELLS.isBase.value(row)).toBe(true);
  });
});

describe('CurrenciesTransformer', () => {
  const transformer = new CurrenciesTransformer();

  it('the list envelope: zeros for an id without counts, the meta copied with both limits', () => {
    const answer = transformer.toListResponse(
      [BASE, EUR_TWO],
      new Map([[2, { usage: usage({ invoices: 4 }), lockUsage: NO_CURRENCY_LOCK_USAGE }]]),
      new Map([[1, PROBE_ROWS(1)]]),
      true,
      { nextCursor: 'n', prevCursor: null, total: 2, rangeStart: 1 },
    );
    expect(answer.data.map((row) => row.usage.invoices)).toEqual([0, 4]);
    expect(answer.data.map((row) => row.registeredUsage)).toEqual([{ probeRows: 1 }, {}]);
    expect(answer.data.map((row) => row.canMakeBase)).toEqual([false, false]);
    expect(answer.meta).toEqual({
      nextCursor: 'n',
      prevCursor: null,
      total: 2,
      rangeStart: 1,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });

  it('the make-base answer is the id as text and isBase true', () => {
    expect(transformer.toBaseResponse(7)).toEqual({ id: '7', isBase: true });
  });
});
