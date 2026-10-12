/**
 * `MailSendProcessor` over fakes (port, repository, state store, registry, a fixed clock): the row
 * moves the RESEARCH R2 table names, the open breaker defers without spending an attempt, and no log
 * line carries an address (T-4.3-05).
 */
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../shared/config/app-config.js';
import { RETRY_POLICIES } from '../../../shared/config/retry-policies.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import { RetryLaterError } from '../../../shared/errors/retry-later.error.js';
import { UpstreamUnavailableError } from '../../../shared/errors/upstream-unavailable.error.js';
import {
  DeferJobError,
  NonRetryableJobError,
  type QueueJob,
} from '../../../shared/queue/base.processor.js';
import { MailSendProcessor } from '../jobs/mail-send.processor.js';
import type { MailSendJob } from '../jobs/mail-send.job.js';
import type { NewSentEmail, SentEmail } from '../model/mail.model.js';
import type { MailRepository } from '../repository/mail.repository.js';
import { InMemoryStorage } from '../../../shared/storage/__tests__/in-memory.storage.js';
import { newStorageKey } from '../../../shared/storage/storage.port.js';
import {
  MAIL_ATTACHMENTS_MAX,
  MailTemplateRegistry,
  type MailAttachment,
  type MailTemplateDefinition,
} from '../service/mail-template.registry.js';
import { MailTransport } from '../service/mail.transport.js';
import {
  brandingFacadeOf,
  definitionWithAttachments,
  FakeEmailProvider,
  FakeMailRepository,
  FakeQueueService,
  identityFacadeOf,
  InMemoryMailStateStore,
  RecordingLogger,
  sentOf,
  TEST_DEFINITION,
  TEST_PUBLIC_BASE_URL,
  templateOf,
} from './fakes.js';

const NOW_MS = Date.parse('2026-10-03T08:00:00.000Z');
const ADDRESS = 'user@example.test';
/** The harness's `UPLOAD_MAX_BYTES`: the total size the attachments of one mail may reach. */
const UPLOAD_MAX_BYTES = 64;

/** The test definition whose resolver answers a value that must be escaped, for record '1' only. */
const DEFINITION: MailTemplateDefinition = {
  ...TEST_DEFINITION,
  resolve: (sourceRef) =>
    Promise.resolve(
      sourceRef === '1'
        ? {
            to: { email: ADDRESS, locale: null },
            values: { staff_name: 'Ann <b>', link: 'https://example.test/r/1' },
          }
        : null,
    ),
};

function harness(definition: MailTemplateDefinition = DEFINITION) {
  const repo = new FakeMailRepository();
  const storage = new InMemoryStorage();
  const email = new FakeEmailProvider();
  const state = new InMemoryMailStateStore(() => NOW_MS);
  const logger = new RecordingLogger();
  const registry = new MailTemplateRegistry();
  registry.register(definition);
  const config = {
    env: { PUBLIC_BASE_URL: TEST_PUBLIC_BASE_URL, UPLOAD_MAX_BYTES },
  } as unknown as AppConfig;
  const processor = new MailSendProcessor(
    new FakeQueueService(),
    repo as unknown as MailRepository,
    registry,
    new MailTransport(brandingFacadeOf(), identityFacadeOf(), config, email),
    state,
    logger,
    storage,
    config,
  );
  processor.now = () => NOW_MS;
  repo.templates.push(
    templateOf(1, {
      key: DEFINITION.key,
      module: DEFINITION.module,
      active: true,
      formattingDropped: false,
      versions: [
        {
          locale: 'en',
          subject: 'Notice for {staff_name}',
          message: 'Hello {staff_name}\n\n{link}',
        },
        { locale: 'ar', subject: 'AR notice', message: 'AR {staff_name}' },
      ],
    }),
  );
  return { repo, email, state, logger, registry, processor, storage };
}

/** A log row in the fake: a queued real send of record '1' unless `overrides` say otherwise. */
function rowIn(repo: FakeMailRepository, overrides: Partial<NewSentEmail> = {}): SentEmail {
  const row = sentOf(
    repo.sent.length + 1,
    {
      templateKey: DEFINITION.key,
      isTest: false,
      sourceRef: '1',
      recipientEmail: ADDRESS,
      locale: 'en',
      status: 'queued',
      failureReason: null,
      maxAttempts: 8,
      dedupeKey: null,
      resentFromId: null,
      requestedByStaffId: null,
      requestId: null,
      ...overrides,
    },
    new Date(NOW_MS - 1_000),
  );
  repo.sent.push(row);
  return row;
}

