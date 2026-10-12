import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig } from '../../../shared/config/app-config.js';
import { RETRY_POLICIES } from '../../../shared/config/retry-policies.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { StaffContact } from '../../identity/index.js';
import type { MailStateStore } from '../repository/mail-state.store.js';
import type { QueueService } from '../../../shared/queue/queue.service.js';
import type { MailRepository } from '../repository/mail.repository.js';
import {
  MailTemplateRegistry,
  type MailTemplateDefinition,
} from '../service/mail-template.registry.js';
import { messageOf } from '../service/mail.messages.js';
import { MailService } from '../service/mail.service.js';
import { MailTransformer } from '../service/mail.transformer.js';
import { MailTransport } from '../service/mail.transport.js';
import { MailValidator } from '../service/mail.validator.js';
import { createMailTestApp, type MailTestApp } from './create-mail-test-app.js';
import {
  brandingFacadeOf,
  FakeEmailProvider,
  FakeMailRepository,
  FakeQueueService,
  identityFacadeOf,
  InMemoryMailStateStore,
  RecordingLogger,
  TEST_DEFINITION,
  TEST_PUBLIC_BASE_URL,
  TEST_RESOLVED,
  templateOf,
} from './fakes.js';

const NOW_MS = Date.parse('2026-10-03T08:00:00.000Z');

