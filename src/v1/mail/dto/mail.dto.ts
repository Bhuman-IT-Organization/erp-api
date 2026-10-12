/**
 * Request and response schemas of `api/v1/mail` (plan 04.3-07): the wire the Email screens build to.
 * Types are `z.infer` of the schemas; every field is written inline.
 *
 * Ids are STRINGS on the wire (the web treats them as opaque) and times are ISO strings. A list is
 * BE-19's envelope `{ data, meta }`; a single resource is a bare body; the request id travels in
 * the `x-request-id` header, never in a body.
 *
 * No request body carries an address: every body is strict, so `to`, `recipient` or `email` is a
 * 400 naming the key, and a test goes to the signed-in member's own address (T-4.3-03). No answer
 * carries a subject, a body or a merge value of a sent email (D-05), nor either SMTP credential,
 * not even a "set" flag (D-02, T-4.3-06).
 */
import { z } from 'zod';
import { listPageMetaSchema } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import {
  MAIL_AUDIENCES,
  MAIL_FAILURE_REASONS,
  MAIL_MESSAGE_MAX,
  MAIL_SUBJECT_MAX,
  SENT_EMAIL_STATUSES,
} from '../model/mail.model.js';

/** The longest `?q=` of the template list. */
export const MAIL_TEMPLATES_SEARCH_MAX = 100;
/** A locale tag in a body: `en`, `ar`, at most a BCP-47 tag of 16 characters. */
export const MAIL_LOCALE_TAG_MAX = 16;
/** `tblmail_templates.module` is VARCHAR(64). */
export const MAIL_MODULE_MAX = 64;

/** The longest `?q=` of the sent-email log: a recipient prefix, the `recipient_email` width. */
export const MAIL_SENT_SEARCH_MAX = 191;

const limitField = z.coerce
  .number()
  .int()
  .min(LIST_QUERY_LIMITS.min)
  .max(LIST_QUERY_LIMITS.max)
  .optional();

/**
 * `GET templates`: the documented surface. `MailValidator.parseTemplateList` enforces it (BE-19's
 * grammar, one keyset sort, the cursor bound to it, these three filters and no other).
 */
export const listTemplatesQuerySchema = z.object({
  limit: limitField,
  /** The previous page's opaque `meta.nextCursor` or `meta.prevCursor`, sent with the same `sort`. */
  cursor: z.string().min(1).optional(),
  /** Contains, over the template key or any version's subject. */
  q: z.string().max(MAIL_TEMPLATES_SEARCH_MAX).optional(),
  /** `module` (default) or `key`; a leading `-` is descending. */
  sort: z.string().optional(),
  /** `a,b`: the modules the list is narrowed to. */
  'filter[module][in]': z.string().optional(),
  /** `complete` (a version for every supported locale) or `missing` (at least one absent). */
  'filter[translation][eq]': z.string().optional(),
  /** `1` active, `0` inactive. */
  'filter[active][eq]': z.string().optional(),
});

/** `GET sent-emails`: the documented surface; `MailValidator.parseSentList` enforces it. */
export const listSentEmailsQuerySchema = z.object({
  limit: limitField,
  cursor: z.string().min(1).optional(),
  /** A recipient address prefix. */
  q: z.string().max(MAIL_SENT_SEARCH_MAX).optional(),
  /** `-queuedAt` (default, newest first) or `queuedAt`. */
  sort: z.string().optional(),
  /** Template keys, plus `status-test` for the status page's tests. */
  'filter[template][in]': z.string().optional(),
  /** `queued`, `retrying`, `sent`, `failed`. */
  'filter[status][in]': z.string().optional(),
  /** An ISO date-time with an offset (the browser computes it from the day it shows). */
  'filter[queuedAt][gte]': z.string().optional(),
  'filter[queuedAt][lte]': z.string().optional(),
});

/** `:id`: a non-numeric or non-positive id is a 400, never a 404 probe. */
export const mailParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export const templateListItemSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    module: z.string(),
    /** null: no definition is registered for the key in this process. */
    audience: z.enum(MAIL_AUDIENCES).nullable(),
    active: z.boolean(),
    /** The locales that have a version. */
    locales: z.array(z.string()),
  })
  .readonly();

export const templatesListResponseSchema = z
  .object({
    data: z.array(templateListItemSchema),
    /** Every module with a template; the supported locales, en first. */
    meta: listPageMetaSchema.extend({
      modules: z.array(z.string()),
      locales: z.array(z.string()),
    }),
  })
  .readonly();

export const mergeFieldSchema = z
  .object({ token: z.string(), kind: z.enum(['text', 'url']) })
  .readonly();

export const versionSchema = z.object({ subject: z.string(), message: z.string() }).readonly();

/** The caller's own test address, and whether mail can be sent at all. */
export const sendTestSchema = z.object({
  configured: z.boolean(),
  recipient: z.string().nullable(),
});

export const templateResponseSchema = z
  .object({
    id: z.string(),
    key: z.string(),
    module: z.string(),
    audience: z.enum(MAIL_AUDIENCES).nullable(),
    active: z.boolean(),
    formattingDropped: z.boolean(),
    /** The supported locales, en first: one editor section each (D-08). */
    locales: z.array(z.string()),
    /** [] when no definition is registered (the editor is then read-only). */
    mergeFields: z.array(mergeFieldSchema),
    /** Only the locales that have one. */
    versions: z.record(z.string(), versionSchema),
    sendTest: sendTestSchema,
    /** `etagOf({ active, versions })`, the ADR-0040 shown columns; also the `ETag` header. */
    etag: z.string().min(1),
  })
  .readonly();

