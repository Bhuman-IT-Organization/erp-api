/**
 * The api's own user-visible mail strings (FE-19 applied to the api, PATTERNS M2, ADR-0049 decision 6):
 * the "[Test]" subject prefix, the status page's test email and the synthetic sample values the
 * preview and the test send fill merge fields with. TypeScript constants, not JSON, because JSON
 * under `src` is not emitted to `dist`.
 *
 * `ar` holds the English text as the unreviewed placeholder (4.1 D-12); a sending slice adds its fallback wording and sample keys here, in both locales.
 * No value holds U+2014 (D-06).
 */
export const MAIL_MESSAGES = {
  en: {
    test_prefix: '[Test]',
    status_test_subject: 'Email test from the new system',
    status_test_message:
      'This is a test email sent from the Email status page.\n\nIf you can read it, the new system can send email.',
    sample_staff_name: 'Sample Staff',
    sample_staff_id: '1',
    sample_approver: 'Sample Approver',
    sample_type_check: 'Check-in',
    sample_date_time: '2026-01-31 09:00',
    sample_link: 'https://example.test/sample-record',
  },
  ar: {
    test_prefix: '[Test]',
    status_test_subject: 'Email test from the new system',
    status_test_message:
      'This is a test email sent from the Email status page.\n\nIf you can read it, the new system can send email.',
    sample_staff_name: 'Sample Staff',
    sample_staff_id: '1',
    sample_approver: 'Sample Approver',
    sample_type_check: 'Check-in',
    sample_date_time: '2026-01-31 09:00',
    sample_link: 'https://example.test/sample-record',
  },
} as const satisfies Readonly<Record<string, Readonly<Record<string, string>>>>;

export type MailMessageKey = keyof (typeof MAIL_MESSAGES)['en'];

const BY_LOCALE: Readonly<Record<string, Readonly<Record<MailMessageKey, string>>>> = MAIL_MESSAGES;

/** The value of `key` in `locale`, English when the locale has no messages. */
export function messageOf(locale: string, key: MailMessageKey): string {
  return (
    (Object.hasOwn(BY_LOCALE, locale) ? BY_LOCALE[locale]?.[key] : undefined) ??
    MAIL_MESSAGES.en[key]
  );
}

/** Whether `value` is a key of the English messages (own keys only). */
export function isMailMessageKey(value: string): value is MailMessageKey {
  return Object.hasOwn(MAIL_MESSAGES.en, value);
}
