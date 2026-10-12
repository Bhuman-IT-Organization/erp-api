/**
 * The one currency-code schema (`src/currency-code.ts`, 04.1 Currencies planning answer 7): PHP 8's
 * ASCII-only `strtoupper` after a trim, and the one length limit. erp-web's byte mirror runs the
 * same file, so these cases hold on both sides.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { CURRENCY_CODE_MAX, currencyCodeProblem, toCurrencyCode } from '../src/currency-code.js';

describe('toCurrencyCode (trim, then PHP 8 strtoupper: a to z only)', () => {
  it.each([
    ['usd', 'USD'],
    [' eUr ', 'EUR'],
    ['\u00df', '\u00df'],
    ['\u00e9', '\u00e9'],
    ['\u0131', '\u0131'],
    ['\u20ac\u20ac\u20ac', '\u20ac\u20ac\u20ac'],
    ['', ''],
    ['   ', ''],
  ])('%j becomes %j', (raw, code) => {
    expect(toCurrencyCode(raw)).toBe(code);
  });
});

describe('currencyCodeProblem (on the transformed code)', () => {
  it('the limit is 3, Perfex form cap and ISO 4217', () => {
    expect(CURRENCY_CODE_MAX).toBe(3);
  });

  it.each([
    ['', 'required'],
    ['   ', 'required'],
    ['ABCD', 'too_long'],
    ['\u20ac\u20ac\u20ac', null],
    ['USD', null],
    ['A', null],
  ])('%j answers %j', (raw, problem) => {
    expect(currencyCodeProblem(toCurrencyCode(raw))).toBe(problem);
  });

  it('counts code points, so three characters outside the BMP are not too long', () => {
    expect(currencyCodeProblem('\u{1F4B0}\u{1F4B0}\u{1F4B0}')).toBeNull();
    expect(currencyCodeProblem('\u{1F4B0}\u{1F4B0}\u{1F4B0}\u{1F4B0}')).toBe('too_long');
  });
});

describe('the file erp-web mirrors byte for byte', () => {
  it('imports nothing', () => {
    const source = readFileSync(new URL('../src/currency-code.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/^\s*import\b/m);
    expect(source).not.toMatch(/\brequire\(/);
  });
});
