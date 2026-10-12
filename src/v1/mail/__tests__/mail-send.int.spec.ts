/**
 * The mail sender on the wire (ADR-0049 decision 10, B4, B5): `MailModule` with the shared modules
 * it needs (`AppModule`'s, without uploads), the real SMTP adapter and a running queue worker
 * against the local stack (`api.host.env`: MySQL, Redis, Mailpit on 127.0.0.1:11025 and :18025).
 * Skips only when MAILPIT_API_URL is absent.
 *
 * - Queues on Redis db 3, not db 2 (the AppConfig stub sets QUEUE_REDIS_DB), so the stack's worker
 *   never takes a spec job; `afterAll` obliterates the spec's queues and proves no `bull:mail.*`
 *   key is left on db 3.
 * - `MailSendProcessor` is a spec subclass whose `retryPolicy` waits 300 ms doubling to 1 s; the
 *   breaker's half-open delay (and so the deferral) is the host env's.
 * - The sweep and purge processors are not started (their schedules would act on the whole log);
 *   the sweep case runs a sweep processor's `handle` itself.
 * - Each case starts on an empty Mailpit with chaos off and ends the same way. Every row it writes
 *   has the run's own template key `zz_wire_<run>` and is deleted after the run with the template.
 *   The recipient is the synthetic staff@example.test of `TEST_DEFINITION`.
 * - `STORAGE` is the real `VolumeStorage` over a scratch directory of the OS temp folder (ADR-0052):
 *   the attachment case stores one made-up text file there, and the directory is removed after the
 *   run. The definition answers no attachment in every other case.
 */
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Global, Module, type DynamicModule, type OnModuleInit } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IntegrationsModule } from '../../../integrations/integrations.module.js';
import { CacheModule } from '../../../shared/cache/cache.module.js';
import { AppConfig } from '../../../shared/config/app-config.js';
import { ConfigModule } from '../../../shared/config/config.module.js';
import { RETRY_POLICIES, type RetryPolicy } from '../../../shared/config/retry-policies.js';
import { DbModule } from '../../../shared/db/db.module.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { EventsModule } from '../../../shared/events/events.module.js';
import { HealthModule } from '../../../shared/health/health.module.js';
import { ACCESS_TOKEN_VERIFIER } from '../../../shared/http/auth/access-token-verifier.js';
import { IdempotencyModule } from '../../../shared/http/interceptors/idempotency.module.js';
import { LoggerModule } from '../../../shared/logger/logger.module.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { producerConnection, queueRedisUrl } from '../../../shared/queue/queue-connection.js';
import { QueueModule } from '../../../shared/queue/queue.module.js';
import {
  DEAD_LETTER_SUFFIX,
  QUEUE_PREFIX,
  QueueService,
} from '../../../shared/queue/queue.service.js';
import { BreakerRegistry } from '../../../shared/resilience/breaker.js';
import { ResilienceModule } from '../../../shared/resilience/resilience.module.js';
import { StorageModule } from '../../../shared/storage/storage.module.js';
import { newStorageKey, STORAGE } from '../../../shared/storage/storage.port.js';
import { VolumeStorage } from '../../../shared/storage/volume.storage.js';
import { IdentityModule } from '../../identity/identity.module.js';
import { IdentityFacade } from '../../identity/index.js';
import { MailFacade } from '../facade/mail.facade.js';
import { MailPurgeProcessor } from '../jobs/mail-purge.processor.js';
import { MAIL_SEND_QUEUE, mailJobId } from '../jobs/mail-send.job.js';
import { MailSendProcessor } from '../jobs/mail-send.processor.js';
import { MailSweepProcessor } from '../jobs/mail-sweep.processor.js';
import { MailModule } from '../mail.module.js';
import type { SentEmail } from '../model/mail.model.js';
import { MAIL_STATE_STORE, type MailStateStore } from '../repository/mail-state.store.js';
import { MailRepository } from '../repository/mail.repository.js';
import type { MailAttachment } from '../service/mail-template.registry.js';
import {
  definitionWithAttachments,
  identityFacadeOf,
  RecordingLogger,
  TEST_RESOLVED,
} from './fakes.js';

