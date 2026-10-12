/**
 * The one mapping from a legacy language NAME (`tblstaff.default_language`,
 * `tbloptions.active_language` — Perfex stores the language pack's folder name) to a BCP-47
 * locale the web can switch on (FE-08). Seeded from the folder names under the legacy
 * `application/language/` directory (27 packs on the local copy; structure, not values) plus
 * `arabic`, which only the `purchase` module ships. Unknown or empty → `null`; the caller decides
 * the default (`DEFAULT_LOCALE` for the deployment, `null` for a staff member).
 */
export const LEGACY_LANGUAGE_TO_LOCALE: Readonly<Record<string, string>> = Object.freeze({
  arabic: 'ar',
  bulgarian: 'bg',
  catalan: 'ca',
  chinese: 'zh',
  czech: 'cs',
  dutch: 'nl',
  english: 'en',
  finnish: 'fi',
  francais_canada: 'fr-CA',
  french: 'fr',
  german: 'de',
  greek: 'el',
  indonesia: 'id',
  italian: 'it',
  japanese: 'ja',
  norwegian: 'nb',
  persian: 'fa',
  polish: 'pl',
  portuguese: 'pt',
  portuguese_br: 'pt-BR',
  romanian: 'ro',
  russian: 'ru',
  slovak: 'sk',
  spanish: 'es',
  swedish: 'sv',
  turkish: 'tr',
  ukrainian: 'uk',
  vietnamese: 'vi',
});

/** What a deployment answers when `active_language` is empty or unknown. */
export const DEFAULT_LOCALE = 'en';

/**
 * One locale this deployment actually supports: the BCP-47 tag the web switches on, paired with the
 * legacy pack NAME a member's `tblstaff.default_language` must hold for Perfex to agree.
 */
export interface SupportedLocale {
  readonly locale: string;
  readonly legacyLanguage: string;
}

/**
 * **The locales the new stack ships, which is not the same question as `get_available_languages()`.**
 * Perfex builds its language select by listing `application/language/` — 28 pack folders on the
 * client's copy. This api must not read the legacy filesystem (and the container cannot), and
 * offering a locale erp-web has no message pack for would be a promise the build does not keep. So
 * the source of truth is what erp-web ships: `src/i18n/locales.ts` `SUPPORTED_LOCALES` — today `en`
 * and `ar`, Arabic being a client requirement. `LEGACY_LANGUAGE_TO_LOCALE` above is the *reading*
 * direction (a stored value the new stack may not have messages for still has to be understood) and
 * is deliberately the longer list; this is the *offering* direction.
 *
 * Adding a locale is two edits and no more: a message pack per registered feature in erp-web, and an
 * entry here. `legacy-locale.spec.ts` compares this list against erp-web's when the sibling
 * repository is present, so the two cannot drift silently.
 *
 * No `direction` field: Perfex's member form has its own `direction` select (`tblstaff.direction`),
 * independent of the language, and RTL_LOCALES is erp-web's own (FE-08).
 */
export const SUPPORTED_LOCALES: readonly SupportedLocale[] = Object.freeze([
  Object.freeze({ locale: 'en', legacyLanguage: 'english' }),
  Object.freeze({ locale: 'ar', legacyLanguage: 'arabic' }),
]);

/** `'English '` → `'en'`; `''`, `null`, `undefined` and an unknown name → `null`. */
export function toLocale(language: string | null | undefined): string | null {
  if (language === null || language === undefined) return null;
  const name = language.trim().toLowerCase();
  if (name === '') return null;
  return Object.hasOwn(LEGACY_LANGUAGE_TO_LOCALE, name)
    ? (LEGACY_LANGUAGE_TO_LOCALE[name] ?? null)
    : null;
}
