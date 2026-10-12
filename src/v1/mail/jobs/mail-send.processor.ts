/**
 * The `mail.send` consumer (BE-14, ADR-0049 decisions 4, 5 and 7, RESEARCH R2): renders one logged
 * email at send time from the template's current wording and the record's current values (D-09),
 * hands it to the email port through `MailTransport`, and moves the log row:
 *
 * - sent: `sent`, and the server is no longer marked unreachable;
 * - a transient refusal before the last attempt: `retrying` with `next_try_at`, then
 *   `RetryLaterError` (the queue retries it with `retryPolicy`'s backoff); `server_unreachable` and
 *   `timeout` also mark the server unreachable for the status page (RESEARCH C3);
 * - a permanent refusal, or the last attempt: `failed`, then `NonRetryableJobError` (the DLQ at
 *   once, its reason the error's name, never an address);
 * - template off, record gone, mail not configured: `failed` without sending, and the job completes;
 *   a definition, a draft or a version missing, or a resolver or the renderer throwing: `failed`
 *   with `unknown`, then `NonRetryableJobError` (T-4.3-09);
 * - the open `email` breaker (`UpstreamUnavailableError`): the row is untouched, the server is
 *   marked unreachable and the job is deferred by the configured breaker's half-open delay with
 *   `DeferJobError`, spending no attempt (the 04.2-04 D-10 seam, T-4.2-37);
 * - attachments (ADR-0052): a real send carries what the resolver answers, a test send never does.
 *   After rendering, `attachmentsOf` checks them (`attachmentsProblem`: `unknown`, fatal), `stat`s
 *   every key (one gone: `record_gone`, the job completes), caps the total at `UPLOAD_MAX_BYTES`
 *   (over: `unknown`, fatal), then reads the bytes from `STORAGE`; any storage error is `unknown`,
 *   fatal. The sent-email row gains no column; the record the resolver reads names its files.
 *
 * The 04.2-04 seams used: `BaseProcessor`, its `retryPolicy` (`RETRY_POLICIES.mailSend`) and
 * `DeferJobError`. A row already `sent` or `failed`, or purged, is left alone (at-least-once:
 * the Message-ID `<mail-<id>@host>` makes a resend after a crash recognisable). It imports nothing
 * from the resilience folder (PATTERNS M5): the port classifies, `instanceof` names the open breaker.
 * Log lines carry the id and a reason at most (T-4.3-05).
 */
import { buffer } from 'node:stream/consumers';
import { Inject, Injectable } from '@nestjs/common';
import type {
  EmailAttachment,
  SendResult,
} from '../../../integrations/ports/email-provider.port.js';
import { AppConfig } from '../../../shared/config/app-config.js';
import { POOL } from '../../../shared/config/pool.js';
import { RETRY_POLICIES, type RetryPolicy } from '../../../shared/config/retry-policies.js';
import { RetryLaterError } from '../../../shared/errors/retry-later.error.js';
import { UpstreamUnavailableError } from '../../../shared/errors/upstream-unavailable.error.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  BaseProcessor,
  DeferJobError,
  NonRetryableJobError,
  ProcessorRegistry,
  type QueueJob,
} from '../../../shared/queue/base.processor.js';
import { backoffDelayMs } from '../../../shared/queue/queue.service.js';
import { STORAGE, type StoragePort } from '../../../shared/storage/storage.port.js';
import type { MailFailureReason, SentEmail } from '../model/mail.model.js';
import { MAIL_STATE_STORE, type MailStateStore } from '../repository/mail-state.store.js';
import { MailRepository } from '../repository/mail.repository.js';
import {
  attachmentsProblem,
  MailTemplateRegistry,
  sampleValuesOf,
  urlTokensOf,
  type MailAttachment,
} from '../service/mail-template.registry.js';
import { messageOf } from '../service/mail.messages.js';
import { renderMail, type RenderedMail } from '../service/mail.renderer.js';
import { MailTransport } from '../service/mail.transport.js';
import { MAIL_SEND_QUEUE, mailSendJobSchema, type MailSendJob } from './mail-send.job.js';

/** English: the version a row's locale falls back to. */
const ENGLISH = 'en';