const MAILPIT_API_URL = process.env.MAILPIT_API_URL;
const SPEC_QUEUE_DB = 3;
const RUN = randomUUID().slice(0, 8);
const KEY = `zz_wire_${RUN}`;
/** What the definition attaches: empty but in the attachment case (ADR-0052). */
const ATTACHED: MailAttachment[] = [];
const DEFINITION = definitionWithAttachments(ATTACHED, KEY);
/** The made-up file of the attachment case. */
const FILE_TEXT = 'A made-up file for the attachment wire case.\n';
const ADDRESS = TEST_RESOLVED.to.email;
const POLL_MS = 25;
const WAIT_MS = 15_000;
const REQUEST_TIMEOUT_MS = 5_000;
const TEN_MINUTES_MS = 600_000;
const SPEC_QUEUES = [MAIL_SEND_QUEUE, `${MAIL_SEND_QUEUE}${DEAD_LETTER_SUFFIX}`];

/** `mail.send` with a short backoff, so a retry is seen in under a second. */
class FastMailSendProcessor extends MailSendProcessor {
  override readonly retryPolicy: RetryPolicy = {
    ...RETRY_POLICIES.mailSend,
    baseDelayMs: 300,
    maxDelayMs: 1_000,
  };
}

/** Registers the spec's definition from `onModuleInit`, as a sending module does (Pitfall 12). */
@Module({ imports: [MailModule] })
class SpecSenderModule implements OnModuleInit {
  constructor(private readonly mail: MailFacade) {}

  onModuleInit(): void {
    this.mail.register(DEFINITION);
  }
}

/**
 * The verifier `MailController`'s guards resolve at boot (AuthModule gives it in the app); this spec
 * sends no HTTP request, so it admits nobody.
 */
@Global()
@Module({
  providers: [
    {
      provide: ACCESS_TOKEN_VERIFIER,
      useValue: {
        verifyAccessToken: () => Promise.resolve(null),
        hasPermission: () => Promise.resolve(false),
      },
    },
  ],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class NoVerifierModule {}

/** `IdentityModule` without its own dependencies: the send path never reads a member. */
function StubIdentityModule(): DynamicModule {
  @Module({
    providers: [{ provide: IdentityFacade, useValue: identityFacadeOf() }],
    exports: [IdentityFacade],
  })
  class StubIdentityModuleClass {}
  return { module: StubIdentityModuleClass };
}

/** The few Mailpit REST calls this spec needs (`../../../integrations` helpers are adapter-side). */
function mailpit(baseUrl: string) {
  async function call(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`mailpit ${path} answered ${String(response.status)}`);
    return response;
  }
  const chaos = (triggers: object) =>
    call('/api/v1/chaos', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(triggers),
    });
  return {
    clear: () => call('/api/v1/messages', { method: 'DELETE' }),
    chaos,
    chaosOff: () => chaos({}),
    async total(): Promise<number> {
      return ((await (await call('/api/v1/messages')).json()) as { total: number }).total;
    },
    /** The Mailpit ids of the messages whose Message-ID is `messageId`. */
    async idsOf(messageId: string): Promise<string[]> {
      const list = (await (await call('/api/v1/messages?limit=200')).json()) as {
        messages: { ID: string; MessageID: string }[];
      };
      const bare = messageId.replace(/^</, '').replace(/>$/, '');
      return list.messages.filter((m) => m.MessageID === bare).map((m) => m.ID);
    },
    async message(id: string): Promise<{
      HTML: string;
      Text: string;
      Attachments: { PartID: string; FileName: string; ContentType: string; Size: number }[];
    }> {
      return (await (await call(`/api/v1/message/${id}`)).json()) as {
        HTML: string;
        Text: string;
        Attachments: { PartID: string; FileName: string; ContentType: string; Size: number }[];
      };
    },
    /** The bytes of one MIME part of a message (an attachment). */
    async part(id: string, partId: string): Promise<Buffer> {
      return Buffer.from(await (await call(`/api/v1/message/${id}/part/${partId}`)).arrayBuffer());
    },
  };
}

