/**
 * Transformer: entities to the response DTOs of the Email screens (plan 04.3-07). Every answer is
 * built field by field and parsed through its zod schema, which strips any key the schema does not
 * name, so nothing the wire does not declare rides along: never a subject, body or merge value of a
 * sent email, never a source ref, never an SMTP credential (D-05, D-02). Ids become strings, times
 * ISO strings. The controller never imports this class (BE-08).
 *
 * `shownOf` is the ADR-0040 fingerprint input of a template: exactly what the editor shows and
 * saves (Active and every version), so a stamp or another column changing refuses no save. The
 * service compares it under the row lock; the detail's `etag` is computed from the same function.
 */
import { Injectable } from '@nestjs/common';
import { etagOf } from '../../../shared/http/etag.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import {
  sentEmailResponseSchema,
  sentEmailRowSchema,
  sentEmailsListResponseSchema,
  statusResponseSchema,
  templateListItemSchema,
  templateResponseSchema,
  templatesListResponseSchema,
  testStateResponseSchema,
  type SendTestDto,
  type SentEmailResponseDto,
  type SentEmailRowDto,
  type SentEmailsListResponseDto,
  type StatusResponseDto,
  type TemplateListItemDto,
  type TemplateResponseDto,
  type TemplatesListResponseDto,
  type TestStateResponseDto,
} from '../dto/mail.dto.js';
import type {
  MailSmtpSettings,
  MailTemplate,
  MailTemplateListItem,
  MailTemplatePage,
  SentEmail,
  SentEmailPage,
} from '../model/mail.model.js';
import type { MailTemplateDefinition } from './mail-template.registry.js';
import { MAIL_LOCALES } from './mail.validator.js';

export interface MailStatusInput {
  readonly configured: boolean;
  /** null when SMTP is not configured. */
  readonly smtp: MailSmtpSettings | null;
  /** `mail:server:unreachableSince`, or null while the server answers. */
  readonly since: Date | null;
  /** The newest sent or failed row. */
  readonly last: SentEmail | null;
  /** The caller's own address, or null. */
  readonly recipient: string | null;
}

/** The ADR-0040 shown columns of a template: Active and the versions keyed by locale. */
export function shownOf(template: MailTemplate): {
  readonly active: boolean;
  readonly versions: Readonly<Record<string, { subject: string; message: string }>>;
} {
  return {
    active: template.active,
    versions: Object.fromEntries(
      template.versions.map((version) => [
        version.locale,
        { subject: version.subject, message: version.message },
      ]),
    ),
  };
}

const isoOrNull = (date: Date | null): string | null => (date === null ? null : date.toISOString());

/** Queued or retrying while the worker has recorded the mail server as unreachable. */
const waiting = (row: SentEmail, since: Date | null): boolean =>
  since !== null && (row.status === 'queued' || row.status === 'retrying');

@Injectable()
export class MailTransformer {
  templateListItem(
    item: MailTemplateListItem,
    definition: MailTemplateDefinition | undefined,
  ): TemplateListItemDto {
    return templateListItemSchema.parse({
      id: String(item.id),
      key: item.key,
      module: item.module,
      audience: definition?.audience ?? null,
      active: item.active,
      locales: [...item.locales],
    });
  }

  /** The list envelope: the four page fields copied one by one, every module, the locales. */
  templateList(
    page: MailTemplatePage,
    definitionOf: (key: string) => MailTemplateDefinition | undefined,
    modules: readonly string[],
  ): TemplatesListResponseDto {
    return templatesListResponseSchema.parse({
      data: page.items.map((item) => this.templateListItem(item, definitionOf(item.key))),
      meta: {
        ...this.pageMeta(page),
        modules: [...modules],
        locales: [...MAIL_LOCALES],
      },
    });
  }

