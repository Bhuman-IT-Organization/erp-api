/**
 * Use-case orchestrator of the shared mail sender (ADR-0049). Every use case reads and writes
 * through `MailRepository`; the controller receives its DTO from here and never imports the
 * transformer (BE-08).
 *
 * - `enqueue(request)` is the send (D-01, RESEARCH R2 "the log row is the outbox"): the key must be
 *   registered and its template active (seeded on first use), the resolver must find the record and
 *   a valid address; then the log row is inserted (`queued`, or `failed`/`not_configured` when
 *   SMTP is unset) BEFORE the job `mail-<id>` is added, so a lost add leaves a row the sweep
 *   re-adds. A `dedupeKey` already stored answers `duplicate` with that row's id and adds nothing.
 *   A skip writes no row (Perfex skips a disabled template silently). It may throw: `MailFacade.send`
 *   catches.
 * - `ensureSeeded(key)` copies Perfex's current wording for one registered key, once (D-03, D-09):
 *   each Perfex language mapped to a supported locale (the first row per locale wins), the HTML
 *   turned into plain text with the formatting-dropped flag, Perfex's Active of the English row kept,
 *   the definition's fallback wording when Perfex has no English row. A second call, or a second
 *   process racing this one (`createTemplate` answers null), changes nothing.
 * - `preview(id, draft)` renders an unsaved draft with the synthetic sample values, through the same
 *   renderer the send uses (one renderer, ADR-0049 decision 6).
 *
 * The screens (plan 04.3-07, D-09):
 * - Templates, gated by the handlers on `settings.emailTemplates.view` and `.edit`: the list, the
 *   detail with its fingerprint, the save (`If-Match`: under the repository's row lock the shown
 *   columns are compared with `assertFresh`, so a stale save writes nothing, ADR-0040), the Active
 *   switches, the preview, and the test send to the caller's OWN address (never a body field,
 *   T-4.3-03), counted per member (`TIMINGS.mail.testMaxPerWindow` per window, 429 `ERP-MAIL-0007`
 *   with `retryAfterS`, D-10), and its state for the member who sent it only (T-4.3-13).
 * - The sent-email log, Resend, the status and the status test: administrators only. The handlers
 *   declare no code; each use case asserts the administrator flag as its FIRST statement, before
 *   any input is parsed or a row read (`route-gates.spec.ts` reads it from the source).
 * - A missing row is a uniform 404 `ERP-CORE-0004` (T-4.3-04). Resend inserts a NEW row linked by
 *   `resentFromId` to the untouched original, to the original's recipient; the worker renders it
 *   from the current wording and the record's current values (D-05, D-09 O-6).
 *
 * Log lines carry ids, keys, locales and flags only, never wording, values or addresses (T-4.3-26).
 */
import { Inject, Injectable } from '@nestjs/common';
import { DEFAULT_LOCALE, toLocale } from '../../../shared/config/legacy-locale.js';
import { RETRY_POLICIES } from '../../../shared/config/retry-policies.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { assertFresh } from '../../../shared/http/etag.js';
import { getRequestContext } from '../../../shared/logger/request-context.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { QueueService } from '../../../shared/queue/queue.service.js';
import type {
  AcceptedResponseDto,
  ModuleActiveResponseDto,
  PreviewResponseDto,
  SendTestDto,
  SentEmailResponseDto,
  SentEmailsListResponseDto,
  StatusResponseDto,
  TemplateListItemDto,
  TemplateResponseDto,
  TemplatesListResponseDto,
  TestStateResponseDto,
} from '../dto/mail.dto.js';
import { enqueueMailSend, type MailSendJob } from '../jobs/mail-send.job.js';
import type {
  MailTemplate,
  MailTemplateVersion,
  SentEmail,
  NewSentEmail,
  PerfexTemplateRow,
  SendOutcome,
  SendRequest,
  SkipReason,
} from '../model/mail.model.js';
import { MAIL_STATE_STORE, type MailStateStore } from '../repository/mail-state.store.js';
import { MailRepository } from '../repository/mail.repository.js';
import { htmlToText } from './html-to-text.js';
import {
  MailTemplateRegistry,
  sampleValuesOf,
  urlTokensOf,
  type MailTemplateDefinition,
} from './mail-template.registry.js';
import { messageOf } from './mail.messages.js';
import { renderMail } from './mail.renderer.js';
import { MailTransformer, shownOf } from './mail.transformer.js';
import { MailTransport } from './mail.transport.js';
import { MAIL_LOCALES, MailValidator } from './mail.validator.js';

