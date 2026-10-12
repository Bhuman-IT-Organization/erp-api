/**
 * Test doubles shared by the service spec, the facade spec and the controller e2e spec. Branding
 * owns no table (Currencies planning answer 5), so its two sources are two facades:
 * - the options come through the settings facade (W2A-07): `FakeBrandingSettings` is settings'
 *   shared `FakeSettingsFacade` (`options`, `calls` and `getOptions` with the facade's semantics:
 *   every name a key, `null` when absent, exact name, the last seeded row of a name wins), seeded
 *   with the rows below;
 * - the base currency comes through the currencies facade (D-44): `FakeBrandingCurrencies` is
 *   currencies' shared `FakeCurrenciesFacade` with `base` set to `SEED_BASE_CURRENCY`, counting
 *   `baseCalls` so a spec can assert the memo.
 * Both seeds are settable (`options`, `base`) so a spec can change them before the first request.
 */
import { FakeCurrenciesFacade } from '../../currencies/__tests__/fakes.js';
import type { Currency } from '../../currencies/index.js';
import { FakeSettingsFacade, type SettingRow } from '../../settings/__tests__/fakes.js';
import { BRANDING_OPTION_NAMES, type Formats } from '../model/branding.model.js';

/** A `tbloptions` row as the settings repository reads it (`name` and `value`). */
export type OptionRow = SettingRow;

/** The four rows a freshly configured customer has (Perfex Settings → Company). */
export const SEED_OPTIONS: readonly OptionRow[] = [
  { name: BRANDING_OPTION_NAMES.companyName, value: 'Cube' },
  { name: BRANDING_OPTION_NAMES.logo, value: 'logo.png' },
  { name: BRANDING_OPTION_NAMES.logoDark, value: 'logo-dark.png' },
  { name: BRANDING_OPTION_NAMES.activeLanguage, value: 'english' },
];

/**
 * Neutral, synthetic format settings (Perfex Settings → Localization) that differ from every
 * install default, so a spec can tell "read" from "fell back". Not any customer's values.
 */
export const SEED_FORMAT_OPTIONS: readonly OptionRow[] = [
  { name: BRANDING_OPTION_NAMES.dateFormat, value: 'd.m.Y|%d.%m.%Y' },
  { name: BRANDING_OPTION_NAMES.timeFormat, value: '12' },
  { name: BRANDING_OPTION_NAMES.thousandSeparator, value: '.' },
  { name: BRANDING_OPTION_NAMES.decimalSeparator, value: ',' },
  { name: BRANDING_OPTION_NAMES.removeDecimalsOnZero, value: '1' },
  { name: BRANDING_OPTION_NAMES.defaultTimezone, value: 'Europe/Berlin' },
];

/** A synthetic base currency, as `CurrenciesFacade.baseCurrency()` answers it, with its own separators unset. */
export const SEED_BASE_CURRENCY: Currency = {
  id: 1,
  name: 'EUR',
  symbol: '€',
  decimalSeparator: null,
  thousandSeparator: null,
  placement: 'after',
  isBase: true,
};

/** The settings facade stand-in, seeded with `SEED_OPTIONS` and `SEED_FORMAT_OPTIONS` by default. */
export class FakeBrandingSettings extends FakeSettingsFacade {
  constructor(options: readonly OptionRow[] = [...SEED_OPTIONS, ...SEED_FORMAT_OPTIONS]) {
    super(options);
  }
}

/** The currencies facade stand-in: `base` answers `baseCurrency()`; `baseCalls` counts the reads. */
export class FakeBrandingCurrencies extends FakeCurrenciesFacade {
  baseCalls = 0;

  constructor(base: Currency | null = SEED_BASE_CURRENCY) {
    super();
    this.base = base;
  }

  override baseCurrency(): Promise<Currency | null> {
    this.baseCalls += 1;
    return super.baseCurrency();
  }
}

/** The formats the service derives from `SEED_FORMAT_OPTIONS` and `SEED_BASE_CURRENCY`. */
export const SEED_FORMATS: Formats = {
  dateFormat: 'd.m.Y',
  timeFormat: '12',
  thousandSeparator: '.',
  decimalSeparator: ',',
  decimalPlaces: 2,
  removeDecimalsOnZero: true,
  timeZone: 'Europe/Berlin',
  currency: {
    code: 'EUR',
    symbol: '€',
    placement: 'after',
    thousandSeparator: '.',
    decimalSeparator: ',',
  },
};