function jobOf(data: unknown, attemptsMade = 0): QueueJob<MailSendJob> {
  return { id: 'mail-1', name: 'send', data: data as MailSendJob, attemptsMade };
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (reason: unknown) => reason,
  );
}

const sentRow = (repo: FakeMailRepository, id = 1) => repo.sent.find((row) => row.id === id);

describe('MailSendProcessor: shape', () => {
  it('consumes mail.send with RETRY_POLICIES.mailSend and the SMTP pool size', () => {
    const { processor } = harness();
    expect(processor.queue).toBe('mail.send');
    expect(processor.retryPolicy).toBe(RETRY_POLICIES.mailSend);
    expect(processor.concurrency).toBe(2);
  });

  it('invalid job data is a NonRetryableJobError', async () => {
    const { processor } = harness();
    expect(await rejection(processor.handle(jobOf({ sentEmailId: 'x' })))).toBeInstanceOf(
      NonRetryableJobError,
    );
    expect(
      await rejection(processor.handle(jobOf({ sentEmailId: 1, address: ADDRESS }))),
    ).toBeInstanceOf(NonRetryableJobError);
  });
});

describe('MailSendProcessor: a real send', () => {
  it('sends once with the row recipient, Message-ID and locale, the escaped value, then marks it sent', async () => {
    const { repo, email, state, processor } = harness();
    await state.markServerUnreachable(new Date(NOW_MS - 60_000));
    rowIn(repo);
    await processor.handle(jobOf({ sentEmailId: 1 }));

    expect(email.sent).toHaveLength(1);
    const [message] = email.sent;
    expect(message).toMatchObject({ to: ADDRESS, messageId: '<mail-1@localhost>', locale: 'en' });
    expect(message?.subject).toBe('Notice for Ann <b>');
    expect(message?.html).toContain('Hello Ann &lt;b&gt;');
    expect(message?.html).not.toContain('Ann <b>');
    expect(sentRow(repo)).toMatchObject({ status: 'sent', attempts: 1, sentAt: new Date(NOW_MS) });
    expect(await state.serverUnreachableSince()).toBeNull();
  });

  it("renders the row's locale version, and English when the row's locale has none", async () => {
    const { repo, email, processor } = harness();
    rowIn(repo, { locale: 'ar' });
    rowIn(repo, { locale: 'fr' });
    await processor.handle(jobOf({ sentEmailId: 1 }));
    await processor.handle(jobOf({ sentEmailId: 2 }));
    expect(email.sent.map((message) => message.subject)).toEqual([
      'AR notice',
      'Notice for Ann <b>',
    ]);
  });

  it('a transient refusal on attempt 1 of 8: retrying, next try in 30 s, reason and reply stored, RetryLaterError', async () => {
    const { repo, email, state, processor } = harness();
    email.result = {
      ok: false,
      reason: 'recipient_refused',
      transient: true,
      serverReply: '451 later',
    };
    rowIn(repo);
    const error = await rejection(processor.handle(jobOf({ sentEmailId: 1 })));
    expect(error).toBeInstanceOf(RetryLaterError);
    expect(sentRow(repo)).toMatchObject({
      status: 'retrying',
      attempts: 1,
      nextTryAt: new Date(NOW_MS + 30_000),
      failureReason: 'recipient_refused',
      serverReply: '451 later',
    });
    expect(await state.serverUnreachableSince()).toBeNull();
  });

  it('a transient server_unreachable also marks the server unreachable', async () => {
    const { repo, email, state, processor } = harness();
    email.result = { ok: false, reason: 'server_unreachable', transient: true, serverReply: null };
    rowIn(repo);
    expect(await rejection(processor.handle(jobOf({ sentEmailId: 1 })))).toBeInstanceOf(
      RetryLaterError,
    );
    expect(sentRow(repo)?.status).toBe('retrying');
    expect(await state.serverUnreachableSince()).toEqual(new Date(NOW_MS));
  });

  it('a permanent refusal: failed at once, NonRetryableJobError', async () => {
    const { repo, email, processor } = harness();
    email.result = {
      ok: false,
      reason: 'recipient_refused',
      transient: false,
      serverReply: '550 no such user',
    };
    rowIn(repo);
    expect(await rejection(processor.handle(jobOf({ sentEmailId: 1 })))).toBeInstanceOf(
      NonRetryableJobError,
    );
    expect(sentRow(repo)).toMatchObject({
      status: 'failed',
      attempts: 1,
      failureReason: 'recipient_refused',
      serverReply: '550 no such user',
      nextTryAt: null,
    });
  });

  it('a transient refusal on attempt 8 of 8: failed, NonRetryableJobError', async () => {
    const { repo, email, processor } = harness();
    email.result = { ok: false, reason: 'timeout', transient: true, serverReply: null };
    rowIn(repo, { status: 'queued' });
    expect(await rejection(processor.handle(jobOf({ sentEmailId: 1 }, 7)))).toBeInstanceOf(
      NonRetryableJobError,
    );
    expect(sentRow(repo)).toMatchObject({
      status: 'failed',
      attempts: 8,
      failureReason: 'timeout',
    });
  });

  it('the open breaker defers by the half-open delay: no attempt spent, row untouched, server marked', async () => {
    const { repo, email, state, processor } = harness();
    email.rejectWith = new UpstreamUnavailableError('email', 30);
    rowIn(repo);
    const error = await rejection(processor.handle(jobOf({ sentEmailId: 1 })));
    expect(error).toBeInstanceOf(DeferJobError);
    expect((error as DeferJobError).delayMs).toBe(TIMINGS.breaker.halfOpenAfterMs);
    expect(sentRow(repo)).toMatchObject({ status: 'queued', attempts: 0 });
    expect(repo.methods().filter((method) => method.startsWith('mark'))).toEqual([]);
    expect(await state.serverUnreachableSince()).toEqual(new Date(NOW_MS));
  });
});

