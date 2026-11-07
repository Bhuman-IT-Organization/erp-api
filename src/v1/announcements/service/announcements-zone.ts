/**
 * Perfex's wall clock. `Announcements_model::add` writes PHP's `date('Y-m-d H:i:s')`
 * (`application/models/Announcements_model.php:79`), and PHP's zone is the `default_timezone`
 * setting when it is set, else the server's (UTC on the client's stack). So `dateadded` holds a
 * NAIVE wall clock in the company zone, not a UTC instant.
 *
 * `wallClockAt` turns an instant into that wall clock, packed with `Date.UTC` so Prisma (which
 * writes a `DATETIME` from the UTC fields) stores it verbatim; `instantOf` reads a stored wall
 * clock back as the instant it names in the same zone, which is what the wire answers.
 *
 * Own copy of the three functions of Cost Centers (BE-03: a module never imports another's
 * internals).
 */

/** The zone PHP uses when `default_timezone` is empty or not a zone: the server's, UTC on the client's stack. */
export const FALLBACK_ZONE = 'UTC';

/** The shape of an IANA zone name, checked before `Intl` so an offset string (`+04:00`) is refused. */
const IANA_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/** One second in milliseconds: the wall clock keeps seconds, as `DATETIME(0)` does. */
const SECOND_MS = 1000;

/** `Date.UTC`'s month is 0-based; `formatToParts` answers 1 to 12. */
const MONTH_BASE = 1;

/** Formatters per zone: `Intl.DateTimeFormat` is costly to build and a zone's never changes. */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterOf(zone: string): Intl.DateTimeFormat {
  const known = FORMATTERS.get(zone);
  if (known !== undefined) return known;
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  FORMATTERS.set(zone, formatter);
  return formatter;
}

/** Whether `zone` names an IANA zone this runtime knows. */
function isKnownZone(zone: string): boolean {
  if (!IANA_ZONE_NAME.test(zone)) return false;
  try {
    // Validation, not formatting: `Intl` throws a RangeError for a zone it does not know.
    formatterOf(zone);
    return true;
  } catch {
    return false;
  }
}

/**
 * The zone Perfex's `date()` runs in: the `default_timezone` setting when it is an IANA zone name,
 * else `FALLBACK_ZONE`.
 */
export function companyZone(setting: string | null): string {
  return setting !== null && isKnownZone(setting) ? setting : FALLBACK_ZONE;
}

/**
 * The calendar fields of `instant` in `zone`, packed with `Date.UTC`: the result's UTC fields ARE
 * that wall clock. Seconds kept, milliseconds dropped (the column is `DATETIME(0)`).
 *
 * @complexity O(1): one `formatToParts` over seven fields
 */
export function wallClockAt(instant: Date, zone: string): Date {
  const fields = new Map(
    formatterOf(zone)
      .formatToParts(instant)
      .map((part) => [part.type, Number(part.value)]),
  );
  const field = (type: Intl.DateTimeFormatPartTypes): number => fields.get(type) ?? 0;
  return new Date(
    Date.UTC(
      field('year'),
      field('month') - MONTH_BASE,
      field('day'),
      field('hour'),
      field('minute'),
      field('second'),
    ),
  );
}

/** How far `zone`'s wall clock is ahead of UTC at `instant`, in milliseconds (whole seconds). */
function offsetAt(instant: number, zone: string): number {
  const whole = Math.floor(instant / SECOND_MS) * SECOND_MS;
  return wallClockAt(new Date(whole), zone).getTime() - whole;
}

/**
 * The inverse of `wallClockAt`: the stored wall clock read in `zone`, as an ISO instant. The offset
 * is found at the wall clock read as UTC, then corrected once at the first guess, so a wall clock
 * just after a daylight-saving change lands on the right side of it.
 */
export function instantOf(stored: Date, zone: string): string {
  const wall = stored.getTime();
  const first = wall - offsetAt(wall, zone);
  const corrected = wall - offsetAt(first, zone);
  return new Date(corrected).toISOString();
}