/** What the renderer needs besides the locale and the brand. */
interface Content {
  readonly subject: string;
  readonly message: string;
  readonly values: Readonly<Record<string, string>>;
  readonly urlTokens: ReadonlySet<string>;
  readonly subjectPrefix: string | null;
  /** ADR-0052: what the resolver answered; always empty on a test send (T-4.7-37). */
  readonly attachments: readonly MailAttachment[];
}

/** The rendered email and the attachments the resolver answered (none on a test send). */
interface Prepared {
  readonly rendered: RenderedMail;
  readonly attachments: readonly MailAttachment[];
}

/** Not sendable: the reason the row fails with, and whether the job fails too (`fatal`, the DLQ). */
interface Unsendable {
  readonly failed: MailFailureReason;
  readonly fatal: boolean;
}

const UNKNOWN: Unsendable = { failed: 'unknown', fatal: true };

/** Replies after which the status page shows the server as unreachable. */
const SERVER_DOWN: readonly MailFailureReason[] = ['server_unreachable', 'timeout'];

@Injectable()
export class MailSendProcessor extends BaseProcessor<MailSendJob> {
  readonly queue = MAIL_SEND_QUEUE;
  readonly concurrency = POOL.smtp.maxConnections;
  override readonly retryPolicy: RetryPolicy = RETRY_POLICIES.mailSend;

  /** Constructor-assigned (not DI) so a spec can fix the clock. */
  now: () => number = () => Date.now();

  constructor(
    queues: ProcessorRegistry,
    private readonly repository: MailRepository,
    private readonly registry: MailTemplateRegistry,
    private readonly transport: MailTransport,
    @Inject(MAIL_STATE_STORE) private readonly state: MailStateStore,
    private readonly logger: LoggerService,
    @Inject(STORAGE) private readonly storage: StoragePort,
    private readonly config: AppConfig,
  ) {
    super(queues);
  }

  async handle(job: QueueJob<MailSendJob>): Promise<void> {
    const parsed = mailSendJobSchema.safeParse(job.data);
    if (!parsed.success) throw new NonRetryableJobError('mail job data invalid');
    const row = await this.repository.findSent(parsed.data.sentEmailId);
    if (row === null || row.status === 'sent' || row.status === 'failed') return;
    const now = new Date(this.now());
    if (!this.transport.configured) {
      await this.repository.markFailed(row.id, row.attempts, 'not_configured', null, now);
      return;
    }
    const prepared = await this.render(row, parsed.data.draft);
    if ('failed' in prepared) return this.unsendable(row, prepared, now);
    const files = await this.attachmentsOf(prepared.attachments);
    if ('failed' in files) return this.unsendable(row, files, now);
    const result = await this.deliver(row, prepared.rendered, files, now);
    await this.record(row, result, job.attemptsMade + 1, now, files.length);
  }

  /** Fails the row without sending; a fatal reason fails the job too (the DLQ). */
  private async unsendable(row: SentEmail, why: Unsendable, now: Date): Promise<void> {
    await this.repository.markFailed(row.id, row.attempts, why.failed, null, now);
    this.logger.warn('mail failed', { id: row.id, reason: why.failed });
    if (why.fatal) throw new NonRetryableJobError(`mail ${why.failed}`);
  }

  /** The email to send, or why it cannot be; a resolver or renderer error is `unknown`. */
  private async render(
    row: SentEmail,
    draft: MailSendJob['draft'],
  ): Promise<Prepared | Unsendable> {
    try {
      const content = row.isTest ? this.testContent(row, draft) : await this.realContent(row);
      if ('failed' in content) return content;
      const { attachments, ...rest } = content;
      const brand = await this.transport.brand();
      return { rendered: renderMail({ ...rest, locale: row.locale, brand }), attachments };
    } catch {
      return UNKNOWN;
    }
  }

  /**
   * ADR-0052: the attachments' bytes from `STORAGE`, or why the mail cannot carry them. The list is
   * checked before any storage call and every size before any read, so a bad key never reaches
   * storage and an oversized set never loads.
   */
  private async attachmentsOf(
    list: readonly MailAttachment[],
  ): Promise<readonly EmailAttachment[] | Unsendable> {
    if (list.length === 0) return [];
    if (attachmentsProblem(list) !== null) return UNKNOWN;
    try {
      const stats = await Promise.all(list.map((file) => this.storage.stat(file.storageKey)));
      if (stats.includes(null)) return { failed: 'record_gone', fatal: false };
      const total = stats.reduce((sum, stat) => sum + (stat?.size ?? 0), 0);
      if (total > this.config.env.UPLOAD_MAX_BYTES) return UNKNOWN;
      return await Promise.all(
        list.map(async (file) => ({
          filename: file.fileName,
          contentType: file.contentType,
          content: await buffer(await this.storage.read(file.storageKey)),
        })),
      );
    } catch {
      return UNKNOWN;
    }
  }