describe('MailSendProcessor: failed without sending', () => {
  it('an inactive template: failed/template_off, nothing sent, resolves', async () => {
    const { repo, email, processor } = harness();
    const template = repo.templates[0];
    if (template !== undefined) repo.templates[0] = { ...template, active: false };
    rowIn(repo);
    await processor.handle(jobOf({ sentEmailId: 1 }));
    expect(email.sent).toEqual([]);
    expect(sentRow(repo)).toMatchObject({
      status: 'failed',
      failureReason: 'template_off',
      attempts: 0,
    });
  });

  it('the record gone: failed/record_gone, resolves', async () => {
    const { repo, email, processor } = harness();
    rowIn(repo, { sourceRef: '2' });
    await processor.handle(jobOf({ sentEmailId: 1 }));
    expect(email.sent).toEqual([]);
    expect(sentRow(repo)).toMatchObject({ status: 'failed', failureReason: 'record_gone' });
  });

  it('mail not configured: failed/not_configured, resolves', async () => {
    const { repo, email, processor } = harness();
    email.configured = false;
    rowIn(repo);
    await processor.handle(jobOf({ sentEmailId: 1 }));
    expect(email.sent).toEqual([]);
    expect(sentRow(repo)).toMatchObject({ status: 'failed', failureReason: 'not_configured' });
  });

  it('a template no module registers any more: failed/unknown, NonRetryableJobError', async () => {
    const { repo, email, processor } = harness();
    repo.templates.push(
      templateOf(2, {
        key: 'zz_gone',
        module: 'zz_tests',
        active: true,
        formattingDropped: false,
        versions: [{ locale: 'en', subject: 'S', message: 'M' }],
      }),
    );
    rowIn(repo, { templateKey: 'zz_gone' });
    expect(await rejection(processor.handle(jobOf({ sentEmailId: 1 })))).toBeInstanceOf(
      NonRetryableJobError,
    );
    expect(email.sent).toEqual([]);
    expect(sentRow(repo)).toMatchObject({ status: 'failed', failureReason: 'unknown' });
  });

  it('a resolver that throws: failed/unknown, NonRetryableJobError, no value logged', async () => {
    const { repo, email, registry, logger, processor } = harness();
    registry.register({
      ...DEFINITION,
      key: 'zz_throws',
      resolve: () => Promise.reject(new Error(`lookup of ${ADDRESS} failed`)),
    });
    repo.templates.push(
      templateOf(2, {
        key: 'zz_throws',
        module: 'zz_tests',
        active: true,
        formattingDropped: false,
        versions: [{ locale: 'en', subject: 'S', message: 'M' }],
      }),
    );
    rowIn(repo, { templateKey: 'zz_throws' });
    expect(await rejection(processor.handle(jobOf({ sentEmailId: 1 })))).toBeInstanceOf(
      NonRetryableJobError,
    );
    expect(email.sent).toEqual([]);
    expect(sentRow(repo)).toMatchObject({ status: 'failed', failureReason: 'unknown' });
    expect(JSON.stringify(logger.lines)).not.toContain(ADDRESS);
  });

  it('an already sent or failed row, or a purged one: nothing is called', async () => {
    const { repo, email, processor } = harness();
    rowIn(repo, { status: 'failed', failureReason: 'recipient_refused' });
    const sent = rowIn(repo);
    repo.sent[1] = { ...sent, status: 'sent' };
    await processor.handle(jobOf({ sentEmailId: 1 }));
    await processor.handle(jobOf({ sentEmailId: 2 }));
    await processor.handle(jobOf({ sentEmailId: 99 }));
    expect(email.sent).toEqual([]);
    expect(repo.methods()).toEqual(['findSent', 'findSent', 'findSent']);
  });
});

