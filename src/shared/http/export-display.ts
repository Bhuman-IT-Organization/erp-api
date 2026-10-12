/**
 * The display values of a PDF or Print export (Phase 4.1.1, ADR-0043, D-10, D-25): a boolean reads
 * the sent yes/no labels, a null reads its column's blank label, and a date or date-time cell reads
 * in the customer's Perfex date format, 24/12 hour time and zone, with Latin digits, exactly as
 * erp-web `src/lib/i18n/format.ts` renders it on the screen (the specs share its vectors).
 *
 * Why the web sends the labels and the formats: the words are the screen's translations (FE-19) and
 * the formats are the customer's settings the screen already holds, so the api translates nothing
 * and reads no settings; it checks each value as untrusted input (a capped string, a Perfex format,
 * an IANA zone) and refuses anything else with 400 `ERP-VALIDATION-0001` on the parameter's own
 * path. A bad zone is refused, never replaced by a fallback.
 *
 * What this does NOT do: it reads no rows and no clock, and it never escapes a formula (a PDF or a
 * printed page is not a spreadsheet; CSV and Excel carry the wire values, D-11).
 */
import { AppError } from '../errors/app-error.js';
import { EXPORT_HEADER_MAX_LENGTH, type CsvValue } from './csv.js';

/** Perfex `get_available_date_formats()`: made of `d`, `m`, `Y` and one separator. */
export const EXPORT_DATE_FORMATS = [
  'd-m-Y',
  'd/m/Y',
  'm-d-Y',
  'm.d.Y',
  'm/d/Y',
  'Y-m-d',
  'd.m.Y',
] as const;

/** One of `EXPORT_DATE_FORMATS`. */
export type ExportDateFormat = (typeof EXPORT_DATE_FORMATS)[number];

/** Perfex `time_format`: 24-hour or 12-hour time. */
export const EXPORT_TIME_FORMATS = ['24', '12'] as const;

/** One of `EXPORT_TIME_FORMATS`. */
export type ExportTimeFormat = (typeof EXPORT_TIME_FORMATS)[number];

/** How a string cell is shown: a date (`_d()`) or a date and time (`_dt()`); absent = as is. */
export type ExportCellKind = 'date' | 'dateTime';

/** The checked presentation parameters of one PDF or Print export. */
export interface ExportDisplay {
  readonly title: string;
  readonly yes: string;
  readonly no: string;
  readonly blanks: readonly string[];
  readonly dateFormat: ExportDateFormat;
  readonly timeFormat: ExportTimeFormat;
  readonly timeZone: string;
}

/** What an absent parameter reads: the Perfex install defaults and the wire's `1`/`0`. */
export const EXPORT_DISPLAY_DEFAULTS: Readonly<Omit<ExportDisplay, 'blanks'>> = Object.freeze({
  title: '',
  yes: '1',
  no: '0',
  dateFormat: 'Y-m-d',
  timeFormat: '24',
  timeZone: 'UTC',
});

/**
 * The shape of an IANA zone name (`Area/Location`, `UTC`, `Etc/GMT+4`), checked before `Intl` so an
 * offset (`+04:00`) or a path (`../etc`) is refused (the branding module's rule).
 */
const IANA_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/** The tokens of a Perfex date format. */
const DATE_TOKEN = /[dmY]/g;

type LabelKey = 'title' | 'yes' | 'no';

type DatePart = 'year' | 'month' | 'day' | 'hour' | 'minute' | 'second' | 'dayPeriod';

function refuseDisplay(path: string, message: string): never {
  throw new AppError('ERP-VALIDATION-0001', 'Query is invalid', {
    issues: [{ path: [path], message }],
  });
}

function isShortText(value: unknown): value is string {
  return typeof value === 'string' && value.length <= EXPORT_HEADER_MAX_LENGTH;
}

function isOneOf<T extends string>(allowed: readonly T[], value: unknown): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value);
}

function parseLabel(raw: unknown, key: LabelKey): string {
  if (raw === undefined) return EXPORT_DISPLAY_DEFAULTS[key];
  if (isShortText(raw)) return raw;
  return refuseDisplay(
    key,
    `${key} must be one text of at most ${String(EXPORT_HEADER_MAX_LENGTH)} characters`,
  );
}

/** One blank label per exported column; a single string is a one-element array (Fastify's query). */
function parseBlanks(raw: unknown, columnCount: number): readonly string[] {
  if (raw === undefined) return Array.from({ length: columnCount }, () => '');
  const sent: readonly unknown[] = Array.isArray(raw) ? raw : [raw];
  const blanks = sent.filter(isShortText);
  if (blanks.length !== sent.length || blanks.length !== columnCount) {
    return refuseDisplay(
      'blank',
      `blank must be one text of at most ${String(EXPORT_HEADER_MAX_LENGTH)} characters per exported column (${String(columnCount)})`,
    );
  }
  return blanks;
}

