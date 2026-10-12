/**
 * The SMTP failure table (ADR-0049 decision 4, RESEARCH R2): which nodemailer errors are an outage
 * the `email` breaker must count, and which are a refusal returned as a value. Pure: it reads
 * nodemailer's error fields `code`, `responseCode` and `response` from a plain object and imports
 * nothing from nodemailer. First match wins:
 *
 * - code EAUTH, ENOAUTH, EREQUIRETLS: auth_failed, final
 * - code ECONNECTION, ESOCKET, EDNS and the Node network codes: server_unreachable, transient, counts
 * - code ETIMEDOUT: timeout, transient, counts
 * - reply 421 (the server is closing the channel): server_unreachable, transient, counts
 * - reply 4xx: recipient_refused for EENVELOPE, else message_refused; transient
 * - reply 5xx: recipient_refused for EENVELOPE, else message_refused; final
 * - anything else: unknown, final
 *
 * A refused recipient or message never counts (Pitfall 5): one bad address must not pause all mail.
 * `serverReply` is the cleaned reply whenever the error carries a `responseCode`, else null.
 */
import { TIMINGS } from '../../../shared/config/timings.js';
import type { SendResult, SmtpFailureReason } from '../../ports/email-provider.port.js';

export type FailedSend = Extract<SendResult, { ok: false }>;

export interface SmtpClassification {
  /** true: thrown INSIDE breaker.execute so the email breaker counts it. */
  readonly countsOnBreaker: boolean;
  readonly result: FailedSend;
}

const SMTP_TEMP_FAILURE = 400;
const SMTP_PERM_FAILURE = 500;
const SMTP_SERVICE_CLOSING = 421;
const SMTP_REPLY_CLASS_END = 600;

const AUTH_CODES: ReadonlySet<string> = new Set(['EAUTH', 'ENOAUTH', 'EREQUIRETLS']);
const UNREACHABLE_CODES: ReadonlySet<string> = new Set([
  'ECONNECTION',
  'ESOCKET',
  'EDNS',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
]);
const ENVELOPE_CODE = 'EENVELOPE';
const TIMEOUT_CODE = 'ETIMEDOUT';

const LINE_FEED = 0x0a;
const FIRST_PRINTABLE = 0x20;

/** Keeps every character but the C0 controls; a line feed stays. */
function isKept(char: string): boolean {
  const point = char.codePointAt(0) ?? 0;
  return point >= FIRST_PRINTABLE || point === LINE_FEED;
}

/** String(value) without C0 controls except `\n`, trimmed, cut to the column size; '' or non-string: null. */
export function cleanServerReply(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let kept = '';
  for (const char of value) if (isKept(char)) kept += char;
  const cleaned = kept.trim().slice(0, TIMINGS.mail.serverReplyMaxChars);
  return cleaned === '' ? null : cleaned;
}

function fieldOf(error: unknown, key: string): unknown {
  return typeof error === 'object' && error !== null
    ? (error as Record<string, unknown>)[key]
    : undefined;
}

function classified(
  reason: SmtpFailureReason,
  transient: boolean,
  countsOnBreaker: boolean,
  serverReply: string | null,
): SmtpClassification {
  return { countsOnBreaker, result: { ok: false, reason, transient, serverReply } };
}

/** The reply rows: 421, then 4xx and 5xx split by EENVELOPE. */
function byReply(code: string | undefined, responseCode: number, reply: string | null) {
  if (responseCode === SMTP_SERVICE_CLOSING) {
    return classified('server_unreachable', true, true, reply);
  }
  const refused = code === ENVELOPE_CODE ? 'recipient_refused' : 'message_refused';
  if (responseCode >= SMTP_TEMP_FAILURE && responseCode < SMTP_PERM_FAILURE) {
    return classified(refused, true, false, reply);
  }
  if (responseCode >= SMTP_PERM_FAILURE && responseCode < SMTP_REPLY_CLASS_END) {
    return classified(refused, false, false, reply);
  }
  return classified('unknown', false, false, reply);
}

export function classifySmtpError(error: unknown): SmtpClassification {
  const rawCode = fieldOf(error, 'code');
  const code = typeof rawCode === 'string' ? rawCode : undefined;
  const rawResponseCode = fieldOf(error, 'responseCode');
  const responseCode = typeof rawResponseCode === 'number' ? rawResponseCode : undefined;
  const reply = responseCode === undefined ? null : cleanServerReply(fieldOf(error, 'response'));
  if (code !== undefined && AUTH_CODES.has(code)) {
    return classified('auth_failed', false, false, reply);
  }
  if (code !== undefined && UNREACHABLE_CODES.has(code)) {
    return classified('server_unreachable', true, true, reply);
  }
  if (code === TIMEOUT_CODE) return classified('timeout', true, true, reply);
  if (responseCode !== undefined) return byReply(code, responseCode, reply);
  return classified('unknown', false, false, null);
}