/** `PATCH templates/:id` with `If-Match`: Active and every version; `null` removes that locale. */
export const templateSaveBodySchema = z.strictObject({
  active: z.boolean(),
  versions: z.record(
    z.string().min(2).max(MAIL_LOCALE_TAG_MAX),
    z.object({ subject: z.string(), message: z.string() }).nullable(),
  ),
});

/** `PUT templates/:id/active`: the list's immediate switch. */
export const templateActiveBodySchema = z.strictObject({ active: z.boolean() });

/** `POST templates/active`: Enable All or Disable All of one module. */
export const moduleActiveBodySchema = z.strictObject({
  module: z.string().min(1).max(MAIL_MODULE_MAX),
  active: z.boolean(),
});

/** `POST templates/:id/preview` and `POST templates/:id/test`: an unsaved draft of one locale. */
export const mailDraftBodySchema = z.strictObject({
  locale: z.string().min(2).max(MAIL_LOCALE_TAG_MAX),
  subject: z.string().max(MAIL_SUBJECT_MAX),
  message: z.string().max(MAIL_MESSAGE_MAX),
});

export const previewResponseSchema = z.object({ subject: z.string(), html: z.string() }).readonly();

/** 202: the log row's id (a test's state is read at `GET tests/:id`). */
export const acceptedResponseSchema = z.object({ id: z.string() }).readonly();

export const moduleActiveResponseSchema = z
  .object({ changed: z.number().int().nonnegative() })
  .readonly();

const sentEmailRowObject = z.object({
  id: z.string(),
  templateKey: z.string().nullable(),
  isTest: z.boolean(),
  recipient: z.string(),
  locale: z.string(),
  status: z.enum(SENT_EMAIL_STATUSES),
  attempts: z.number().int(),
  maxAttempts: z.number().int(),
  nextTryAt: z.string().nullable(),
  queuedAt: z.string(),
  sentAt: z.string().nullable(),
  failureReason: z.enum(MAIL_FAILURE_REASONS).nullable(),
  /** null for a test or a key with no stored template. */
  templateActive: z.boolean().nullable(),
  /** Queued or retrying while the mail server is recorded as unreachable. */
  waitingForServer: z.boolean(),
});

export const sentEmailRowSchema = sentEmailRowObject.readonly();

export const sentEmailsListResponseSchema = z
  .object({
    data: z.array(sentEmailRowSchema),
    /** Every stored template key, for the Template filter. */
    meta: listPageMetaSchema.extend({ templates: z.array(z.string()) }),
  })
  .readonly();

export const sentEmailResponseSchema = sentEmailRowObject
  .extend({
    /** The mail server's reply, for the administrator's diagnosis. */
    serverReply: z.string().nullable(),
    resentFromId: z.string().nullable(),
    resentFromExists: z.boolean(),
  })
  .readonly();

export const testStateResponseSchema = z
  .object({
    id: z.string(),
    status: z.enum(SENT_EMAIL_STATUSES),
    attempts: z.number().int(),
    maxAttempts: z.number().int(),
    nextTryAt: z.string().nullable(),
    sentAt: z.string().nullable(),
    failureReason: z.enum(MAIL_FAILURE_REASONS).nullable(),
    recipient: z.string(),
    waitingForServer: z.boolean(),
  })
  .readonly();

/** D-02: the deployment's mail setup, read only. Neither SMTP credential, not even a "set" flag. */
export const statusResponseSchema = z
  .object({
    configured: z.boolean(),
    sender: z.object({ name: z.string(), address: z.string() }).nullable(),
    host: z.string().nullable(),
    port: z.number().int().nullable(),
    encryption: z.enum(['ssl', 'tls', 'none']).nullable(),
    server: z.object({ answering: z.boolean(), since: z.string().nullable() }),
    lastSend: z
      .object({
        id: z.string(),
        status: z.enum(['sent', 'failed']),
        at: z.string(),
        failureReason: z.enum(MAIL_FAILURE_REASONS).nullable(),
      })
      .nullable(),
    sendTest: sendTestSchema,
  })
  .readonly();

export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;
export type ListSentEmailsQuery = z.infer<typeof listSentEmailsQuerySchema>;
export type MailParams = z.infer<typeof mailParamsSchema>;
export type TemplateListItemDto = z.infer<typeof templateListItemSchema>;
export type TemplatesListResponseDto = z.infer<typeof templatesListResponseSchema>;
export type MergeFieldDto = z.infer<typeof mergeFieldSchema>;
export type VersionDto = z.infer<typeof versionSchema>;
export type SendTestDto = z.infer<typeof sendTestSchema>;
export type TemplateResponseDto = z.infer<typeof templateResponseSchema>;
export type TemplateSaveBody = z.infer<typeof templateSaveBodySchema>;
export type TemplateActiveBody = z.infer<typeof templateActiveBodySchema>;
export type ModuleActiveBody = z.infer<typeof moduleActiveBodySchema>;
export type MailDraftBody = z.infer<typeof mailDraftBodySchema>;
export type PreviewResponseDto = z.infer<typeof previewResponseSchema>;
export type AcceptedResponseDto = z.infer<typeof acceptedResponseSchema>;
export type ModuleActiveResponseDto = z.infer<typeof moduleActiveResponseSchema>;
export type SentEmailRowDto = z.infer<typeof sentEmailRowSchema>;
export type SentEmailsListResponseDto = z.infer<typeof sentEmailsListResponseSchema>;
export type SentEmailResponseDto = z.infer<typeof sentEmailResponseSchema>;
export type TestStateResponseDto = z.infer<typeof testStateResponseSchema>;
export type StatusResponseDto = z.infer<typeof statusResponseSchema>;
