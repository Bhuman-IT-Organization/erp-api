import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE } from '../../../shared/config/legacy-locale.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import type { CurrenciesFacade, Currency } from '../../currencies/index.js';
import type { SettingsFacade } from '../../settings/index.js';
import { brandingResponseSchema } from '../dto/branding.dto.js';
import {
  DEFAULT_COMPANY_NAME,
  DEFAULT_FORMATS,
  PERFEX_DATE_FORMATS,
  type Formats,
} from '../model/branding.model.js';
import { BrandingService } from '../service/branding.service.js';
import { BrandingTransformer, COMPANY_UPLOADS_PATH } from '../service/branding.transformer.js';
import { BrandingTransport } from '../service/branding.transport.js';
import { FakeBrandingCurrencies, FakeBrandingSettings, type OptionRow } from './fakes.js';

/** The service over the real transport and transformer, its two facades the shared fakes. */
function serviceWith(rows: OptionRow[], currency: Currency | null = null) {
  const settings = new FakeBrandingSettings(rows);
  const currencies = new FakeBrandingCurrencies(currency);
  const service = new BrandingService(
    new BrandingTransport(
      settings as unknown as SettingsFacade,
      currencies as unknown as CurrenciesFacade,
    ),
    new BrandingTransformer(),
  );
  return { service, settings, currencies };
}

