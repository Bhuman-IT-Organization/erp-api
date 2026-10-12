/**
 * BrandingTransport: the one file of branding that reaches other modules. It asks the settings
 * facade once for exactly the ten branding options, in their declared order, and answers the
 * facade's map as is; it asks the currencies facade once for the base currency (D-44) and answers
 * it as is.
 */
import { describe, expect, it } from 'vitest';
import type { CurrenciesFacade } from '../../currencies/index.js';
import type { SettingsFacade } from '../../settings/index.js';
import { BrandingTransport } from '../service/branding.transport.js';
import { FakeBrandingCurrencies, SEED_BASE_CURRENCY } from './fakes.js';

/** A recording stand-in for the facade; the cast is the `asRepository` precedent (`settings/__tests__/fakes.ts`). */
function settingsAnswering(answer: ReadonlyMap<string, string | null>) {
  const calls: (readonly string[])[] = [];
  const settings = {
    getOptions: (names: readonly string[]) => {
      calls.push(names);
      return Promise.resolve(answer);
    },
  };
  return { settings: settings as unknown as SettingsFacade, calls };
}

/** The currencies facade stand-in, cast as the settings one is. */
function currenciesAnswering(base: FakeBrandingCurrencies['base']) {
  const fake = new FakeBrandingCurrencies(base);
  return { currencies: fake as unknown as CurrenciesFacade, fake };
}

const NO_CURRENCIES = currenciesAnswering(null).currencies;
const NO_SETTINGS = settingsAnswering(new Map()).settings;

describe('BrandingTransport.options', () => {
  it('asks the settings facade once for the ten branding names, in order, and answers its map unchanged', async () => {
    const answer = new Map<string, string | null>([['companyname', 'Company One']]);
    const { settings, calls } = settingsAnswering(answer);
    await expect(new BrandingTransport(settings, NO_CURRENCIES).options()).resolves.toBe(answer);
    expect(calls).toEqual([
      [
        'companyname',
        'company_logo',
        'company_logo_dark',
        'active_language',
        'dateformat',
        'time_format',
        'thousand_separator',
        'decimal_separator',
        'remove_decimals_on_zero',
        'default_timezone',
      ],
    ]);
  });
});

describe('BrandingTransport.baseCurrency', () => {
  it('asks the currencies facade once and answers its base currency unchanged (D-44)', async () => {
    const { currencies, fake } = currenciesAnswering(SEED_BASE_CURRENCY);
    const transport = new BrandingTransport(NO_SETTINGS, currencies);
    await expect(transport.baseCurrency()).resolves.toBe(SEED_BASE_CURRENCY);
    expect(fake.baseCalls).toBe(1);
  });

  it('answers null when the currencies facade has no base currency', async () => {
    const { currencies, fake } = currenciesAnswering(null);
    await expect(new BrandingTransport(NO_SETTINGS, currencies).baseCurrency()).resolves.toBeNull();
    expect(fake.baseCalls).toBe(1);
  });
});
