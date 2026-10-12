/**
 * Service: the use case "who is this deployment branded for". Reads the customer's own settings
 * rows and memoises them for `TIMINGS.branding.cacheMs` — the login page asks on every render
 * and the answer changes only when an admin uploads a new logo. `current()` is the model the
 * facade hands other modules; `currentResponse()` is the DTO the controller returns — the service
 * owns the transformer call, as in `v1/auth` (erp-docs 02-coding-rules/05-backend.md BE-08).
 *
 * The ten options (the settings facade, W2A-07) and the base currency (the currencies facade, D-44)
 * both come through the transport, run together. `dropMemo()` forgets the memo: the
 * currencies-change handler calls it on `currencies.record.baseChanged` and
 * `currencies.record.updated` (D-39, Currencies planning answer 6), so a base change or an edit of
 * the base currency shows at once instead of after the memo window. The customer's formats (D-33,
 * D-44) come from those two reads; every field is parsed by a small pure function that falls back to
 * `DEFAULT_FORMATS` (threat T-3.2-07: an admin can type anything into those rows).
 */
import { Injectable } from '@nestjs/common';
import { DEFAULT_LOCALE, toLocale } from '../../../shared/config/legacy-locale.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import type { Currency } from '../../currencies/index.js';
import type { BrandingResponseDto } from '../dto/branding.dto.js';
import {
  BRANDING_OPTION_NAMES,
  CURRENCY_SYMBOL_MAX_LENGTH,
  DECIMAL_SEPARATORS,
  DEFAULT_COMPANY_NAME,
  DEFAULT_FORMATS,
  PERFEX_DATE_FORMATS,
  THOUSAND_SEPARATORS,
  type Branding,
  type BrandingOptionName,
  type CurrencyFormat,
  type Formats,
  type PerfexDateFormat,
} from '../model/branding.model.js';
import { BrandingTransformer } from './branding.transformer.js';
import { BrandingTransport } from './branding.transport.js';

/** An ISO 4217 code, the shape `tblcurrencies.name` must have to count as a currency. */
const ISO_4217 = /^[A-Z]{3}$/;
/** Every Unicode control character (C0, DEL, C1), stripped from the symbol. */
const CONTROL_CHARS = /\p{Cc}/gu;
/**
 * The shape of an IANA zone name (`Area/Location`, `UTC`, `Etc/GMT+4`), checked before `Intl`
 * so an offset string (`+04:00`) that newer engines accept is still refused.
 */
const IANA_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

interface SeparatorPair {
  readonly thousandSeparator: string;
  readonly decimalSeparator: string;
}

function isOneOf<T extends string>(
  allowed: readonly T[],
  value: string | null | undefined,
): value is T {
  return value !== null && value !== undefined && (allowed as readonly string[]).includes(value);
}

/** `"<php>|<strftime>"` → the PHP part, else the strftime part without `%`, when allowlisted; else `Y-m-d`. */
function parseDateFormat(value: string | null): PerfexDateFormat {
  if (value === null) return DEFAULT_FORMATS.dateFormat;
  const [php = '', strftime = ''] = value.split('|');
  for (const candidate of [php.trim(), strftime.replaceAll('%', '').trim()]) {
    if (isOneOf(PERFEX_DATE_FORMATS, candidate)) return candidate;
  }
  return DEFAULT_FORMATS.dateFormat;
}

/** Perfex compares `time_format` loosely to `24`: absent/empty → `24`, `24` → `24`, anything else → `12`. */
function parseTimeFormat(value: string | null): Formats['timeFormat'] {
  return value === null || value === '24' ? '24' : '12';
}

/**
 * Each separator must be allowlisted, else it takes `fallback`'s; a pair that ends up equal (a
 * number would be unreadable) is `fallback` as a whole. Values are NOT trimmed: `' '` is a valid
 * thousand separator.
 */
function parseSeparators(
  thousand: string | null | undefined,
  decimal: string | null | undefined,
  fallback: SeparatorPair,
): SeparatorPair {
  const thousandSeparator = isOneOf(THOUSAND_SEPARATORS, thousand)
    ? thousand
    : fallback.thousandSeparator;
  const decimalSeparator = isOneOf(DECIMAL_SEPARATORS, decimal)
    ? decimal
    : fallback.decimalSeparator;
  // A fresh pair, never `fallback` itself: the caller may pass all of `DEFAULT_FORMATS`.
  return thousandSeparator === decimalSeparator
    ? { thousandSeparator: fallback.thousandSeparator, decimalSeparator: fallback.decimalSeparator }
    : { thousandSeparator, decimalSeparator };
}

