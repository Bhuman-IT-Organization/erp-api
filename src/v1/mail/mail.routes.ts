/**
 * Route constants of `api/v1/mail`, relative to the global prefix `api/v1`: the single source of the
 * paths the controller, the tests and erp-web's endpoint table use. The screens live under
 * `/setup/email-templates`, `/setup/sent-emails` and `/setup/email-status`.
 *
 * `templates/active` is a static segment: find-my-way serves it before `templates/:id` whatever the
 * declaration order; the controller still declares it first.
 *
 * The template handlers are gated on Perfex's `email_templates` pair, mapped in `@erp/contracts`
 * (`settings.emailTemplates.view` and `.edit`, D-09); the sent-email log, Resend and the status are
 * administrator-only (no code; the service asserts the flag).
 */
import { PERMISSIONS } from '@erp/contracts';

export const MAIL_ROUTES = {
  base: 'mail',
  templates: 'templates',
  templatesActive: 'templates/active',
  template: 'templates/:id',
  templateActive: 'templates/:id/active',
  templatePreview: 'templates/:id/preview',
  templateTest: 'templates/:id/test',
  test: 'tests/:id',
  sentEmails: 'sent-emails',
  sentEmail: 'sent-emails/:id',
  resend: 'sent-emails/:id/resend',
  status: 'status',
  statusTest: 'status/test',
} as const;

export const MAIL_PERMISSIONS = { templates: PERMISSIONS.settings.emailTemplates } as const;