  /** A status test (no template) or a template test (the job's sample-only draft). */
  private testContent(row: SentEmail, draft: MailSendJob['draft']): Content | Unsendable {
    const subjectPrefix = messageOf(row.locale, 'test_prefix');
    if (row.templateKey === null) {
      return {
        subject: messageOf(row.locale, 'status_test_subject'),
        message: messageOf(row.locale, 'status_test_message'),
        values: {},
        urlTokens: new Set(),
        subjectPrefix,
        attachments: [],
      };
    }
    const definition = this.registry.get(row.templateKey);
    if (draft === undefined || definition === undefined) return UNKNOWN;
    return {
      ...draft,
      values: sampleValuesOf(definition, row.locale),
      urlTokens: urlTokensOf(definition),
      subjectPrefix,
      attachments: [],
    };
  }

  /** The template's current wording in the row's locale (else English) and the record's values. */
  private async realContent(row: SentEmail): Promise<Content | Unsendable> {
    const key = row.templateKey ?? '';
    const template = await this.repository.findTemplateByKey(key);
    if (template?.active !== true) return { failed: 'template_off', fatal: false };
    const definition = this.registry.get(key);
    if (definition === undefined) return UNKNOWN;
    const resolved = await definition.resolve(row.sourceRef ?? '');
    if (resolved === null) return { failed: 'record_gone', fatal: false };
    const version =
      template.versions.find((candidate) => candidate.locale === row.locale) ??
      template.versions.find((candidate) => candidate.locale === ENGLISH);
    if (version === undefined) return UNKNOWN;
    return {
      subject: version.subject,
      message: version.message,
      values: resolved.values,
      urlTokens: urlTokensOf(definition),
      subjectPrefix: null,
      attachments: resolved.attachments ?? [],
    };
  }

  /** Sends through the port; the open breaker defers the job without spending an attempt. */
  private async deliver(
    row: SentEmail,
    rendered: RenderedMail,
    attachments: readonly EmailAttachment[],
    now: Date,
  ): Promise<SendResult> {
    try {
      return await this.transport.send({
        to: row.recipientEmail,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        messageId: this.transport.messageIdOf(row.id),
        locale: row.locale,
        ...(attachments.length > 0 ? { attachments } : {}),
      });
    } catch (error) {
      if (!(error instanceof UpstreamUnavailableError)) throw error;
      await this.state.markServerUnreachable(now);
      this.logger.warn('mail deferred', { id: row.id });
      throw new DeferJobError(this.transport.deferMs);
    }
  }

  /** Moves the row by the port's answer; throws so the queue retries or dead-letters the job. */
  private async record(
    row: SentEmail,
    result: SendResult,
    attempt: number,
    now: Date,
    attachments: number,
  ) {
    if (result.ok) {
      await this.repository.markSent(row.id, attempt, now);
      await this.state.clearServerUnreachable();
      this.logger.log('mail sent', { id: row.id, ...(attachments > 0 ? { attachments } : {}) });
      return;
    }
    const { reason, transient, serverReply } = result;
    if (transient && attempt < row.maxAttempts) {
      const nextTryAt = new Date(now.getTime() + backoffDelayMs(attempt, this.retryPolicy));
      await this.repository.markRetrying(row.id, attempt, nextTryAt, reason, serverReply, now);
      if (SERVER_DOWN.includes(reason)) await this.state.markServerUnreachable(now);
      this.logger.warn('mail retrying', { id: row.id, reason });
      throw new RetryLaterError('smtp', reason);
    }
    await this.repository.markFailed(row.id, attempt, reason, serverReply, now);
    this.logger.warn('mail failed', { id: row.id, reason });
    throw new NonRetryableJobError(`mail ${reason}`);
  }
}
