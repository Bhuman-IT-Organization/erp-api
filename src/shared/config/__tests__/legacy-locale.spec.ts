import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LEGACY_LANGUAGE_TO_LOCALE,
  SUPPORTED_LOCALES,
  toLocale,
} from '../legacy-locale.js';

describe('legacy-locale', () => {
  it('maps the legacy pack names the web switches on', () => {
    expect(toLocale('english')).toBe('en');
    expect(toLocale('arabic')).toBe('ar');
  });

  it('trims and lower-cases the stored name', () => {
    expect(toLocale('Arabic ')).toBe('ar');
    expect(toLocale('  ENGLISH')).toBe('en');
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['null', null],
    ['undefined', undefined],
    ['unknown', 'klingon'],
    ['a prototype name', 'constructor'],
  ])('answers null for an %s value', (_label, value) => {
    expect(toLocale(value)).toBeNull();
  });

  it('every table value is a BCP-47 tag (language, optional region) and the default is en', () => {
    const TAG = /^[a-z]{2,3}(-[A-Z]{2})?$/;
    for (const [name, locale] of Object.entries(LEGACY_LANGUAGE_TO_LOCALE)) {
      expect(locale, name).toMatch(TAG);
      expect(name).toMatch(/^[a-z_]+$/);
    }
    expect(DEFAULT_LOCALE).toBe('en');
    expect(Object.isFrozen(LEGACY_LANGUAGE_TO_LOCALE)).toBe(true);
  });
});

/**
 * `SUPPORTED_LOCALES` is what `GET /api/v1/identity/locales` offers, so it must be the set erp-web
 * really ships message packs for — not the 28 legacy pack folders and not an aspiration. The sibling
 * check reads erp-web's own `SUPPORTED_LOCALES` when the repository is beside this one (the
 * `perfex-mapping.spec.ts` precedent) and skips when it is not, so CI without the sibling stays green.
 */
describe('SUPPORTED_LOCALES — what this deployment offers', () => {
  it('is a frozen list of BCP-47 tags paired with a legacy pack name the mapping knows', () => {
    expect(Object.isFrozen(SUPPORTED_LOCALES)).toBe(true);
    expect(SUPPORTED_LOCALES.length).toBeGreaterThan(0);
    for (const entry of SUPPORTED_LOCALES) {
      expect(entry.locale, entry.legacyLanguage).toMatch(/^[a-z]{2,3}(-[A-Z]{2})?$/);
      expect(toLocale(entry.legacyLanguage)).toBe(entry.locale);
      expect(Object.isFrozen(entry)).toBe(true);
    }
    expect(SUPPORTED_LOCALES.map((entry) => entry.locale)).toContain(DEFAULT_LOCALE);
  });

  it('names no locale twice and no legacy pack name twice', () => {
    const locales = SUPPORTED_LOCALES.map((entry) => entry.locale);
    const names = SUPPORTED_LOCALES.map((entry) => entry.legacyLanguage);
    expect(new Set(locales).size).toBe(locales.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('equals erp-web/src/i18n/locales.ts SUPPORTED_LOCALES when the sibling repository is present', (ctx) => {
    const here = dirname(fileURLToPath(import.meta.url));
    const webLocales = join(
      here,
      '..',
      '..',
      '..',
      '..',
      '..',
      'erp-web',
      'src',
      'i18n',
      'locales.ts',
    );
    if (!existsSync(webLocales)) {
      ctx.skip(`../erp-web not checked out beside this repository (${webLocales})`);
      return;
    }
    const source = readFileSync(webLocales, 'utf8');
    const match = /SUPPORTED_LOCALES = \[([^\]]*)\]/.exec(source);
    expect(match, 'erp-web SUPPORTED_LOCALES not found').not.toBeNull();
    const web = [...(match?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(web.length).toBeGreaterThan(0);
    expect(SUPPORTED_LOCALES.map((entry) => entry.locale)).toEqual(web);
  });
});
