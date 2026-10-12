/**
 * Domain model: the deployment's brand as the service understands it, independent of how the
 * legacy settings table spells it.
 */
export interface Branding {
  readonly companyName: string;
  /** File name inside the company uploads folder, or `null` when none is set. */
  readonly logoFile: string | null;
  readonly logoDarkFile: string | null;
  /** BCP-47 from `tbloptions.active_language` (`shared/config/legacy-locale.ts`); `en` when empty or unknown. */
  readonly defaultLocale: string;
  /** The customer's Perfex date, time, number and currency settings (D-33, D-44). */
  readonly formats: Formats;
}

/** `tbloptions.name` values the module reads (Perfex Settings → Company and → Localization). */
export const BRANDING_OPTION_NAMES = Object.freeze({
  companyName: 'companyname',
  logo: 'company_logo',
  logoDark: 'company_logo_dark',
  activeLanguage: 'active_language',
  dateFormat: 'dateformat',
  timeFormat: 'time_format',
  thousandSeparator: 'thousand_separator',
  decimalSeparator: 'decimal_separator',
  removeDecimalsOnZero: 'remove_decimals_on_zero',
  defaultTimezone: 'default_timezone',
});

/**
 * One of the ten names, read through the settings facade since W2A-07. Each must be on the settings
 * allow-list (`SETTINGS_ALLOW_LIST`): one that is not fails `tsc` at the transport.
 */
export type BrandingOptionName = (typeof BRANDING_OPTION_NAMES)[keyof typeof BRANDING_OPTION_NAMES];

/** Shown when the customer has not set a company name yet. */
export const DEFAULT_COMPANY_NAME = 'ERP';

/** The seven values of Perfex's `get_available_date_formats()` (the PHP `date()` half). */
export const PERFEX_DATE_FORMATS = [
  'd-m-Y',
  'd/m/Y',
  'm-d-Y',
  'm.d.Y',
  'm/d/Y',
  'Y-m-d',
  'd.m.Y',
] as const;
export type PerfexDateFormat = (typeof PERFEX_DATE_FORMATS)[number];

/** Thousand separators Perfex Settings → Localization offers; anything else falls back to `,`. */
export const THOUSAND_SEPARATORS = [',', '.', ' ', "'"] as const;
/** Decimal separators Perfex offers; anything else falls back to `.`. */
export const DECIMAL_SEPARATORS = ['.', ','] as const;

/** The currency symbol is at most 10 characters (`CurrenciesFacade`, D-44); a cleaned symbol that is empty or longer shows the code instead. */
export const CURRENCY_SYMBOL_MAX_LENGTH = 10;

/** The deployment's base currency: `CurrenciesFacade.baseCurrency()` (D-44), the first base by id. */
export interface CurrencyFormat {
  /** The currency's `name`, an ISO 4217 code (`/^[A-Z]{3}$/`); any other name is no currency. */
  readonly code: string;
  /** The currency's `symbol`, trimmed, control characters stripped, 1..10 chars; else the code. */
  readonly symbol: string;
  /** The currency's `placement`; anything but `after` is `before` (Perfex's own default). */
  readonly placement: 'before' | 'after';
  /** The currency's own `thousandSeparator` when allowlisted; else the option-level value. */
  readonly thousandSeparator: string;
  /** The currency's own `decimalSeparator` when allowlisted; else the option-level value. */
  readonly decimalSeparator: string;
}

/**
 * How the customer's Perfex renders dates, times, numbers and money — the source of truth of the
 * web's one formatter (D-33: users see what they see in Perfex today; the chosen language changes
 * the words, not the format). Every field fails closed to the Perfex install default
 * (`DEFAULT_FORMATS`), so a hand-edited settings row never reaches the web malformed.
 *
 * Money is `symbol` and amount concatenated with **no space**, in `placement` order: Perfex's
 * `app_format_money` concatenates them (D-44 supersedes the UI-SPEC's no-break space).
 *
 * The options come through the settings module since W2A-07 and the base currency through the
 * currencies module since W2A-05 (both through the transport), with the wire unchanged; `theme`
 * still waits for W0-05 follow-up (b).
 */
export interface Formats {
  /**
   * `tbloptions.dateformat`, stored as `"<php>|<strftime>"` (e.g. `d-m-Y|%d-%m-%Y`): the PHP part,
   * else the strftime part with `%` removed, when it is one of `PERFEX_DATE_FORMATS`; else `Y-m-d`.
   */
  readonly dateFormat: PerfexDateFormat;
  /** `tbloptions.time_format`: absent or empty → `24`; `24` → `24`; any other value → `12` (Perfex compares loosely to `24`). */
  readonly timeFormat: '24' | '12';
  /** `tbloptions.thousand_separator` when in `THOUSAND_SEPARATORS`, else `,`. */
  readonly thousandSeparator: string;
  /** `tbloptions.decimal_separator` when in `DECIMAL_SEPARATORS`, else `.`; never equal to `thousandSeparator` (a clashing pair falls back to `,` and `.`). */
  readonly decimalSeparator: string;
  /** Always 2: Perfex has no option — `get_decimal_places()` is the `app_decimal_places` filter's default 2 and no module overrides it. */
  readonly decimalPlaces: 2;
  /** `tbloptions.remove_decimals_on_zero === '1'`: a whole amount drops its `.00`. */
  readonly removeDecimalsOnZero: boolean;
  /** `tbloptions.default_timezone` when it is a valid IANA zone, else `null` (the web falls back to its deployment zone). */
  readonly timeZone: string | null;
  /** The base currency (`CurrenciesFacade.baseCurrency()`, D-44); `null` when there is none or its name is not an ISO code. */
  readonly currency: CurrencyFormat | null;
}

/** The Perfex install defaults; every field of `Formats` falls back to its value here. */
export const DEFAULT_FORMATS: Formats = Object.freeze({
  dateFormat: 'Y-m-d',
  timeFormat: '24',
  thousandSeparator: ',',
  decimalSeparator: '.',
  decimalPlaces: 2,
  removeDecimalsOnZero: false,
  timeZone: null,
  currency: null,
});