function parseChoice<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: T,
  path: string,
): T {
  if (raw === undefined) return fallback;
  if (isOneOf(allowed, raw)) return raw;
  return refuseDisplay(path, `${path} must be one of ${allowed.join(', ')}`);
}

function isKnownZone(zone: string): boolean {
  try {
    // Validation, not formatting: `Intl` throws a RangeError for a zone it does not know.
    new Intl.DateTimeFormat('en', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function parseTimeZone(raw: unknown): string {
  if (raw === undefined) return EXPORT_DISPLAY_DEFAULTS.timeZone;
  if (typeof raw === 'string' && IANA_ZONE_NAME.test(raw) && isKnownZone(raw)) return raw;
  return refuseDisplay('timeZone', 'timeZone must be an IANA zone name such as Asia/Dubai');
}

/**
 * The presentation parameters of a PDF or Print export from the query (D-25): `title`, `yes`, `no`
 * (one string of at most `EXPORT_HEADER_MAX_LENGTH` each), `blank` (one per exported column, `''`
 * allowed), `dateFormat`, `timeFormat` and `timeZone`. Absent reads `EXPORT_DISPLAY_DEFAULTS` and
 * `''` blanks; anything else is a 400 `ERP-VALIDATION-0001` on the parameter's own path.
 */
export function parseExportDisplay(
  raw: Readonly<Record<string, unknown>>,
  columnCount: number,
): ExportDisplay {
  return {
    title: parseLabel(raw.title, 'title'),
    yes: parseLabel(raw.yes, 'yes'),
    no: parseLabel(raw.no, 'no'),
    blanks: parseBlanks(raw.blank, columnCount),
    dateFormat: parseChoice(
      raw.dateFormat,
      EXPORT_DATE_FORMATS,
      EXPORT_DISPLAY_DEFAULTS.dateFormat,
      'dateFormat',
    ),
    timeFormat: parseChoice(
      raw.timeFormat,
      EXPORT_TIME_FORMATS,
      EXPORT_DISPLAY_DEFAULTS.timeFormat,
      'timeFormat',
    ),
    timeZone: parseTimeZone(raw.timeZone),
  };
}

/** The parts of one instant in the display's zone and hour cycle, as erp-web `dateParts`. */
function dateParts(display: ExportDisplay, value: Date | string): (type: DatePart) => string {
  const twentyFour = display.timeFormat === '24';
  const parts = new Intl.DateTimeFormat('en', {
    numberingSystem: 'latn',
    calendar: 'gregory',
    timeZone: display.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: twentyFour ? '2-digit' : 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: twentyFour ? 'h23' : 'h12',
  }).formatToParts(typeof value === 'string' ? new Date(value) : value);
  return (type) => parts.find((part) => part.type === type)?.value ?? '';
}

/** Perfex `_d()`: the date in the sent `dateFormat`, e.g. `d-m-Y` gives `25-09-2026`. */
export function formatExportDate(display: ExportDisplay, value: Date | string): string {
  const part = dateParts(display, value);
  const token: Readonly<Record<string, string>> = {
    d: part('day'),
    m: part('month'),
    Y: part('year'),
  };
  return display.dateFormat.replaceAll(DATE_TOKEN, (t) => token[t] ?? t);
}

/**
 * Perfex `_dt()`: the date, one space, then `H:i:s` (24, `HH:mm:ss`) or `g:i A` (12, `h:mm AM|PM`,
 * no seconds).
 */
export function formatExportDateTime(display: ExportDisplay, value: Date | string): string {
  const part = dateParts(display, value);
  const clock =
    display.timeFormat === '24'
      ? `${part('hour')}:${part('minute')}:${part('second')}`
      : `${part('hour')}:${part('minute')} ${part('dayPeriod')}`;
  return `${formatExportDate(display, value)} ${clock}`;
}

/**
 * One cell as a PDF or a printed page shows it (D-10): null is the column's `blank`, a boolean the
 * sent `yes`/`no`, a number its plain Latin form with no grouping, a string of a `date`/`dateTime`
 * column the formatted date (an unparseable one as is), any other string as is.
 */
export function displayCell(
  value: CsvValue,
  kind: ExportCellKind | undefined,
  blank: string,
  display: ExportDisplay,
): string {
  if (value === null) return blank;
  if (typeof value === 'boolean') return value ? display.yes : display.no;
  if (typeof value === 'number') return String(value);
  if (kind === undefined || Number.isNaN(Date.parse(value))) return value;
  return kind === 'date' ? formatExportDate(display, value) : formatExportDateTime(display, value);
}
