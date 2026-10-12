/**
 * The ONE reference register (`CURRENCY_REFERENCES`, D-40, Currencies planning answer 1) against
 * the schema mirror: every line's table and column exist in `prisma/schema.prisma` (the int spec
 * proves the same on the local database, and the runtime probe still counts an absent column 0 with
 * no error, D-28), every line has one of the three kinds, the delete counts exactly the 24 id groups
 * and never the exchange rates, their logs or the payslip code snapshots, and the two columns the
 * leads left out are not in it (answer 3).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CURRENCY_REFERENCES, referenceKey } from '../repository/currencies.repository.js';
import { NO_CURRENCY_LOCK_USAGE, NO_CURRENCY_USAGE } from '../service/currencies.transformer.js';

const SCHEMA = readFileSync(new URL('../../../../prisma/schema.prisma', import.meta.url), 'utf8');

/** The field names of one model of the mirror, or `null` when the model is absent. */
function fieldsOf(table: string): readonly string[] | null {
  const start = SCHEMA.indexOf(`\nmodel ${table} {`);
  if (start === -1) return null;
  const end = SCHEMA.indexOf('\n}', start);
  return SCHEMA.slice(start, end)
    .split('\n')
    .slice(2)
    .map((line) => line.trim().split(/\s+/)[0] ?? '')
    .filter((name) => /^[a-z_][a-z0-9_]*$/.test(name));
}

/** The 24 delete-counting groups of the interfaces, in the detail's order. */
const DELETE_GROUPS = Object.keys(NO_CURRENCY_USAGE);

describe('CURRENCY_REFERENCES, the one register', () => {
  it('D-40: every register column exists', () => {
    const missing = CURRENCY_REFERENCES.filter(
      (reference) => !(fieldsOf(reference.table) ?? []).includes(reference.column),
    ).map(referenceKey);
    expect(missing, 'a register line names a column prisma/schema.prisma lacks').toEqual([]);
  });

  it('lists each table and column once, frozen', () => {
    const keys = CURRENCY_REFERENCES.map(referenceKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(40);
    expect(Object.isFrozen(CURRENCY_REFERENCES)).toBe(true);
  });

  it('every line has one of the three kinds; an integer line can also be read as bytes', () => {
    for (const reference of CURRENCY_REFERENCES) {
      expect(['integerId', 'idAsText', 'codeAsText']).toContain(reference.match);
      expect(reference.byValue === undefined, referenceKey(reference)).toBe(
        reference.match !== 'integerId',
      );
      expect(typeof reference.byBytes).toBe('function');
    }
  });

  it('the delete counts exactly the 24 id groups, every id kind among them', () => {
    const counted = [
      ...new Set(
        CURRENCY_REFERENCES.filter((reference) => reference.countsForDelete).map(
          (reference) => reference.group,
        ),
      ),
    ];
    expect(counted).toEqual(DELETE_GROUPS);
    for (const reference of CURRENCY_REFERENCES.filter((line) => line.countsForDelete)) {
      expect(reference.match, referenceKey(reference)).not.toBe('codeAsText');
    }
  });

  it('D-40: the exchange rates, their logs and the payslip codes never count for a delete', () => {
    const lockOnly = CURRENCY_REFERENCES.filter((reference) => !reference.countsForDelete);
    expect([...new Set(lockOnly.map((reference) => reference.group))]).toEqual(
      Object.keys(NO_CURRENCY_LOCK_USAGE),
    );
    expect(
      CURRENCY_REFERENCES.filter((reference) =>
        ['tblcurrency_rates', 'tblcurrency_rate_logs'].includes(reference.table),
      ).every((reference) => !reference.countsForDelete),
    ).toBe(true);
  });

  it('the converted-from, converted-to and location lines hold the id as text (answer 1)', () => {
    const idAsText = CURRENCY_REFERENCES.filter((reference) => reference.match === 'idAsText');
    expect(idAsText.map(referenceKey)).toEqual([
      'tblpur_request.from_currency',
      'tblpur_estimates.from_currency',
      'tblpur_orders.from_currency',
      'tblpur_invoices.from_currency',
      'tblpur_request.to_currency',
      'tblpur_estimates.to_currency',
      'tblpur_orders.to_currency',
      'tblpur_invoices.to_currency',
      'tblfe_locations.location_currency',
    ]);
  });

  it('the code lines are the rate, rate-log and payslip name columns', () => {
    expect(
      CURRENCY_REFERENCES.filter((reference) => reference.match === 'codeAsText').map(referenceKey),
    ).toEqual([
      'tblcurrency_rates.from_currency_name',
      'tblcurrency_rates.to_currency_name',
      'tblcurrency_rate_logs.from_currency_name',
      'tblcurrency_rate_logs.to_currency_name',
      'tblhrp_payslips.from_currency_name',
      'tblhrp_payslips.to_currency_name',
    ]);
  });

  it('names neither tblcheque_management nor tblacc_checks (answer 3)', () => {
    for (const reference of CURRENCY_REFERENCES) {
      expect(reference.table).not.toBe('tblcheque_management');
      expect(reference.table).not.toBe('tblacc_checks');
    }
  });
});