describe('MailSendProcessor: test sends', () => {
  it('a status test renders the status_test_subject with the [Test] prefix, no template', async () => {
    const { repo, email, processor } = harness();
    rowIn(repo, { templateKey: null, isTest: true, sourceRef: null });
    await processor.handle(jobOf({ sentEmailId: 1 }));
    expect(email.sent[0]?.subject).toBe('[Test] Email test from the new system');
    expect(email.sent[0]?.text).toContain('This is a test email sent from the Email status page.');
    expect(sentRow(repo)?.status).toBe('sent');
  });

  it("a template test renders the job's draft with the sample values and the [Test] prefix", async () => {
    const { repo, email, processor } = harness();
    rowIn(repo, { isTest: true, sourceRef: null });
    await processor.handle(
      jobOf({ sentEmailId: 1, draft: { subject: 'Draft {staff_name}', message: 'See {link}' } }),
    );
    expect(email.sent[0]?.subject).toBe('[Test] Draft Sample Staff');
    expect(email.sent[0]?.html).toContain('href="https://example.test/sample-record"');
    expect(sentRow(repo)?.status).toBe('sent');
  });

  it('a template test without a draft: failed/unknown, NonRetryableJobError', async () => {
    const { repo, email, processor } = harness();
    rowIn(repo, { isTest: true, sourceRef: null });
    expect(await rejection(processor.handle(jobOf({ sentEmailId: 1 })))).toBeInstanceOf(
      NonRetryableJobError,
    );
    expect(email.sent).toEqual([]);
    expect(sentRow(repo)).toMatchObject({ status: 'failed', failureReason: 'unknown' });
  });
});

describe('MailSendProcessor: log lines (T-4.3-05)', () => {
  it('no line carries an address, a subject or a value; lines carry the id and a reason at most', async () => {
    const { repo, email, logger, processor } = harness();
    rowIn(repo);
    await processor.handle(jobOf({ sentEmailId: 1 }));
    email.result = { ok: false, reason: 'recipient_refused', transient: false, serverReply: '550' };
    rowIn(repo);
    await rejection(processor.handle(jobOf({ sentEmailId: 2 })));
    email.result = { ok: false, reason: 'timeout', transient: true, serverReply: null };
    rowIn(repo);
    await rejection(processor.handle(jobOf({ sentEmailId: 3 })));
    email.rejectWith = new UpstreamUnavailableError('email', 30);
    rowIn(repo);
    await rejection(processor.handle(jobOf({ sentEmailId: 4 })));

    const text = JSON.stringify(logger.lines);
    for (const secret of [ADDRESS, 'Ann', 'Notice']) expect(text).not.toContain(secret);
    for (const line of logger.lines) {
      expect(Object.keys(line.meta ?? {}).every((key) => ['id', 'reason'].includes(key))).toBe(
        true,
      );
    }
    expect(logger.lines.map((line) => line.message)).toEqual([
      'mail sent',
      'mail failed',
      'mail retrying',
      'mail deferred',
    ]);
  });
});

/** Stores `text` under a fresh key in `storage`; answers the attachment naming it. */
function stored(
  storage: InMemoryStorage,
  text: string,
  fileName: string,
  contentType = 'text/plain',
): MailAttachment {
  const storageKey = newStorageKey('zz-tests');
  storage.objects.set(storageKey, Buffer.from(text, 'utf8'));
  return { storageKey, fileName, contentType };
}

/** A harness whose definition answers the attachments `make` stores (ADR-0052). */
function attachedHarness(make: (storage: InMemoryStorage) => readonly MailAttachment[]) {
  const list: MailAttachment[] = [];
  const h = harness(definitionWithAttachments(list));
  list.push(...make(h.storage));
  return h;
}

