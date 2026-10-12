/**
 * Log redaction (07-security, threat T-1.3-07): the value of any key on this list is replaced
 * before a line is written, at any depth, and a bearer-token string is masked wherever it appears.
 * `LoggerService` applies it to every `meta` object; nothing else should log.
 *
 * `pass`: nodemailer's auth field (ADR-0049); `smtp_?password`: the SMTP_PASSWORD env key and
 * its camel-case form; `x-shipment-hash`: the public shipment page's credential header (ADR-0051
 * decision 3), so a logged request's headers never carry it.
 */

export const REDACT_KEYS =
  /^(password|passwordhash|pass|smtp_?password|authorization|cookie|set-cookie|refresh|refreshtoken|accesstoken|token|secret|pem|x-csrf-token|x-shipment-hash)$/i;

const BEARER = /^Bearer\s+\S+/i;
const REDACTED = '[REDACTED]';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function walk(value: unknown, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return BEARER.test(value) ? `Bearer ${REDACTED}` : value;
  if (Array.isArray(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    return value.map((item) => walk(item, seen));
  }
  if (isPlainObject(value)) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = REDACT_KEYS.test(key) ? REDACTED : walk(item, seen);
    }
    return out;
  }
  if (value instanceof Error) {
    // Errors are logged by name/message/stack; their own properties may carry request data.
    return { name: value.name, message: walk(value.message, seen), stack: value.stack };
  }
  return value;
}

/** Deep copy of `value` with every redacted key's value replaced by `[REDACTED]`. Cycle-safe. */
export function redact(value: unknown): unknown {
  return walk(value, new WeakSet());
}
