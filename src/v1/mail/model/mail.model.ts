/**
 * The mail module's types (ADR-0049): a template and its per-locale wording, the sent-email log row
 * (never a subject, a body or a merge value, D-05), and the read of Perfex's own templates used once
 * per key to seed one (D-03).
 */
import type { ListPageMeta } from '../../../shared/http/keyset.js';

export const MAIL_AUDIENCES = ['staff', 'contact', 'staff_or_contact'] as const;
export type MailAudience = (typeof MAIL_AUDIENCES)[number];

export const SENT_EMAIL_STATUSES = ['queued', 'retrying', 'sent', 'failed'] as const;
export type SentEmailStatus = (typeof SENT_EMAIL_STATUSES)[number];

export const MAIL_FAILURE_REASONS = [
  'recipient_refused',
  'auth_failed',
  'server_unreachable',
  'timeout',
  'message_refused',
  'not_configured',
  'record_gone',
  'template_off',
  'unknown',
] as const;
export type MailFailureReason = (typeof MAIL_FAILURE_REASONS)[number];

/** The longest subject and message a version or a draft may carry (`VARCHAR(255)`, the editor's cap on `MEDIUMTEXT`). */
export const MAIL_SUBJECT_MAX = 255;
export const MAIL_MESSAGE_MAX = 20_000;

/** The Template filter's value for a status-page test (template_key NULL); a template key can never contain '-'. */
export const STATUS_TEST_FILTER = 'status-test';

export interface MailTemplateVersion {
  readonly locale: string;
  readonly subject: string;
  readonly message: string;
}

export interface MailTemplate {
  readonly id: number;
  readonly key: string;
  readonly module: string;
  readonly active: boolean;
  readonly formattingDropped: boolean;
  readonly updatedByStaffId: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Ordered by locale. */
  readonly versions: readonly MailTemplateVersion[];
}

export interface MailTemplateListItem {
  readonly id: number;
  readonly key: string;
  readonly module: string;
  readonly active: boolean;
  readonly locales: readonly string[];
}

export interface SentEmail {
  readonly id: number;
  readonly templateKey: string | null;
  readonly isTest: boolean;
  readonly sourceRef: string | null;
  readonly recipientEmail: string;
  readonly locale: string;
  readonly status: SentEmailStatus;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly nextTryAt: Date | null;
  readonly failureReason: MailFailureReason | null;
  readonly serverReply: string | null;
  readonly dedupeKey: string | null;
  readonly resentFromId: number | null;
  readonly requestedByStaffId: number | null;
  readonly requestId: string | null;
  readonly queuedAt: Date;
  readonly sentAt: Date | null;
  readonly updatedAt: Date;
}

export interface NewSentEmail {
  readonly templateKey: string | null;
  readonly isTest: boolean;
  readonly sourceRef: string | null;
  readonly recipientEmail: string;
  readonly locale: string;
  readonly status: 'queued' | 'failed';
  readonly failureReason: MailFailureReason | null;
  readonly maxAttempts: number;
  readonly dedupeKey: string | null;
  readonly resentFromId: number | null;
  readonly requestedByStaffId: number | null;
  readonly requestId: string | null;
}

/** The SMTP settings the status page may show (D-02): never a credential. */
export interface MailSmtpSettings {
  readonly host: string;
  readonly port: number;
  readonly encryption: 'ssl' | 'tls' | 'none';
  readonly fromName: string;
  readonly fromAddress: string;
}

/** What a sending module asks `MailFacade.send` for: a registered key and the record it is about. */
export interface SendRequest {
  readonly template: string;
  /** The id the template's resolver reads the recipient and the values from. */
  readonly sourceRef: string;
  /** Set it when the trigger can fire twice (a repeatable job): `<module>.<event>:<id>:<date>`. */
  readonly dedupeKey?: string;
}

/** Why a send wrote no log row. */
export type SkipReason = 'not_registered' | 'template_off' | 'record_gone' | 'no_recipient';

/** What `MailFacade.send` answers; it never throws. */
export type SendOutcome =
  | { readonly status: 'queued'; readonly id: number }
  | { readonly status: 'duplicate'; readonly id: number }
  | { readonly status: 'not_configured'; readonly id: number }
  | { readonly status: 'skipped'; readonly reason: SkipReason }
  | { readonly status: 'not_enqueued' };

export interface PerfexTemplateRow {
  readonly language: string | null;
  readonly subject: string;
  readonly message: string;
  readonly active: boolean;
}

export interface MailTemplatePage extends ListPageMeta {
  readonly items: readonly MailTemplateListItem[];
}

export interface SentEmailPage extends ListPageMeta {
  readonly items: readonly SentEmail[];
}