describe('MailSendProcessor: attachments (ADR-0052)', () => {
  it('two attachments reach the port as bytes, names and types in order; the row is sent; the log counts them', async () => {
    const { repo, email, logger, processor } = attachedHarness((storage) => [
      stored(storage, 'first', 'one.txt'),
      stored(storage, 'second', 'two.pdf', 'application/pdf'),
    ]);
    rowIn(repo);
    await processor.handle(jobOf({ sentEmailId: 1 }));
    expect(email.sent[0]?.attachments).toEqual([
      { filename: 'one.txt', contentType: 'text/plain', content: Buffer.from('first') },
      { filename: 'two.pdf', contentType: 'application/pdf', content: Buffer.from('second') },
    ]);
    expect(sentRow(repo)?.status).toBe('sent');
    expect(logger.lines).toContainEqual({
      level: 'log',
      message: 'mail sent',
      meta: { id: 1, attachments: 2 },
    });
    expect(JSON.stringify(logger.lines)).not.toContain('one.txt');
  });

  it('a stored object that is gone: failed/record_gone, nothing sent, the job not retried', async () => {
    const { repo, email, processor } = attachedHarness(() => [
      { storageKey: newStorageKey('zz-tests'), fileName: 'gone.txt', contentType: 'text/plain' },
    ]);
    rowIn(repo);
    await processor.handle(jobOf({ sentEmailId: 1 }));
    expect(email.sent).toEqual([]);
    expect(sentRow(repo)).toMatchObject({ status: 'failed', failureReason: 'record_gone' });
  });

  it('sizes summing above UPLOAD_MAX_BYTES: failed/unknown, NonRetryableJobError, nothing sent', async () => {
    const half = 'x'.repeat(UPLOAD_MAX_BYTES / 2);
    const { repo, email, processor } = attachedHarness((storage) => [
      stored(storage, half, 'a.txt'),
      stored(storage, `${half}x`, 'b.txt'),
    ]);
    rowIn(repo);
    expect(await rejection(processor.handle(jobOf({ sentEmailId: 1 })))).toBeInstanceOf(
      NonRetryableJobError,
    );
    expect(email.sent).toEqual([]);
    expect(sentRow(repo)).toMatchObject({ status: 'failed', failureReason: 'unknown' });
  });

  it('exactly UPLOAD_MAX_BYTES in total is sent', async () => {
    const half = 'x'.repeat(UPLOAD_MAX_BYTES / 2);
    const { repo, email, processor } = attachedHarness((storage) => [
      stored(storage, half, 'a.txt'),
      stored(storage, half, 'b.txt'),
    ]);
    rowIn(repo);
    await processor.handle(jobOf({ sentEmailId: 1 }));
    expect(email.sent[0]?.attachments).toHaveLength(2);
  });

  it('more than MAIL_ATTACHMENTS_MAX files: failed/unknown, NonRetryableJobError, nothing sent', async () => {
    const { repo, email, processor } = attachedHarness((storage) => {
      const one = stored(storage, 'x', 'x.txt');
      return Array.from({ length: MAIL_ATTACHMENTS_MAX + 1 }, () => one);
    });
    rowIn(repo);
    expect(await rejection(processor.handle(jobOf({ sentEmailId: 1 })))).toBeInstanceOf(
      NonRetryableJobError,
    );
    expect(email.sent).toEqual([]);
    expect(sentRow(repo)).toMatchObject({ status: 'failed', failureReason: 'unknown' });
  });

  it('a key outside STORAGE_KEY: failed/unknown, fatal, nothing sent', async () => {
    const { repo, email, processor } = attachedHarness(() => [
      { storageKey: '../../etc/passwd', fileName: 'p.txt', contentType: 'text/plain' },
    ]);
    rowIn(repo);
    expect(await rejection(processor.handle(jobOf({ sentEmailId: 1 })))).toBeInstanceOf(
      NonRetryableJobError,
    );
    expect(email.sent).toEqual([]);
    expect(sentRow(repo)).toMatchObject({ status: 'failed', failureReason: 'unknown' });
  });

  it('a template test send never carries attachments, even when the resolver answers them', async () => {
    const { repo, email, processor } = attachedHarness((storage) => [
      stored(storage, 'first', 'one.txt'),
    ]);
    rowIn(repo, { isTest: true, sourceRef: null });
    await processor.handle(
      jobOf({ sentEmailId: 1, draft: { subject: 'Draft {staff_name}', message: 'See {link}' } }),
    );
    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).not.toHaveProperty('attachments');
  });

  it('a resolver answering no attachments sends a message without an attachments key', async () => {
    const { repo, email, logger, processor } = harness();
    rowIn(repo);
    await processor.handle(jobOf({ sentEmailId: 1 }));
    expect(email.sent[0]).not.toHaveProperty('attachments');
    expect(logger.lines).toContainEqual({ level: 'log', message: 'mail sent', meta: { id: 1 } });
  });
});