async function waitFor(
  check: () => Promise<boolean> | boolean,
  timeoutMs = WAIT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${String(timeoutMs)} ms`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

describe.skipIf(!MAILPIT_API_URL)('the mail sender against the local Mailpit (B4, B5)', () => {
  const box = mailpit(MAILPIT_API_URL ?? 'http://127.0.0.1:18025');
  const real = new AppConfig();
  const config = { env: { ...real.env, QUEUE_REDIS_DB: SPEC_QUEUE_DB } };
  const logger = new RecordingLogger();
  const connection = producerConnection(config.env);
  const inspectors = new Map<string, Queue>();
  let moduleRef: TestingModule;
  let facade: MailFacade;
  let repository: MailRepository;
  let state: MailStateStore;
  let scratch: string;
  let volume: VolumeStorage;

  function inspect(name: string): Queue {
    let queue = inspectors.get(name);
    if (queue === undefined) {
      if (connection === null) throw new Error('REDIS_URL is not set');
      queue = new Queue(name, { connection, prefix: QUEUE_PREFIX });
      inspectors.set(name, queue);
    }
    return queue;
  }

  const rowOf = async (id: number): Promise<SentEmail | null> => repository.findSent(id);
  const statusIs = (id: number, status: SentEmail['status']) => async () =>
    (await rowOf(id))?.status === status;
  const messageIdOf = (id: number) => `<mail-${String(id)}@localhost>`;

  async function queued(): Promise<number> {
    const outcome = await facade.send({ template: KEY, sourceRef: '1' });
    if (outcome.status !== 'queued') throw new Error(`send answered ${outcome.status}`);
    return outcome.id;
  }

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'erp-mail-int-'));
    volume = new VolumeStorage(scratch);
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule,
        LoggerModule,
        EventsModule,
        HealthModule,
        ResilienceModule,
        DbModule,
        CacheModule,
        IdempotencyModule,
        StorageModule,
        NoVerifierModule,
        QueueModule.forRoot({ runWorkers: true }),
        IntegrationsModule,
        SpecSenderModule,
      ],
    })
      .overrideProvider(AppConfig)
      .useValue(config)
      .overrideProvider(LoggerService)
      .useValue(logger)
      .overrideProvider(STORAGE)
      .useValue(volume)
      .overrideModule(IdentityModule)
      .useModule(StubIdentityModule())
      .overrideProvider(MailSendProcessor)
      .useClass(FastMailSendProcessor)
      .overrideProvider(MailSweepProcessor)
      .useValue({})
      .overrideProvider(MailPurgeProcessor)
      .useValue({})
      .compile();
    await moduleRef.init();
    facade = moduleRef.get(MailFacade);
    repository = moduleRef.get(MailRepository);
    state = moduleRef.get<MailStateStore>(MAIL_STATE_STORE);
    expect(moduleRef.get(QueueService).registeredQueues()).toEqual([MAIL_SEND_QUEUE]);
  });

  beforeEach(async () => {
    await box.chaosOff();
    await box.clear();
  });

  afterEach(async () => {
    moduleRef.get(BreakerRegistry).get('email').forceClose();
    await box.chaosOff();
    await box.clear();
  });

  afterAll(async () => {
    const raw = new Redis(queueRedisUrl(real.env.REDIS_URL ?? '', SPEC_QUEUE_DB), {
      db: SPEC_QUEUE_DB,
    });
    try {
      await box.chaosOff();
      await box.clear();
      await state.clearServerUnreachable();
      const prisma = moduleRef.get(PrismaService);
      await prisma.client.tblmail_sent_emails.deleteMany({ where: { template_key: KEY } });
      await prisma.client.tblmail_templates.deleteMany({ where: { template_key: KEY } });
      expect(await repository.findTemplateByKey(KEY)).toBeNull();
    } finally {
      await moduleRef.close();
      for (const name of SPEC_QUEUES) await inspect(name).obliterate({ force: true });
      for (const queue of inspectors.values()) await queue.close();
      const left = await raw.keys(`${QUEUE_PREFIX}:mail.*`);
      await raw.quit();
      expect(left, 'no bull:mail.* key may be left on db 3').toEqual([]);
      expect(await box.total()).toBe(0);
      await rm(scratch, { recursive: true, force: true });
    }
  });

  it('sends through MailFacade: Mailpit receives the Message-ID with an HTML and a text part; the row turns sent', async () => {
    const id = await queued();
    await waitFor(statusIs(id, 'sent'));
    const ids = await box.idsOf(messageIdOf(id));
    expect(ids).toHaveLength(1);
    const message = await box.message(ids[0] ?? '');
    expect(message.HTML).toContain('<html');
    expect(message.Text).toContain('If you can read it, the new system can send email.');
    expect(await rowOf(id)).toMatchObject({ status: 'sent', attempts: 1, recipientEmail: ADDRESS });
  });

  it('carries one attachment from Node storage: Mailpit receives it intact by name, type and size; the stored file stays (ADR-0052)', async () => {
    const storageKey = newStorageKey('zz-mail-int');
    const bytes = Buffer.from(FILE_TEXT, 'utf8');
    try {
      await volume.putStream(storageKey, Readable.from([bytes]));
      ATTACHED.push({ storageKey, fileName: 'made-up-notes.txt', contentType: 'text/plain' });
      const id = await queued();
      await waitFor(statusIs(id, 'sent'));
      const ids = await box.idsOf(messageIdOf(id));
      expect(ids).toHaveLength(1);
      const message = await box.message(ids[0] ?? '');
      expect(message.Attachments).toHaveLength(1);
      const [attachment] = message.Attachments;
      expect(attachment).toMatchObject({
        FileName: 'made-up-notes.txt',
        ContentType: 'text/plain',
        Size: bytes.length,
      });
      expect(await box.part(ids[0] ?? '', attachment?.PartID ?? '')).toEqual(bytes);
      expect(await volume.stat(storageKey)).toEqual({ key: storageKey, size: bytes.length });
      expect(JSON.stringify(logger.lines)).not.toContain('made-up-notes');
    } finally {
      ATTACHED.length = 0;
      await volume.delete(storageKey);
    }
  });

  it('a Recipient 451 retries (retrying with a next try), then sends once chaos is off', async () => {
    await box.chaos({ Recipient: { ErrorCode: 451, Probability: 100 } });
    const id = await queued();
    await waitFor(statusIs(id, 'retrying'));
    const retrying = await rowOf(id);
    expect(retrying?.nextTryAt).not.toBeNull();
    expect(retrying?.failureReason).toBe('recipient_refused');
    await box.chaosOff();
    await waitFor(statusIs(id, 'sent'));
    expect((await rowOf(id))?.attempts).toBeGreaterThanOrEqual(2);
    expect(await box.idsOf(messageIdOf(id))).toHaveLength(1);
  });

  it('a Recipient 550 fails at once into mail.send.dlq with a code for a reason, never an address', async () => {
    await box.chaos({ Recipient: { ErrorCode: 550, Probability: 100 } });
    const id = await queued();
    await waitFor(statusIs(id, 'failed'));
    expect(await rowOf(id)).toMatchObject({
      status: 'failed',
      attempts: 1,
      failureReason: 'recipient_refused',
    });
    const dlq = inspect(`${MAIL_SEND_QUEUE}${DEAD_LETTER_SUFFIX}`);
    let letter: unknown;
    await waitFor(async () => {
      const jobs = await dlq.getJobs(['waiting']);
      letter = jobs
        .map((job) => job.data as { jobId: string })
        .find((d) => d.jobId === mailJobId(id));
      return letter !== undefined;
    });
    expect(letter).toMatchObject({ jobId: mailJobId(id), reason: 'NonRetryableJobError' });
    expect(JSON.stringify(letter)).not.toContain('example.test');
    expect(JSON.stringify(logger.lines)).not.toContain(ADDRESS);
  });

  it('the open email breaker defers: the row stays queued, the job delayed with attemptsMade 0, the server marked; closed, it sends', async () => {
    const breaker = moduleRef.get(BreakerRegistry).get('email');
    breaker.forceOpen();
    const id = await queued();
    const send = inspect(MAIL_SEND_QUEUE);
    await waitFor(async () => (await (await send.getJob(mailJobId(id)))?.getState()) === 'delayed');
    expect((await send.getJob(mailJobId(id)))?.attemptsMade).toBe(0);
    expect(await rowOf(id)).toMatchObject({ status: 'queued', attempts: 0 });
    expect(await state.serverUnreachableSince()).not.toBeNull();

    breaker.forceClose();
    await waitFor(statusIs(id, 'sent'));
    expect((await rowOf(id))?.attempts).toBe(1);
    expect(await state.serverUnreachableSince()).toBeNull();
    expect(await box.idsOf(messageIdOf(id))).toHaveLength(1);
  });

  it('the sweep re-adds a row queued ten minutes ago without a job, twice, and it is sent once', async () => {
    const { row } = await repository.insertSent(
      {
        templateKey: KEY,
        isTest: false,
        sourceRef: '1',
        recipientEmail: ADDRESS,
        locale: 'en',
        status: 'queued',
        failureReason: null,
        maxAttempts: RETRY_POLICIES.mailSend.attempts,
        dedupeKey: null,
        resentFromId: null,
        requestedByStaffId: null,
        requestId: null,
      },
      new Date(Date.now() - TEN_MINUTES_MS),
    );
    const sweep = new MailSweepProcessor(
      { registerProcessor: () => undefined },
      repository,
      moduleRef.get(QueueService),
      logger,
    );
    await sweep.handle();
    await sweep.handle();
    expect((await inspect(MAIL_SEND_QUEUE).getJob(mailJobId(row.id)))?.id).toBe(mailJobId(row.id));
    await waitFor(statusIs(row.id, 'sent'));
    expect((await rowOf(row.id))?.attempts).toBe(1);
    expect(await box.idsOf(messageIdOf(row.id))).toHaveLength(1);
  });
});
