/**
 * The email port (BE-16, ADR-0049 decision 2): what `v1/mail` sees of SMTP. No nodemailer type
 * crosses it; the adapter answers with a classified `SendResult` and throws only
 * `UpstreamUnavailableError` (the `email` breaker is open). A `SendResult` with `transient: true`
 * means "try again later" (the processor throws `RetryLaterError`); `transient: false` is final.
 * Attachments arrive as bytes; the adapter never reads storage or a path (ADR-0052).
 */

/** One attached file (ADR-0052): v1/mail read the bytes from Node storage at send time. */
export interface EmailAttachment {
  readonly filename: string;
  readonly contentType: string;
  readonly content: Buffer;
}

/** One outgoing email, already rendered and cleaned by v1/mail; the adapter adds From and headers. */
export interface EmailMessage {
  /** Exactly one address, `z.email()` at the caller. */
  readonly to: string;
  /** No CR, LF or control character (v1/mail `cleanSubject`). */
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  /** `<mail-<id>@<PUBLIC_BASE_URL host>>`: a resend after a crash is recognisable (ADR-0049 decision 5). */
  readonly messageId: string;
  /** BCP-47, sent as Content-Language. */
  readonly locale: string;
  /** Absent (or empty) means none; at most `MAIL_ATTACHMENTS_MAX`, checked by v1/mail. */
  readonly attachments?: readonly EmailAttachment[];
}

export const SMTP_FAILURE_REASONS = [
  'recipient_refused',
  'auth_failed',
  'server_unreachable',
  'timeout',
  'message_refused',
  'unknown',
] as const;

export type SmtpFailureReason = (typeof SMTP_FAILURE_REASONS)[number];

export type SendResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: SmtpFailureReason;
      readonly transient: boolean;
      /** The server's reply for administrators, cleaned and cut; never logged, never in an error. */
      readonly serverReply: string | null;
    };

export interface EmailProviderPort {
  /** false when SMTP_HOST is absent: nothing is sent and no connection is opened. */
  readonly configured: boolean;
  /** Never rejects with anything but UpstreamUnavailableError (the email breaker is open). */
  send(message: EmailMessage): Promise<SendResult>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