/** A valid IANA zone name, else `null` (the web falls back to its deployment zone). */
function parseTimeZone(value: string | null): string | null {
  if (value === null || !IANA_ZONE_NAME.test(value)) return null;
  try {
    // Validation, not formatting: `Intl` throws a RangeError for a zone it does not know.
    new Intl.DateTimeFormat('en', { timeZone: value });
    return value;
  } catch {
    return null;
  }
}

/**
 * The base currency (`CurrenciesFacade.baseCurrency()`, D-44, its fields as stored) →
 * `CurrencyFormat`; `null` when there is none or its name is not ISO 4217.
 */
function parseCurrency(currency: Currency | null, numbers: SeparatorPair): CurrencyFormat | null {
  if (currency === null) return null;
  const code = currency.name.trim();
  if (!ISO_4217.test(code)) return null;
  const symbol = currency.symbol.replace(CONTROL_CHARS, '').trim();
  return {
    code,
    symbol: symbol.length > 0 && symbol.length <= CURRENCY_SYMBOL_MAX_LENGTH ? symbol : code,
    placement: currency.placement?.trim() === 'after' ? 'after' : 'before',
    ...parseSeparators(currency.thousandSeparator, currency.decimalSeparator, numbers),
  };
}

interface Memo {
  readonly value: Branding;
  readonly expiresAt: number;
}

@Injectable()
export class BrandingService {
  private memo: Memo | null = null;

  /** Injectable clock so the memo is testable without waiting. */
  now: () => number = () => Date.now();

  constructor(
    private readonly transport: BrandingTransport,
    private readonly transformer: BrandingTransformer,
  ) {}

  async current(): Promise<Branding> {
    const now = this.now();
    if (this.memo !== null && this.memo.expiresAt > now) return this.memo.value;
    const value = await this.load();
    this.memo = { value, expiresAt: now + TIMINGS.branding.cacheMs };
    return value;
  }

  /**
   * Forgets the memo, so the next `current()` reads again. Called by the currencies-change handler
   * (D-39, answer 6); harmless before any read.
   */
  dropMemo(): void {
    this.memo = null;
  }

  /** The wire shape of `GET /api/v1/branding`; the controller calls this and nothing else. */
  async currentResponse(): Promise<BrandingResponseDto> {
    return this.transformer.toResponse(await this.current());
  }

  private async load(): Promise<Branding> {
    const [raw, baseCurrency] = await Promise.all([
      this.transport.options(),
      this.transport.baseCurrency(),
    ]);
    const nonEmpty = (name: BrandingOptionName): string | null => {
      const value = raw.get(name)?.trim();
      return value === undefined || value === '' ? null : value;
    };
    const numbers = parseSeparators(
      raw.get(BRANDING_OPTION_NAMES.thousandSeparator),
      raw.get(BRANDING_OPTION_NAMES.decimalSeparator),
      DEFAULT_FORMATS,
    );
    return {
      companyName: nonEmpty(BRANDING_OPTION_NAMES.companyName) ?? DEFAULT_COMPANY_NAME,
      logoFile: nonEmpty(BRANDING_OPTION_NAMES.logo),
      logoDarkFile: nonEmpty(BRANDING_OPTION_NAMES.logoDark),
      defaultLocale: toLocale(nonEmpty(BRANDING_OPTION_NAMES.activeLanguage)) ?? DEFAULT_LOCALE,
      formats: {
        dateFormat: parseDateFormat(nonEmpty(BRANDING_OPTION_NAMES.dateFormat)),
        timeFormat: parseTimeFormat(nonEmpty(BRANDING_OPTION_NAMES.timeFormat)),
        ...numbers,
        decimalPlaces: DEFAULT_FORMATS.decimalPlaces,
        removeDecimalsOnZero: nonEmpty(BRANDING_OPTION_NAMES.removeDecimalsOnZero) === '1',
        timeZone: parseTimeZone(nonEmpty(BRANDING_OPTION_NAMES.defaultTimezone)),
        currency: parseCurrency(baseCurrency, numbers),
      },
    };
  }
}