/** English: the version every recipient falls back to, seeded from the fallback keys when absent. */
const ENGLISH = 'en';

/** The deployment's locales, English first. */
const LOCALES: readonly string[] = MAIL_LOCALES;

/** The detail of every administrator refusal: plain, and the same for every use case. */
const ADMIN_ONLY = 'the sent-email log and the email status are for administrators only';

/** `Retry-After` is whole seconds. */
const MS_PER_SECOND = 1_000;

const notFound = (): AppError => new AppError('ERP-CORE-0004', 'Resource not found');

/** The request id of the HTTP request a screen use case runs in (the log row's `request_id`). */
const requestIdNow = (): string | null => getRequestContext()?.requestId ?? null;

/** A template as a list row. */
function listItemOf(template: MailTemplate): {
  id: number;
  key: string;
  module: string;
  active: boolean;
  locales: string[];
} {
  return {
    id: template.id,
    key: template.key,
    module: template.module,
    active: template.active,
    locales: template.versions.map((version) => version.locale),
  };
}

export interface PreviewDraft {
  readonly locale: string;
  readonly subject: string;
  readonly message: string;
}

/** The log row of a send: `queued`, or `failed` with `not_configured` when SMTP is unset. */
function newSentRow(
  request: SendRequest,
  to: { readonly email: string; readonly locale: string | null },
  configured: boolean,
): NewSentEmail {
  return {
    templateKey: request.template,
    isTest: false,
    sourceRef: request.sourceRef,
    recipientEmail: to.email,
    locale: to.locale !== null && LOCALES.includes(to.locale) ? to.locale : DEFAULT_LOCALE,
    status: configured ? 'queued' : 'failed',
    failureReason: configured ? null : 'not_configured',
    maxAttempts: RETRY_POLICIES.mailSend.attempts,
    dedupeKey: request.dedupeKey ?? null,
    resentFromId: null,
    requestedByStaffId: null,
    requestId: null,
  };
}

/** The first Perfex row of each supported locale, in Perfex's order. */
function rowsByLocale(rows: readonly PerfexTemplateRow[]): Map<string, PerfexTemplateRow> {
  const byLocale = new Map<string, PerfexTemplateRow>();
  for (const row of rows) {
    const locale = toLocale(row.language);
    if (locale !== null && LOCALES.includes(locale) && !byLocale.has(locale)) {
      byLocale.set(locale, row);
    }
  }
  return byLocale;
}

