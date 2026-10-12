/**
 * The one currency-code schema of the ERP (04.1 Currencies planning answer 7): the api's DTO builds
 * its `name` field from these three exports, and erp-web's currency form holds a byte-identical
 * mirror of this file (`src/config/currency-code.ts`, compared byte for byte by a drift test,
 * answer 8 b), because erp-web does not depend on erp-api (ADR-0007). So this file is plain
 * TypeScript and imports nothing.
 *
 * Perfex's rules, as its Currencies screen keeps them: the code field caps the input at three
 * characters (`views/admin/currencies/manage.php:106`, `maxlength 3`; ISO 4217 codes are three
 * letters) and the model upper-cases the posted code with PHP's `strtoupper`
 * (`Currencies_model.php` :64 and :85), which in PHP 8 changes only the ASCII letters a to z. The
 * trim is the planner's simplification the leads agreed (Perfex saved the posted code untrimmed).
 */

/** The longest code: Perfex's form cap and ISO 4217. One limit for the api and the form. */
export const CURRENCY_CODE_MAX = 3;

/** The ASCII lower-case letters PHP 8's `strtoupper` changes; every other character is kept. */
const ASCII_LOWER = /[a-z]/g;

/**
 * The code as Node stores it: `raw` trimmed, then only `a` to `z` turned into `A` to `Z` (PHP 8's
 * `strtoupper`), so a sharp s (U+00DF), an e acute (U+00E9) and a dotless i (U+0131) stay as
 * they are.
 */
export function toCurrencyCode(raw: string): string {
  return raw.trim().replace(ASCII_LOWER, (letter) => letter.toUpperCase());
}

/**
 * What is wrong with a code already through `toCurrencyCode`, or `null`: `'required'` when it is
 * empty, `'too_long'` when it holds more than `CURRENCY_CODE_MAX` characters (code points, so one
 * character outside the Basic Multilingual Plane counts once).
 */
export function currencyCodeProblem(code: string): 'required' | 'too_long' | null {
  if (code === '') return 'required';
  return Array.from(code).length > CURRENCY_CODE_MAX ? 'too_long' : null;
}