  /** The editor: merge fields without their sample keys (none without a definition), the etag. */
  template(
    template: MailTemplate,
    definition: MailTemplateDefinition | undefined,
    sendTest: SendTestDto,
  ): TemplateResponseDto {
    const shown = shownOf(template);
    return templateResponseSchema.parse({
      id: String(template.id),
      key: template.key,
      module: template.module,
      audience: definition?.audience ?? null,
      active: template.active,
      formattingDropped: template.formattingDropped,
      locales: [...MAIL_LOCALES],
      mergeFields: (definition?.mergeFields ?? []).map(({ token, kind }) => ({ token, kind })),
      versions: shown.versions,
      sendTest,
      etag: etagOf(shown),
    });
  }

  /** One log row; `templateActive` null for a test or a key with no stored template. */
  sentRow(row: SentEmail, since: Date | null, templateActive: boolean | null): SentEmailRowDto {
    return sentEmailRowSchema.parse({
      id: String(row.id),
      templateKey: row.templateKey,
      isTest: row.isTest,
      recipient: row.recipientEmail,
      locale: row.locale,
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      nextTryAt: isoOrNull(row.nextTryAt),
      queuedAt: row.queuedAt.toISOString(),
      sentAt: isoOrNull(row.sentAt),
      failureReason: row.failureReason,
      templateActive,
      waitingForServer: waiting(row, since),
    });
  }

  /** The log envelope, with every stored template key for the Template filter. */
  sentList(
    page: SentEmailPage,
    since: Date | null,
    templateActiveOf: (row: SentEmail) => boolean | null,
    templates: readonly string[],
  ): SentEmailsListResponseDto {
    return sentEmailsListResponseSchema.parse({
      data: page.items.map((row) => this.sentRow(row, since, templateActiveOf(row))),
      meta: { ...this.pageMeta(page), templates: [...templates] },
    });
  }

  /** The detail: the row plus the server reply and the resend link. */
  sentEmail(
    row: SentEmail,
    resentFromExists: boolean,
    since: Date | null,
    templateActive: boolean | null,
  ): SentEmailResponseDto {
    return sentEmailResponseSchema.parse({
      ...this.sentRow(row, since, templateActive),
      serverReply: row.serverReply,
      resentFromId: row.resentFromId === null ? null : String(row.resentFromId),
      resentFromExists,
    });
  }

  /** What the TestSend line polls: its own test's progress. */
  testState(row: SentEmail, since: Date | null): TestStateResponseDto {
    return testStateResponseSchema.parse({
      id: String(row.id),
      status: row.status,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      nextTryAt: isoOrNull(row.nextTryAt),
      sentAt: isoOrNull(row.sentAt),
      failureReason: row.failureReason,
      recipient: row.recipientEmail,
      waitingForServer: waiting(row, since),
    });
  }

  /** The status page (D-02): a sent last send is dated by `sentAt`, a failed one by `updatedAt`. */
  status(input: MailStatusInput): StatusResponseDto {
    const { smtp, last, since } = input;
    return statusResponseSchema.parse({
      configured: input.configured,
      sender: smtp === null ? null : { name: smtp.fromName, address: smtp.fromAddress },
      host: smtp?.host ?? null,
      port: smtp?.port ?? null,
      encryption: smtp?.encryption ?? null,
      server: { answering: since === null, since: isoOrNull(since) },
      lastSend: last === null ? null : this.lastSend(last),
      sendTest: { configured: input.configured, recipient: input.recipient },
    });
  }

  private lastSend(row: SentEmail): StatusResponseDto['lastSend'] {
    const at = row.status === 'sent' ? (row.sentAt ?? row.updatedAt) : row.updatedAt;
    return {
      id: String(row.id),
      status: row.status === 'sent' ? 'sent' : 'failed',
      at: at.toISOString(),
      failureReason: row.failureReason,
    };
  }

  private pageMeta(page: ListPageMeta): ListPageMeta {
    return {
      nextCursor: page.nextCursor,
      prevCursor: page.prevCursor,
      total: page.total,
      rangeStart: page.rangeStart,
    };
  }
}