describe('BrandingService', () => {
  it('maps the four settings rows and asks for exactly those names', async () => {
    const { service, settings, currencies } = serviceWith([
      { name: 'companyname', value: ' Cube ' },
      { name: 'company_logo', value: 'a.png' },
      { name: 'company_logo_dark', value: 'b.png' },
      { name: 'active_language', value: 'english' },
    ]);
    await expect(service.current()).resolves.toEqual({
      companyName: 'Cube',
      logoFile: 'a.png',
      logoDarkFile: 'b.png',
      defaultLocale: 'en',
      formats: DEFAULT_FORMATS,
    });
    expect(settings.calls).toEqual([
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
    expect(currencies.baseCalls).toBe(1);
  });

  it.each([
    ['english', 'en'],
    ['arabic', 'ar'],
    ['', 'en'],
    ['klingon', 'en'],
  ])('active_language %j → defaultLocale %s', async (value, expected) => {
    const { service } = serviceWith([{ name: 'active_language', value }]);
    await expect(service.current()).resolves.toMatchObject({ defaultLocale: expected });
  });

  it('falls back to the default name and null logos when rows are missing or blank', async () => {
    const { service } = serviceWith([{ name: 'company_logo', value: '   ' }]);
    await expect(service.current()).resolves.toEqual({
      companyName: DEFAULT_COMPANY_NAME,
      logoFile: null,
      logoDarkFile: null,
      defaultLocale: DEFAULT_LOCALE,
      formats: DEFAULT_FORMATS,
    });
  });

  it('memoises for TIMINGS.branding.cacheMs and reloads after', async () => {
    const { service, settings, currencies } = serviceWith([]);
    let clock = 1_000;
    service.now = () => clock;
    await service.current();
    await service.current();
    expect(settings.calls).toHaveLength(1);
    expect(currencies.baseCalls).toBe(1);
    clock += TIMINGS.branding.cacheMs;
    await service.current();
    expect(settings.calls).toHaveLength(2);
    expect(currencies.baseCalls).toBe(2);
  });

  it('reads the base currency once per memo window, and again after dropMemo() (answer 6)', async () => {
    const { service, settings, currencies } = serviceWith([], currencyOf());
    service.now = () => 1_000;
    await service.current();
    await service.current();
    expect(currencies.baseCalls).toBe(1);
    service.dropMemo();
    currencies.base = currencyOf({ symbol: 'Dh' });
    await expect(service.current()).resolves.toMatchObject({
      formats: { currency: { symbol: 'Dh' } },
    });
    expect(currencies.baseCalls).toBe(2);
    expect(settings.calls).toHaveLength(2);
    await service.current();
    expect(currencies.baseCalls).toBe(2);
  });

  it('dropMemo() before any read is a no-op', async () => {
    const { service, currencies } = serviceWith([]);
    service.dropMemo();
    await service.current();
    expect(currencies.baseCalls).toBe(1);
  });

  it('currentResponse() returns the DTO through the transformer (the controller calls this)', async () => {
    const { service } = serviceWith([
      { name: 'companyname', value: 'Cube' },
      { name: 'company_logo', value: 'a.png' },
      { name: 'company_logo_dark', value: 'b.png' },
      { name: 'active_language', value: 'arabic' },
    ]);
    await expect(service.currentResponse()).resolves.toEqual({
      companyName: 'Cube',
      logoUrl: `${COMPANY_UPLOADS_PATH}/a.png`,
      logoDarkUrl: `${COMPANY_UPLOADS_PATH}/b.png`,
      theme: {},
      defaultLocale: 'ar',
      formats: DEFAULT_FORMATS,
    });
  });
});

/** The formats `current()` answers for these option rows and base currency. */
async function formatsOf(rows: OptionRow[], currency: Currency | null = null): Promise<Formats> {
  const { service } = serviceWith(rows, currency);
  return (await service.current()).formats;
}

const option = (name: string, value: string): OptionRow => ({ name, value });

/** A base currency as `CurrenciesFacade.baseCurrency()` answers it (D-44), separators unset. */
function currencyOf(overrides: Partial<Currency> = {}): Currency {
  return {
    id: 7,
    name: 'AED',
    symbol: 'AED',
    decimalSeparator: null,
    thousandSeparator: null,
    placement: 'before',
    isBase: true,
    ...overrides,
  };
}

describe('BrandingService formats (D-33, D-44): read from Perfex settings, fail-closed', () => {
  it('DEFAULT_FORMATS is the Perfex install default', () => {
    expect(DEFAULT_FORMATS).toEqual({
      dateFormat: 'Y-m-d',
      timeFormat: '24',
      thousandSeparator: ',',
      decimalSeparator: '.',
      decimalPlaces: 2,
      removeDecimalsOnZero: false,
      timeZone: null,
      currency: null,
    });
  });

  it('PERFEX_DATE_FORMATS are the seven values of get_available_date_formats()', () => {
    expect(PERFEX_DATE_FORMATS).toEqual([
      'd-m-Y',
      'd/m/Y',
      'm-d-Y',
      'm.d.Y',
      'm/d/Y',
      'Y-m-d',
      'd.m.Y',
    ]);
  });

  it('answers exactly DEFAULT_FORMATS when no format row and no default currency exist', async () => {
    await expect(formatsOf([])).resolves.toEqual(DEFAULT_FORMATS);
  });

  it.each([
    ['d-m-Y|%d-%m-%Y', 'd-m-Y'],
    ['|%m/%d/%Y', 'm/d/Y'],
    ['Y/m/d|x', 'Y-m-d'],
    ['d.m.Y', 'd.m.Y'],
    ['|', 'Y-m-d'],
    ['', 'Y-m-d'],
  ])('dateformat %j → dateFormat %s', async (value, expected) => {
    await expect(formatsOf([option('dateformat', value)])).resolves.toMatchObject({
      dateFormat: expected,
    });
  });

  it('dateformat absent → dateFormat Y-m-d', async () => {
    await expect(formatsOf([])).resolves.toMatchObject({ dateFormat: 'Y-m-d' });
  });

  it.each([
    ['24', '24'],
    ['12', '12'],
    ['anything', '12'],
    ['', '24'],
  ])('time_format %j → timeFormat %s', async (value, expected) => {
    await expect(formatsOf([option('time_format', value)])).resolves.toMatchObject({
      timeFormat: expected,
    });
  });

  it('time_format absent → timeFormat 24', async () => {
    await expect(formatsOf([])).resolves.toMatchObject({ timeFormat: '24' });
  });

  it('thousand_separator . and decimal_separator , are read as they are', async () => {
    await expect(
      formatsOf([option('thousand_separator', '.'), option('decimal_separator', ',')]),
    ).resolves.toMatchObject({ thousandSeparator: '.', decimalSeparator: ',' });
  });

  it('a thousand_separator outside the allowlist (;) falls back to ,', async () => {
    await expect(formatsOf([option('thousand_separator', ';')])).resolves.toMatchObject({
      thousandSeparator: ',',
      decimalSeparator: '.',
    });
  });

  it('a decimal_separator outside the allowlist (x) falls back to .', async () => {
    await expect(formatsOf([option('decimal_separator', 'x')])).resolves.toMatchObject({
      thousandSeparator: ',',
      decimalSeparator: '.',
    });
  });

  it('thousand , and decimal , (the same character) both fall back to , and .', async () => {
    await expect(
      formatsOf([option('thousand_separator', ','), option('decimal_separator', ',')]),
    ).resolves.toMatchObject({ thousandSeparator: ',', decimalSeparator: '.' });
  });

  it('a clashing separator pair falls back as a pair only: every other field is kept and the currency carries no extra key', async () => {
    const formats = await formatsOf(
      [
        option('dateformat', 'd/m/Y|%d/%m/%Y'),
        option('time_format', '12'),
        option('thousand_separator', ','),
        option('decimal_separator', ','),
      ],
      currencyOf(),
    );
    expect(formats).toEqual({
      ...DEFAULT_FORMATS,
      dateFormat: 'd/m/Y',
      timeFormat: '12',
      currency: {
        code: 'AED',
        symbol: 'AED',
        placement: 'before',
        thousandSeparator: ',',
        decimalSeparator: '.',
      },
    });
  });

  it('a space or an apostrophe thousand_separator survives (the row is not trimmed away)', async () => {
    await expect(
      formatsOf([option('thousand_separator', ' '), option('decimal_separator', ',')]),
    ).resolves.toMatchObject({ thousandSeparator: ' ', decimalSeparator: ',' });
    await expect(formatsOf([option('thousand_separator', "'")])).resolves.toMatchObject({
      thousandSeparator: "'",
    });
  });

  it.each([
    ['1', true],
    ['0', false],
    ['', false],
  ])('remove_decimals_on_zero %j → removeDecimalsOnZero %s', async (value, expected) => {
    await expect(formatsOf([option('remove_decimals_on_zero', value)])).resolves.toMatchObject({
      removeDecimalsOnZero: expected,
    });
  });

  it('remove_decimals_on_zero absent → removeDecimalsOnZero false', async () => {
    await expect(formatsOf([])).resolves.toMatchObject({ removeDecimalsOnZero: false });
  });

  it.each([
    ['Asia/Dubai', 'Asia/Dubai'],
    ['UTC', 'UTC'],
    ['Mars/Base', null],
    ['', null],
    ['+04:00', null],
  ])('default_timezone %j → timeZone %s', async (value, expected) => {
    await expect(formatsOf([option('default_timezone', value)])).resolves.toMatchObject({
      timeZone: expected,
    });
  });

  it('default_timezone absent → timeZone null', async () => {
    await expect(formatsOf([])).resolves.toMatchObject({ timeZone: null });
  });

  it('the base currency with null separators takes the option-level separators', async () => {
    const formats = await formatsOf(
      [option('thousand_separator', '.'), option('decimal_separator', ',')],
      currencyOf(),
    );
    expect(formats.currency).toEqual({
      code: 'AED',
      symbol: 'AED',
      placement: 'before',
      thousandSeparator: '.',
      decimalSeparator: ',',
    });
  });

  it("the base currency's own allowlisted separators win over the option-level ones", async () => {
    const formats = await formatsOf(
      [],
      currencyOf({ thousandSeparator: ' ', decimalSeparator: ',' }),
    );
    expect(formats.currency).toMatchObject({ thousandSeparator: ' ', decimalSeparator: ',' });
    expect(formats).toMatchObject({ thousandSeparator: ',', decimalSeparator: '.' });
  });

  it("the base currency's separators outside the allowlist, or equal to each other, fall back to the option-level pair", async () => {
    await expect(
      formatsOf([], currencyOf({ thousandSeparator: ';', decimalSeparator: 'x' })),
    ).resolves.toMatchObject({ currency: { thousandSeparator: ',', decimalSeparator: '.' } });
    await expect(
      formatsOf(
        [option('thousand_separator', '.'), option('decimal_separator', ',')],
        currencyOf({ thousandSeparator: ',', decimalSeparator: ',' }),
      ),
    ).resolves.toMatchObject({ currency: { thousandSeparator: '.', decimalSeparator: ',' } });
  });

  it.each(['Dirham', 'aed', 'AE', 'AEDX', ''])(
    'a base currency whose name %j is not an ISO 4217 code → currency null',
    async (name) => {
      await expect(formatsOf([], currencyOf({ name }))).resolves.toMatchObject({
        currency: null,
      });
    },
  );

  it('a base currency with an empty symbol shows the code', async () => {
    await expect(formatsOf([], currencyOf({ symbol: '' }))).resolves.toMatchObject({
      currency: { symbol: 'AED' },
    });
  });

  it('a symbol is trimmed and stripped of control characters; one left empty shows the code', async () => {
    await expect(formatsOf([], currencyOf({ symbol: ' \u0007€\n ' }))).resolves.toMatchObject({
      currency: { symbol: '€' },
    });
    await expect(formatsOf([], currencyOf({ symbol: '\u0000\t ' }))).resolves.toMatchObject({
      currency: { symbol: 'AED' },
    });
  });

  it.each([
    ['after', 'after'],
    ['before', 'before'],
    [null, 'before'],
    ['AFTER', 'before'],
  ])('currency placement %j → %s', async (placement, expected) => {
    await expect(formatsOf([], currencyOf({ placement }))).resolves.toMatchObject({
      currency: { placement: expected },
    });
  });

  it('no base currency → currency null', async () => {
    await expect(formatsOf([], null)).resolves.toMatchObject({ currency: null });
  });

  it('decimalPlaces is always 2 (Perfex has no option; get_decimal_places() is the filter default)', async () => {
    await expect(formatsOf([option('decimal_places', '3')])).resolves.toMatchObject({
      decimalPlaces: 2,
    });
  });

  it('currentResponse() carries formats that parse against brandingResponseSchema', async () => {
    const { service } = serviceWith(
      [
        option('dateformat', 'm/d/Y|%m/%d/%Y'),
        option('time_format', '12'),
        option('thousand_separator', "'"),
        option('decimal_separator', '.'),
        option('remove_decimals_on_zero', '1'),
        option('default_timezone', 'Asia/Dubai'),
      ],
      currencyOf({ placement: 'after' }),
    );
    const dto = await service.currentResponse();
    expect(brandingResponseSchema.parse(dto).formats).toEqual({
      dateFormat: 'm/d/Y',
      timeFormat: '12',
      thousandSeparator: "'",
      decimalSeparator: '.',
      decimalPlaces: 2,
      removeDecimalsOnZero: true,
      timeZone: 'Asia/Dubai',
      currency: {
        code: 'AED',
        symbol: 'AED',
        placement: 'after',
        thousandSeparator: "'",
        decimalSeparator: '.',
      },
    });
  });
});