@Injectable()
export class MailService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; the log row's `queued_at` reads it. */
  now: () => number = () => Date.now();

  constructor(
    private readonly repository: MailRepository,
    private readonly registry: MailTemplateRegistry,
    private readonly validator: MailValidator,
    private readonly transport: MailTransport,
    private readonly queues: QueueService,
    private readonly logger: LoggerService,
    private readonly transformer: MailTransformer,
    @Inject(MAIL_STATE_STORE) private readonly state: MailStateStore,
  ) {}

  /** The send behind `MailFacade.send`: writes the log row, then adds its job. May throw. */
  async enqueue(request: SendRequest): Promise<SendOutcome> {
    const key = request.template;
    const definition = this.registry.get(key);
    if (definition === undefined) return this.skipped(key, 'not_registered');
    if (!(await this.isActive(key))) return this.skipped(key, 'template_off');
    const resolved = await definition.resolve(request.sourceRef);
    if (resolved === null) return this.skipped(key, 'record_gone');
    if (!this.validator.isRecipient(resolved.to.email)) return this.skipped(key, 'no_recipient');

    const configured = this.transport.configured;
    const { row, created } = await this.repository.insertSent(
      newSentRow(request, resolved.to, configured),
      new Date(this.now()),
    );
    if (!created) return { status: 'duplicate', id: row.id };
    if (!configured) {
      this.logger.warn('mail not configured', { id: row.id, template: key });
      return { status: 'not_configured', id: row.id };
    }
    await enqueueMailSend(this.queues, { sentEmailId: row.id });
    this.logger.log('mail queued', { id: row.id, template: key });
    return { status: 'queued', id: row.id };
  }

  /** Seeds `key` from Perfex's wording when Node has no template for it yet. */
  async ensureSeeded(key: string): Promise<void> {
    const definition = this.registry.get(key);
    if (definition === undefined) throw new Error(`mail template ${key} is not registered`);
    if ((await this.repository.findTemplateByKey(key)) !== null) return;

    const byLocale = rowsByLocale(
      await this.repository.readPerfexTemplates(definition.legacySlug ?? key),
    );
    let formattingDropped = false;
    const versions: MailTemplateVersion[] = [...byLocale].map(([locale, row]) => {
      const subject = htmlToText(row.subject);
      const message = htmlToText(row.message);
      formattingDropped ||= subject.formattingDropped || message.formattingDropped;
      return { locale, subject: subject.text, message: message.text };
    });
    if (!byLocale.has(ENGLISH)) {
      versions.push({
        locale: ENGLISH,
        subject: messageOf(ENGLISH, definition.fallback.subjectKey),
        message: messageOf(ENGLISH, definition.fallback.messageKey),
      });
    }

    const created = await this.repository.createTemplate({
      key,
      module: definition.module,
      active: byLocale.get(ENGLISH)?.active ?? true,
      formattingDropped,
      versions,
    });
    if (created === null) return;
    this.logger.log('mail template seeded', {
      key,
      locales: versions.map((version) => version.locale),
      formattingDropped,
    });
  }

  /**
   * An unsaved draft rendered with the template's sample values (never data from the database).
   * `ERP-CORE-0004` for a missing template and for one whose module no longer defines it.
   */
  async preview(
    templateId: number,
    draft: PreviewDraft,
  ): Promise<{ readonly subject: string; readonly html: string }> {
    this.validator.draft(draft.locale, draft.subject, draft.message, LOCALES);
    const template = await this.repository.findTemplateById(templateId);
    const definition = template === null ? undefined : this.registry.get(template.key);
    if (definition === undefined) throw new AppError('ERP-CORE-0004', 'Resource not found');

    const { subject, html } = renderMail({
      subject: draft.subject,
      message: draft.message,
      values: sampleValuesOf(definition, draft.locale),
      urlTokens: urlTokensOf(definition),
      locale: draft.locale,
      brand: await this.transport.brand(),
      subjectPrefix: null,
    });
    return { subject, html };
  }

  // --- templates (gated by the handlers on settings.emailTemplates.view and .edit) ---------------

  /** `GET templates`: one keyset page, the audience of each registered key, every module. */
  async listTemplates(query: unknown): Promise<TemplatesListResponseDto> {
    const request = this.validator.parseTemplateList(query);
    const [page, modules] = await Promise.all([
      this.repository.listTemplates(request),
      this.repository.templateModules(),
    ]);
    return this.transformer.templateList(page, (key) => this.registry.get(key), modules);
  }

  /** `GET templates/:id`: the editor's read, with its fingerprint and the caller's own test address. */
  async getTemplate(actor: AuthenticatedUser, params: unknown): Promise<TemplateResponseDto> {
    const { id } = this.validator.params(params);
    const template = await this.repository.findTemplateById(id);
    if (template === null) throw notFound();
    return this.transformer.template(
      template,
      this.registry.get(template.key),
      await this.sendTestOf(actor),
    );
  }

  /**
   * `PATCH templates/:id` with `If-Match` (ADR-0040): the wording rules over the definition's merge
   * fields, then the save under the row lock, refused with 412 when the shown columns changed since
   * the read. A key no module defines has no merge fields to check against: 409 `ERP-MAIL-0004`.
   */
  async saveTemplate(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
    ifMatch: string,
  ): Promise<TemplateResponseDto> {
    const { id } = this.validator.params(params);
    const input = this.validator.templateSave(body);
    const template = await this.repository.findTemplateById(id);
    if (template === null) throw notFound();
    const definition = this.registry.get(template.key);
    if (definition === undefined) throw new AppError('ERP-MAIL-0004');
    const tokens = new Set(definition.mergeFields.map((field) => field.token));
    const versions = this.validator.versions(input.versions, tokens, LOCALES);
    const saved = await this.repository.saveTemplate(
      id,
      (current) => {
        assertFresh(ifMatch, shownOf(current));
      },
      { active: input.active, versions, staffId: actor.staffId },
    );
    if (saved === null) throw notFound();
    this.logger.log('mail template saved', { id });
    return this.transformer.template(saved, definition, await this.sendTestOf(actor));
  }

  /** `PUT templates/:id/active`: the list's immediate switch; answers the list row. */
  async setTemplateActive(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<TemplateListItemDto> {
    const { id } = this.validator.params(params);
    const { active } = this.validator.templateActive(body);
    const saved = await this.repository.setActive(id, active, actor.staffId);
    if (saved === null) throw notFound();
    this.logger.log('mail template switched', { id, active });
    return this.transformer.templateListItem(listItemOf(saved), this.registry.get(saved.key));
  }

  /** `POST templates/active`: Enable All or Disable All of one module; answers how many changed. */
  async setModuleActive(actor: AuthenticatedUser, body: unknown): Promise<ModuleActiveResponseDto> {
    const { module, active } = this.validator.moduleActive(body);
    const changed = await this.repository.setActiveByModule(module, active, actor.staffId);
    this.logger.log('mail templates switched', { module, active, changed });
    return { changed };
  }

  /** `POST templates/:id/preview`: an unsaved draft rendered with the sample values. */
  previewTemplate(params: unknown, body: unknown): Promise<PreviewResponseDto> {
    const { id } = this.validator.params(params);
    return this.preview(id, this.validator.draftBody(body));
  }

  /**
   * `POST templates/:id/test`: the draft to the CALLER's own address (no body field names one,
   * T-4.3-03), counted per member (D-10). The draft rides in the job data: sample values only.
   */
  async sendTemplateTest(
    actor: AuthenticatedUser,
    params: unknown,
    body: unknown,
  ): Promise<AcceptedResponseDto> {
    const { id } = this.validator.params(params);
    const draft = this.validator.draftBody(body);
    this.validator.draft(draft.locale, draft.subject, draft.message, LOCALES);
    const template = await this.repository.findTemplateById(id);
    if (template === null || this.registry.get(template.key) === undefined) throw notFound();
    const to = await this.testRecipient(actor);
    return this.queueTest(
      actor,
      { templateKey: template.key, email: to.email, locale: draft.locale },
      {
        subject: draft.subject,
        message: draft.message,
      },
    );
  }

  /** `GET tests/:id`: the state of a test the CALLER sent; any other row is a 404 (T-4.3-13). */
  async getTest(actor: AuthenticatedUser, params: unknown): Promise<TestStateResponseDto> {
    const { id } = this.validator.params(params);
    const row = await this.repository.findSent(id);
    if (row?.isTest !== true || row.requestedByStaffId !== actor.staffId) throw notFound();
    return this.transformer.testState(row, await this.state.serverUnreachableSince());
  }

  // --- administrators only (no code on the handlers; the flag asserted first) ---------------------

  /** `GET sent-emails`: one keyset page, newest first; never a subject or a body (D-05). */
  async listSentEmails(
    actor: AuthenticatedUser,
    query: unknown,
  ): Promise<SentEmailsListResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const request = this.validator.parseSentList(query);
    const [page, keys, since] = await Promise.all([
      this.repository.listSent(request),
      this.repository.templateKeys(),
      this.state.serverUnreachableSince(),
    ]);
    const active = await this.activeByKey(page.items);
    return this.transformer.sentList(
      page,
      since,
      (row) =>
        row.isTest || row.templateKey === null ? null : (active.get(row.templateKey) ?? null),
      keys,
    );
  }

  /** `GET sent-emails/:id`: the row, the server reply, and whether the original of a resend still exists. */
  async getSentEmail(actor: AuthenticatedUser, params: unknown): Promise<SentEmailResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.params(params);
    const row = await this.repository.findSent(id);
    if (row === null) throw notFound();
    const [original, since, active] = await Promise.all([
      row.resentFromId === null
        ? Promise.resolve(null)
        : this.repository.findSent(row.resentFromId),
      this.state.serverUnreachableSince(),
      this.activeByKey([row]),
    ]);
    const templateActive =
      row.isTest || row.templateKey === null ? null : (active.get(row.templateKey) ?? null);
    return this.transformer.sentEmail(row, original !== null, since, templateActive);
  }

  /**
   * `POST sent-emails/:id/resend` (D-05, D-09 O-6): a NEW row to the original's recipient, linked by
   * `resentFromId`; the original is untouched. The worker renders it from the current wording and
   * the record's current values. Refused: a test (0008), still waiting (0006), not configured
   * (0002), the template off or no longer defined (0004), the record gone (0005).
   */
  async resend(actor: AuthenticatedUser, params: unknown): Promise<AcceptedResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const { id } = this.validator.params(params);
    const original = await this.repository.findSent(id);
    if (original === null) throw notFound();
    await this.assertResendable(original);
    const { row } = await this.repository.insertSent(
      {
        templateKey: original.templateKey,
        isTest: false,
        sourceRef: original.sourceRef,
        recipientEmail: original.recipientEmail,
        locale: original.locale,
        status: 'queued',
        failureReason: null,
        maxAttempts: RETRY_POLICIES.mailSend.attempts,
        dedupeKey: null,
        resentFromId: original.id,
        requestedByStaffId: actor.staffId,
        requestId: requestIdNow(),
      },
      new Date(this.now()),
    );
    await this.enqueueOrFail(row.id, { sentEmailId: row.id });
    this.logger.log('mail resend queued', { id: row.id, resentFromId: original.id });
    return { id: String(row.id) };
  }

  /** `GET status` (D-02): the setup, the server state, the last send; never a credential. */
  async getStatus(actor: AuthenticatedUser): Promise<StatusResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const [since, last, sendTest] = await Promise.all([
      this.state.serverUnreachableSince(),
      this.repository.lastFinished(),
      this.sendTestOf(actor),
    ]);
    return this.transformer.status({
      configured: this.transport.configured,
      smtp: this.transport.smtpSettings(),
      since,
      last,
      recipient: sendTest.recipient,
    });
  }

  /** `POST status/test` (D-02): the fixed test wording to the administrator's own address. */
  async sendStatusTest(actor: AuthenticatedUser): Promise<AcceptedResponseDto> {
    this.assertAdministrator(actor, ADMIN_ONLY);
    const to = await this.testRecipient(actor);
    const locale = to.locale !== null && LOCALES.includes(to.locale) ? to.locale : DEFAULT_LOCALE;
    return this.queueTest(actor, { templateKey: null, email: to.email, locale }, undefined);
  }

  // --- internals of the screens -----------------------------------------------------------------

  /** D-09: the administrator flag, never a permission code; `ERP-AUTH-0005`. */
  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-AUTH-0005', detail);
  }

  /** Whether mail can be sent, and the caller's own address (or null). */
  private async sendTestOf(actor: AuthenticatedUser): Promise<SendTestDto> {
    const contact = await this.transport.contactOf(actor.staffId);
    return { configured: this.transport.configured, recipient: contact?.email ?? null };
  }

  /** Configured, a known caller: her address and locale. 409 `ERP-MAIL-0002`, 404 otherwise. */
  private async testRecipient(
    actor: AuthenticatedUser,
  ): Promise<{ readonly email: string; readonly locale: string | null }> {
    if (!this.transport.configured) throw new AppError('ERP-MAIL-0002');
    const contact = await this.transport.contactOf(actor.staffId);
    if (contact === null) throw notFound();
    return contact;
  }

  /** Counts the test (D-10), then writes its row and adds its job; 429 past the window's limit. */
  private async queueTest(
    actor: AuthenticatedUser,
    to: { readonly templateKey: string | null; readonly email: string; readonly locale: string },
    draft: MailSendJob['draft'],
  ): Promise<AcceptedResponseDto> {
    const counted = await this.state.countTest(actor.staffId);
    if (counted.count > TIMINGS.mail.testMaxPerWindow) {
      const retryAfterS = Math.max(1, Math.ceil(counted.retryAfterMs / MS_PER_SECOND));
      throw new AppError('ERP-MAIL-0007', undefined, { retryAfterS });
    }
    const { row } = await this.repository.insertSent(
      {
        templateKey: to.templateKey,
        isTest: true,
        sourceRef: null,
        recipientEmail: to.email,
        locale: to.locale,
        status: 'queued',
        failureReason: null,
        maxAttempts: RETRY_POLICIES.mailSend.attempts,
        dedupeKey: null,
        resentFromId: null,
        requestedByStaffId: actor.staffId,
        requestId: requestIdNow(),
      },
      new Date(this.now()),
    );
    await this.enqueueOrFail(row.id, {
      sentEmailId: row.id,
      ...(draft === undefined ? {} : { draft }),
    });
    this.logger.log('mail test queued', { id: row.id });
    return { id: String(row.id) };
  }

  /**
   * Adds the row's job. A lost add marks the row failed (the sweep never re-adds a test, and a
   * resend must not wait five minutes unseen) and answers 503 `ERP-UPSTREAM-0001`.
   */
  private async enqueueOrFail(id: number, job: MailSendJob): Promise<void> {
    try {
      await enqueueMailSend(this.queues, job);
    } catch (error: unknown) {
      await this.repository.markFailed(id, 0, 'unknown', null, new Date(this.now()));
      this.logger.error('mail job not added', { id, error });
      throw new AppError('ERP-UPSTREAM-0001', 'the mail queue is unavailable');
    }
  }

  /** The refusals of a resend, in the order the screen explains them. */
  private async assertResendable(original: SentEmail): Promise<void> {
    if (original.isTest) throw new AppError('ERP-MAIL-0008');
    if (original.status === 'queued' || original.status === 'retrying') {
      throw new AppError('ERP-MAIL-0006');
    }
    if (!this.transport.configured) throw new AppError('ERP-MAIL-0002');
    const definition = await this.activeDefinition(original.templateKey);
    if (definition === null) throw new AppError('ERP-MAIL-0004');
    if (original.sourceRef === null || (await definition.resolve(original.sourceRef)) === null) {
      throw new AppError('ERP-MAIL-0005');
    }
  }

  /** The definition of a stored, active, registered template; null otherwise. */
  private async activeDefinition(key: string | null): Promise<MailTemplateDefinition | null> {
    if (key === null) return null;
    const definition = this.registry.get(key);
    const template = definition === undefined ? null : await this.repository.findTemplateByKey(key);
    return template?.active === true && definition !== undefined ? definition : null;
  }

  /** Active of each distinct template key on the rows, in one read (a key with no stored template is absent). */
  private activeByKey(rows: readonly SentEmail[]): Promise<ReadonlyMap<string, boolean>> {
    const keys = new Set(
      rows.flatMap((row) => (row.templateKey === null ? [] : [row.templateKey])),
    );
    return this.repository.templateActivity([...keys]);
  }

  /** Whether `key`'s template is active, seeding it from Perfex on its first use. */
  private async isActive(key: string): Promise<boolean> {
    const template =
      (await this.repository.findTemplateByKey(key)) ??
      (await this.ensureSeeded(key).then(() => this.repository.findTemplateByKey(key)));
    if (template === null) throw new Error(`mail template ${key} could not be seeded`);
    return template.active;
  }

  /** No row: an unregistered key is a programming error (warn); the other skips are expected. */
  private skipped(template: string, reason: SkipReason): SendOutcome {
    if (reason === 'not_registered') this.logger.warn('mail send skipped', { template, reason });
    else this.logger.log('mail send skipped', { template, reason });
    return { status: 'skipped', reason };
  }
}