describe('MailService (module)', () => {
  let ctx: MailTestApp;

  beforeAll(async () => {
    ctx = await createMailTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('resolves from the module', () => {
    expect(ctx.moduleRef.get(MailService)).toBeInstanceOf(MailService);
  });
});

interface Harness {
  readonly service: MailService;
  readonly repo: FakeMailRepository;
  readonly logger: RecordingLogger;
  readonly registry: MailTemplateRegistry;
  readonly email: FakeEmailProvider;
  readonly queue: FakeQueueService;
}

/** Staff 3 edits templates; staff 1 is an administrator (synthetic addresses). */
const CONTACTS: ReadonlyMap<number, StaffContact> = new Map([
  [1, { email: 'admin@example.test', locale: null, active: true }],
  [3, { email: 'edit@example.test', locale: null, active: true }],
]);

function actorOf(staffId: number, isAdmin = false): AuthenticatedUser {
  return {
    staffId,
    sessionId: 'sid',
    jti: 'jti',
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: 4_102_444_800,
  };
}

const EDITOR = actorOf(3);
const ADMIN = actorOf(1, true);

/** A service over fresh fakes, with the test definition registered; `add` lands in `repo.calls` too. */
function harness(state: MailStateStore = new InMemoryMailStateStore(() => NOW_MS)): Harness {
  const repo = new FakeMailRepository();
  const logger = new RecordingLogger();
  const registry = new MailTemplateRegistry();
  registry.register(TEST_DEFINITION);
  const email = new FakeEmailProvider();
  const queue = new FakeQueueService(repo.calls);
  const config = { env: { PUBLIC_BASE_URL: TEST_PUBLIC_BASE_URL } } as unknown as AppConfig;
  const service = new MailService(
    repo as unknown as MailRepository,
    registry,
    new MailValidator(),
    new MailTransport(brandingFacadeOf(), identityFacadeOf(CONTACTS), config, email),
    queue as unknown as QueueService,
    logger,
    new MailTransformer(),
    state,
  );
  service.now = () => NOW_MS;
  return { service, repo, logger, registry, email, queue };
}

/** The one template `createTemplate` was asked for. */
function created(repo: FakeMailRepository): unknown {
  const calls = repo.calls.filter((call) => call.method === 'createTemplate');
  expect(calls).toHaveLength(1);
  return calls[0]?.args[0];
}

async function rejection(promise: Promise<unknown>): Promise<AppError> {
  const error: unknown = await promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe('MailService.ensureSeeded', () => {
  it('copies the supported languages once: tags dropped and flagged, the English row active, the first row per locale', async () => {
    const { service, repo } = harness();
    repo.perfexRows = [
      {
        language: 'english',
        subject: 'Hello {staff_name}',
        message: '<p>A</p><p>B</p>',
        active: true,
      },
      {
        language: 'arabic',
        subject: 'Synthetic subject',
        message: '<strong>x</strong>',
        active: false,
      },
      { language: 'french', subject: 'Skipped', message: 'Skipped', active: true },
      { language: 'English', subject: 'Second english row', message: 'ignored', active: false },
      { language: null, subject: 'No language', message: 'ignored', active: true },
    ];
    await service.ensureSeeded('zz_test_notice');
    expect(created(repo)).toEqual({
      key: 'zz_test_notice',
      module: 'zz_tests',
      active: true,
      formattingDropped: true,
      versions: [
        { locale: 'en', subject: 'Hello {staff_name}', message: 'A\n\nB' },
        { locale: 'ar', subject: 'Synthetic subject', message: 'x' },
      ],
    });
  });

  it("keeps Perfex's off switch of the English row", async () => {
    const { service, repo } = harness();
    repo.perfexRows = [{ language: 'english', subject: 'S', message: 'M', active: false }];
    await service.ensureSeeded('zz_test_notice');
    expect(created(repo)).toMatchObject({ active: false, formattingDropped: false });
  });

  it('no English row: English from the fallback keys, active', async () => {
    const { service, repo } = harness();
    repo.perfexRows = [{ language: 'arabic', subject: 'S', message: 'M', active: false }];
    await service.ensureSeeded('zz_test_notice');
    expect(created(repo)).toEqual({
      key: 'zz_test_notice',
      module: 'zz_tests',
      active: true,
      formattingDropped: false,
      versions: [
        { locale: 'ar', subject: 'S', message: 'M' },
        {
          locale: 'en',
          subject: messageOf('en', 'status_test_subject'),
          message: messageOf('en', 'status_test_message'),
        },
      ],
    });
  });

  it('no Perfex rows: English from the fallback keys only', async () => {
    const { service, repo } = harness();
    await service.ensureSeeded('zz_test_notice');
    expect(created(repo)).toMatchObject({
      active: true,
      versions: [{ locale: 'en', subject: messageOf('en', 'status_test_subject') }],
    });
  });

  it('an existing template changes nothing: no Perfex read, no create; a second call is a no-op', async () => {
    const { service, repo } = harness();
    await service.ensureSeeded('zz_test_notice');
    await service.ensureSeeded('zz_test_notice');
    expect(repo.methods()).toEqual([
      'findTemplateByKey',
      'readPerfexTemplates',
      'createTemplate',
      'findTemplateByKey',
    ]);
  });

  it('another process seeding first (createTemplate answers null) is success, with no seeded line', async () => {
    const { service, repo, logger } = harness();
    repo.seededElsewhere = true;
    await expect(service.ensureSeeded('zz_test_notice')).resolves.toBeUndefined();
    expect(logger.lines).toEqual([]);
  });

  it("reads Perfex's rows by the legacySlug when the definition names one, by the key otherwise", async () => {
    const { service, repo, registry } = harness();
    registry.register({ ...TEST_DEFINITION, key: 'zz_slugged', legacySlug: 'zz-slugged-notice' });
    await service.ensureSeeded('zz_slugged');
    await service.ensureSeeded('zz_test_notice');
    expect(
      repo.calls.filter((call) => call.method === 'readPerfexTemplates').map((call) => call.args),
    ).toEqual([['zz-slugged-notice'], ['zz_test_notice']]);
  });

  it('an unregistered key rejects before any read', async () => {
    const { service, repo } = harness();
    await expect(service.ensureSeeded('nope')).rejects.toThrow(
      'mail template nope is not registered',
    );
    expect(repo.calls).toEqual([]);
  });

  it('logs the key, the locales and the flag, never the wording (T-4.3-26)', async () => {
    const { service, repo, logger } = harness();
    repo.perfexRows = [
      {
        language: 'english',
        subject: 'Hello {staff_name}',
        message: '<b>Secret wording</b>',
        active: true,
      },
    ];
    await service.ensureSeeded('zz_test_notice');
    expect(logger.lines).toEqual([
      {
        level: 'log',
        message: 'mail template seeded',
        meta: { key: 'zz_test_notice', locales: ['en'], formattingDropped: true },
      },
    ]);
    expect(JSON.stringify(logger.lines)).not.toMatch(/Hello|Secret/u);
  });
});

describe('MailService.preview', () => {
  const draft = {
    locale: 'en',
    subject: 'Hi {staff_name}',
    message: 'Hello {staff_name}, see {link}',
  };

  function withTemplate(key = 'zz_test_notice'): ReturnType<typeof harness> {
    const h = harness();
    h.repo.templates.push(
      templateOf(5, {
        key,
        module: 'zz_tests',
        active: true,
        formattingDropped: false,
        versions: [],
      }),
    );
    return h;
  }

  it('renders the draft with the sample values, the url field as a link, inside the brand', async () => {
    const { service } = withTemplate();
    const preview = await service.preview(5, draft);
    expect(preview.subject).toBe('Hi Sample Staff');
    expect(preview.html).toContain('Hello Sample Staff, see ');
    expect(preview.html.split('<a href="https://example.test/sample-record"').length).toBe(2);
    expect(preview.html).toContain('src="http://localhost:8088/uploads/company/logo.png"');
    expect(preview.html).toContain('<html lang="en" dir="ltr">');
    expect(Object.keys(preview)).toEqual(['subject', 'html']);
  });

  it('ar renders right to left', async () => {
    const { service } = withTemplate();
    expect((await service.preview(5, { ...draft, locale: 'ar' })).html).toContain(
      '<html lang="ar" dir="rtl">',
    );
  });

  it('a missing template is ERP-CORE-0004', async () => {
    const { service } = harness();
    expect((await rejection(service.preview(99, draft))).code).toBe('ERP-CORE-0004');
  });

  it('a template no module defines any more is ERP-CORE-0004', async () => {
    const { service } = withTemplate('gone_key');
    expect((await rejection(service.preview(5, draft))).code).toBe('ERP-CORE-0004');
  });

  it('a 256-character subject is ERP-VALIDATION-0001, before any read', async () => {
    const { service, repo } = withTemplate();
    const error = await rejection(service.preview(5, { ...draft, subject: 'a'.repeat(256) }));
    expect(error.code).toBe('ERP-VALIDATION-0001');
    expect(repo.calls).toEqual([]);
  });
});

/** A definition like the test one whose resolver answers `to` for record '1'. */
function definitionTo(
  key: string,
  to: { readonly email: string; readonly locale: string | null },
): MailTemplateDefinition {
  return {
    ...TEST_DEFINITION,
    key,
    resolve: (sourceRef) =>
      Promise.resolve(sourceRef === '1' ? { to, values: TEST_RESOLVED.values } : null),
  };
}

/** The repository fake holding an active (or inactive) template for `key`. */
function holdTemplate(repo: FakeMailRepository, key: string, active = true): void {
  repo.templates.push(
    templateOf(repo.templates.length + 1, {
      key,
      module: 'zz_tests',
      active,
      formattingDropped: false,
      versions: [{ locale: 'en', subject: 'S', message: 'M' }],
    }),
  );
}

describe('MailService.enqueue (the log row is the outbox, RESEARCH R2)', () => {
  it('inserts one queued row, then adds mail-<id> to mail.send, and answers queued', async () => {
    const { service, repo, registry, queue } = harness();
    registry.register(definitionTo('zz_arabic', { email: 'user@example.test', locale: 'ar' }));
    holdTemplate(repo, 'zz_arabic');

    const outcome = await service.enqueue({ template: 'zz_arabic', sourceRef: '1' });

    expect(outcome).toEqual({ status: 'queued', id: 1 });
    expect(repo.methods()).toEqual(['findTemplateByKey', 'insertSent', 'add']);
    const [row, at] = repo.calls.find((call) => call.method === 'insertSent')?.args ?? [];
    expect(row).toEqual({
      templateKey: 'zz_arabic',
      isTest: false,
      sourceRef: '1',
      recipientEmail: 'user@example.test',
      locale: 'ar',
      status: 'queued',
      failureReason: null,
      maxAttempts: 8,
      dedupeKey: null,
      resentFromId: null,
      requestedByStaffId: null,
      requestId: null,
    });
    expect(Object.keys(row as object)).not.toContain('subject');
    expect(at).toEqual(new Date(NOW_MS));
    expect(RETRY_POLICIES.mailSend.attempts).toBe(8);
    expect(queue.added).toEqual([
      { queue: 'mail.send', name: 'send', data: { sentEmailId: 1 }, options: { jobId: 'mail-1' } },
    ]);
  });

  it('logs mail queued with the id and the key only', async () => {
    const { service, repo, logger } = harness();
    holdTemplate(repo, 'zz_test_notice');
    await service.enqueue({ template: 'zz_test_notice', sourceRef: '1' });
    expect(logger.lines).toContainEqual({
      level: 'log',
      message: 'mail queued',
      meta: { id: 1, template: 'zz_test_notice' },
    });
    expect(JSON.stringify(logger.lines)).not.toContain('@example.test');
  });

  it('a locale the deployment does not support falls back to the default', async () => {
    const { service, repo, registry } = harness();
    registry.register(definitionTo('zz_french', { email: 'user@example.test', locale: 'fr' }));
    holdTemplate(repo, 'zz_french');
    await service.enqueue({ template: 'zz_french', sourceRef: '1' });
    expect(repo.sent[0]?.locale).toBe('en');
  });

  it('an unregistered key answers skipped/not_registered and writes nothing', async () => {
    const { service, repo, queue, logger } = harness();
    expect(await service.enqueue({ template: 'zz_unknown', sourceRef: '1' })).toEqual({
      status: 'skipped',
      reason: 'not_registered',
    });
    expect(repo.methods()).toEqual([]);
    expect(queue.added).toEqual([]);
    expect(logger.lines).toContainEqual({
      level: 'warn',
      message: 'mail send skipped',
      meta: { template: 'zz_unknown', reason: 'not_registered' },
    });
  });

  it('an inactive template answers skipped/template_off with no row (Perfex skips it silently)', async () => {
    const { service, repo, queue } = harness();
    holdTemplate(repo, 'zz_test_notice', false);
    expect(await service.enqueue({ template: 'zz_test_notice', sourceRef: '1' })).toEqual({
      status: 'skipped',
      reason: 'template_off',
    });
    expect(repo.sent).toEqual([]);
    expect(queue.added).toEqual([]);
  });

  it('a resolver answering null answers skipped/record_gone', async () => {
    const { service, repo } = harness();
    holdTemplate(repo, 'zz_test_notice');
    expect(await service.enqueue({ template: 'zz_test_notice', sourceRef: '2' })).toEqual({
      status: 'skipped',
      reason: 'record_gone',
    });
    expect(repo.sent).toEqual([]);
  });

  it('an address that is not one answers skipped/no_recipient', async () => {
    const { service, repo, registry } = harness();
    registry.register(definitionTo('zz_bad', { email: 'not an address', locale: null }));
    holdTemplate(repo, 'zz_bad');
    expect(await service.enqueue({ template: 'zz_bad', sourceRef: '1' })).toEqual({
      status: 'skipped',
      reason: 'no_recipient',
    });
    expect(repo.sent).toEqual([]);
  });

  it('a missing template row is seeded once, then the send proceeds', async () => {
    const { service, repo } = harness();
    expect(await service.enqueue({ template: 'zz_test_notice', sourceRef: '1' })).toEqual({
      status: 'queued',
      id: 1,
    });
    expect(repo.methods().filter((method) => method === 'createTemplate')).toHaveLength(1);
    expect(repo.methods().indexOf('createTemplate')).toBeLessThan(
      repo.methods().indexOf('insertSent'),
    );
  });

  it('the same dedupeKey twice answers queued, then duplicate with the same id, and adds once', async () => {
    const { service, repo, queue } = harness();
    holdTemplate(repo, 'zz_test_notice');
    const request = {
      template: 'zz_test_notice',
      sourceRef: '1',
      dedupeKey: 'zz_tests.notice:1:2026-10-03',
    };
    expect(await service.enqueue(request)).toEqual({ status: 'queued', id: 1 });
    expect(await service.enqueue(request)).toEqual({ status: 'duplicate', id: 1 });
    expect(queue.added).toHaveLength(1);
    expect(repo.sent).toHaveLength(1);
  });

  it('mail not configured: one failed row with reason not_configured, no job', async () => {
    const { service, repo, email, queue } = harness();
    email.configured = false;
    holdTemplate(repo, 'zz_test_notice');
    expect(await service.enqueue({ template: 'zz_test_notice', sourceRef: '1' })).toEqual({
      status: 'not_configured',
      id: 1,
    });
    expect(repo.sent).toHaveLength(1);
    expect(repo.sent[0]).toMatchObject({ status: 'failed', failureReason: 'not_configured' });
    expect(queue.added).toEqual([]);
  });
});

/** The repository fake holding template 1 (`zz_test_notice`, the registered definition). */
function withNotice(state?: MailStateStore): Harness {
  const h = harness(state);
  h.repo.templates.push(
    templateOf(1, {
      key: 'zz_test_notice',
      module: 'zz_tests',
      active: true,
      formattingDropped: false,
      versions: [{ locale: 'en', subject: 'Hi {staff_name}', message: 'See {link}' }],
    }),
  );
  return h;
}

const DRAFT = { locale: 'en', subject: 'Hi {staff_name}', message: 'See {link}' };
const SAVE = { active: false, versions: { en: { subject: 'New', message: 'Body {link}' } } };

describe('MailService.saveTemplate (ADR-0040, T-4.3-15)', () => {
  it('a stale fingerprint is 412 ERP-CORE-0013 and the template is untouched', async () => {
    const { service, repo } = withNotice();
    const before = repo.templates[0];
    const error = await rejection(service.saveTemplate(EDITOR, { id: '1' }, SAVE, '"stale"'));
    expect(error.code).toBe('ERP-CORE-0013');
    expect(repo.templates[0]).toBe(before);
  });

  it('the fingerprint the detail answered saves Active and the versions, stamped with the editor', async () => {
    const { service, repo } = withNotice();
    const { etag } = await service.getTemplate(EDITOR, { id: '1' });
    const saved = await service.saveTemplate(EDITOR, { id: '1' }, SAVE, etag);
    expect(saved.active).toBe(false);
    expect(saved.versions).toEqual({ en: SAVE.versions.en });
    expect(saved.etag).not.toBe(etag);
    expect(repo.templates[0]?.updatedByStaffId).toBe(3);
  });

  it('a missing template is 404; a key no module defines is 409 ERP-MAIL-0004', async () => {
    const { service, repo } = withNotice();
    expect((await rejection(service.saveTemplate(EDITOR, { id: '9' }, SAVE, '"x"'))).code).toBe(
      'ERP-CORE-0004',
    );
    repo.templates.push(
      templateOf(2, {
        key: 'gone_key',
        module: 'zz',
        active: true,
        formattingDropped: false,
        versions: [],
      }),
    );
    expect((await rejection(service.saveTemplate(EDITOR, { id: '2' }, SAVE, '"x"'))).code).toBe(
      'ERP-MAIL-0004',
    );
  });
});

describe('MailService.sendTemplateTest (D-04, D-10)', () => {
  it('queues a test row to the caller and the job with the draft; answers its id as a string', async () => {
    const { service, repo, queue } = withNotice();
    expect(await service.sendTemplateTest(EDITOR, { id: '1' }, DRAFT)).toEqual({ id: '1' });
    expect(repo.sent[0]).toMatchObject({
      isTest: true,
      recipientEmail: 'edit@example.test',
      requestedByStaffId: 3,
      sourceRef: null,
    });
    expect(queue.added[0]?.data).toEqual({
      sentEmailId: 1,
      draft: { subject: DRAFT.subject, message: DRAFT.message },
    });
  });

  it('the sixth in the window is 429 with retryAfterS the window remainder rounded up', async () => {
    let now = NOW_MS;
    const { service, repo } = withNotice(new InMemoryMailStateStore(() => now, 600_000));
    for (let i = 0; i < 5; i += 1) await service.sendTemplateTest(EDITOR, { id: '1' }, DRAFT);
    now += 1_500;
    const error = await rejection(service.sendTemplateTest(EDITOR, { id: '1' }, DRAFT));
    expect(error.code).toBe('ERP-MAIL-0007');
    expect(error.extras?.retryAfterS).toBe(599);
    expect(repo.sent).toHaveLength(5);
  });

  it('retryAfterS is at least 1 when the window has just run out', async () => {
    const spent = new InMemoryMailStateStore();
    spent.countTest = () => Promise.resolve({ count: 6, retryAfterMs: 0 });
    const { service } = withNotice(spent);
    const error = await rejection(service.sendTemplateTest(EDITOR, { id: '1' }, DRAFT));
    expect(error.extras?.retryAfterS).toBe(1);
  });

  it('a lost add marks the row failed and answers 503 ERP-UPSTREAM-0001', async () => {
    const { service, repo, queue } = withNotice();
    queue.failWith = new Error('redis down');
    const error = await rejection(service.sendTemplateTest(EDITOR, { id: '1' }, DRAFT));
    expect(error.code).toBe('ERP-UPSTREAM-0001');
    expect(repo.sent[0]).toMatchObject({ status: 'failed', failureReason: 'unknown' });
  });

  it('not configured is 409 ERP-MAIL-0002 before any count or row', async () => {
    const { service, repo, email } = withNotice();
    email.configured = false;
    const error = await rejection(service.sendTemplateTest(EDITOR, { id: '1' }, DRAFT));
    expect(error.code).toBe('ERP-MAIL-0002');
    expect(repo.sent).toHaveLength(0);
  });

  it('a caller with no contact is 404', async () => {
    const { service } = withNotice();
    const error = await rejection(service.sendTemplateTest(actorOf(42), { id: '1' }, DRAFT));
    expect(error.code).toBe('ERP-CORE-0004');
  });
});

describe('MailService.getTest (T-4.3-13)', () => {
  it('answers the caller her own test only; another member, a non-test row and a missing id are 404', async () => {
    const { service, repo } = withNotice();
    await service.sendTemplateTest(EDITOR, { id: '1' }, DRAFT);
    expect(await service.getTest(EDITOR, { id: '1' })).toMatchObject({ id: '1', status: 'queued' });
    expect((await rejection(service.getTest(ADMIN, { id: '1' }))).code).toBe('ERP-CORE-0004');
    const first = repo.sent[0];
    if (first === undefined) throw new Error('expected the test row');
    repo.sent.push({ ...first, id: 2, isTest: false });
    expect((await rejection(service.getTest(EDITOR, { id: '2' }))).code).toBe('ERP-CORE-0004');
    expect((await rejection(service.getTest(EDITOR, { id: '7' }))).code).toBe('ERP-CORE-0004');
  });
});

describe('MailService administrator use cases (D-05, D-02, T-4.3-30)', () => {
  it.each(['listSentEmails', 'getSentEmail', 'resend', 'getStatus', 'sendStatusTest'] as const)(
    '%s refuses a member without the flag with ERP-AUTH-0005 before reading anything',
    async (method) => {
      const { service, repo } = withNotice();
      const call = service[method].bind(service) as (
        actor: AuthenticatedUser,
        input: unknown,
      ) => Promise<unknown>;
      const error = await rejection(call(EDITOR, { id: '1' }));
      expect(error.code).toBe('ERP-AUTH-0005');
      expect(repo.calls).toEqual([]);
    },
  );

  it('a resend whose job cannot be added marks the new row failed and answers 503; the original is untouched', async () => {
    const { service, repo, queue } = withNotice();
    const original = {
      id: 1,
      templateKey: 'zz_test_notice',
      isTest: false,
      sourceRef: '1',
      recipientEmail: 'staff@example.test',
      locale: 'en',
      status: 'failed' as const,
      attempts: 8,
      maxAttempts: 8,
      nextTryAt: null,
      failureReason: 'timeout' as const,
      serverReply: null,
      dedupeKey: null,
      resentFromId: null,
      requestedByStaffId: null,
      requestId: null,
      queuedAt: new Date(NOW_MS),
      sentAt: null,
      updatedAt: new Date(NOW_MS),
    };
    repo.sent.push(original);
    queue.failWith = new Error('redis down');
    const error = await rejection(service.resend(ADMIN, { id: '1' }));
    expect(error.code).toBe('ERP-UPSTREAM-0001');
    expect(repo.sent[1]).toMatchObject({
      resentFromId: 1,
      status: 'failed',
      failureReason: 'unknown',
    });
    expect(repo.sent[0]).toBe(original);
  });

  it('the status test locale falls back to the default when the contact has none', async () => {
    const { service, repo } = withNotice();
    await service.sendStatusTest(ADMIN);
    expect(repo.sent[0]).toMatchObject({ templateKey: null, isTest: true, locale: 'en' });
  });
});
