/**
 * `MailModule` inside a real Nest + Fastify application, without a network: the repository is
 * `FakeMailRepository`, `MAIL_STATE_STORE` is `InMemoryMailStateStore`, `EMAIL_PROVIDER` is the
 * port fake (never the adapter, PATTERNS M4) from a global stub module in the position
 * `IntegrationsModule` holds in the app, `AppConfig` is a stub carrying `PUBLIC_BASE_URL`, the logger
 * records its lines, and `BrandingModule` is replaced whole (`overrideModule`, the auth test app's
 * form) by a module whose `BrandingFacade` answers `TEST_BRANDING`, so no `PrismaService` is built;
 * `IdentityModule` the same way by a module whose `IdentityFacade` answers `contacts`. The global
 * stub also provides `QueueService` and `ProcessorRegistry` as one `FakeQueueService` (the
 * `QueueModule.forRoot` position), so the processors register and the service enqueues without Redis.
 * The module wiring, the global prefix and the problem-details filter are the production code path.
 *
 * Plan 04.3-07 adds the HTTP surface: the access-token verifier is a stub with four bearers (an
 * administrator, a member holding `settings.emailTemplates.view`, one holding view and edit, one
 * holding nothing), each with a synthetic contact address; `IdempotencyModule` is the production
 * module over `InMemoryIdempotencyStore`; the `AppConfig` stub carries a configured SMTP setup whose
 * user name and password are stand-ins the status spec searches every answer for (T-4.3-06).
 */
import { Global, Module, type DynamicModule } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { PERMISSION_CODES, PERMISSIONS } from '@erp/contracts';
import { EMAIL_PROVIDER } from '../../../integrations/ports/email-provider.port.js';
import { AppConfig } from '../../../shared/config/app-config.js';
import { ConfigModule } from '../../../shared/config/config.module.js';
import { ProcessorRegistry } from '../../../shared/queue/base.processor.js';
import { QueueService } from '../../../shared/queue/queue.service.js';
import { InMemoryStorage } from '../../../shared/storage/__tests__/in-memory.storage.js';
import { STORAGE } from '../../../shared/storage/storage.port.js';
import { ProblemDetailsFilter } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
  type AuthenticatedUser,
} from '../../../shared/http/auth/access-token-verifier.js';
import { IdempotencyModule } from '../../../shared/http/interceptors/idempotency.module.js';
import {
  IDEMPOTENCY_STORE,
  InMemoryIdempotencyStore,
} from '../../../shared/http/interceptors/idempotency.store.js';
import { registerRequestId } from '../../../shared/http/request-id.js';
import { LoggerModule } from '../../../shared/logger/logger.module.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { BrandingModule } from '../../branding/branding.module.js';
import { BrandingFacade } from '../../branding/index.js';
import { IdentityModule } from '../../identity/identity.module.js';
import { IdentityFacade, type StaffContact } from '../../identity/index.js';
import { MailModule } from '../mail.module.js';
import { MAIL_STATE_STORE } from '../repository/mail-state.store.js';
import { MailRepository } from '../repository/mail.repository.js';
import {
  brandingFacadeOf,
  FakeEmailProvider,
  FakeMailRepository,
  FakeQueueService,
  identityFacadeOf,
  InMemoryMailStateStore,
  RecordingLogger,
  TEST_PUBLIC_BASE_URL,
} from './fakes.js';

/** The bearers the stub verifier accepts; anything else is `null`, so 401 `ERP-AUTH-0004`. */
export const TEST_BEARERS = {
  /** Staff 1: the administrator flag (and so every code). */
  admin: 'valid-admin',
  /** Staff 2: `settings.emailTemplates.view` only. */
  templatesView: 'valid-templates-view',
  /** Staff 3: `settings.emailTemplates.view` and `.edit`. */
  templatesEdit: 'valid-templates-edit',
  /** Staff 4: signed in, no code. */
  noCode: 'valid-nocode',
} as const;

export const TEST_STAFF = { admin: 1, templatesView: 2, templatesEdit: 3, noCode: 4 } as const;

/** Each bearer's own address (synthetic): where that member's test sends go. */
export const TEST_CONTACTS: ReadonlyMap<number, StaffContact> = new Map([
  [TEST_STAFF.admin, { email: 'admin@example.test', locale: 'ar', active: true }],
  [TEST_STAFF.templatesView, { email: 'view@example.test', locale: null, active: true }],
  [TEST_STAFF.templatesEdit, { email: 'edit@example.test', locale: null, active: true }],
  [TEST_STAFF.noCode, { email: 'nocode@example.test', locale: null, active: true }],
]);

/** The SMTP setup of the AppConfig stub; the user name and password must never reach an answer. */
export const TEST_SMTP = {
  SMTP_HOST: 'smtp.example.test',
  SMTP_PORT: 587,
  SMTP_ENCRYPTION: 'tls',
  SMTP_USERNAME: 'smtp-user-zz',
  SMTP_PASSWORD: 'pw-not-a-secret',
  MAIL_FROM_ADDRESS: 'no-reply@example.test',
  MAIL_FROM_NAME: 'Company One',
} as const;

const FAR_FUTURE_EXPIRY_S = 4_102_444_800; // 2100-01-01T00:00:00Z

function userOf(staffId: number): AuthenticatedUser {
  return {
    staffId,
    sessionId: `sid-${String(staffId)}`,
    jti: `jti-${String(staffId)}`,
    isAdmin: staffId === TEST_STAFF.admin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: FAR_FUTURE_EXPIRY_S,
  };
}

const USERS: Readonly<Record<string, AuthenticatedUser>> = {
  [TEST_BEARERS.admin]: userOf(TEST_STAFF.admin),
  [TEST_BEARERS.templatesView]: userOf(TEST_STAFF.templatesView),
  [TEST_BEARERS.templatesEdit]: userOf(TEST_STAFF.templatesEdit),
  [TEST_BEARERS.noCode]: userOf(TEST_STAFF.noCode),
};

const TEMPLATE_CODES = PERMISSIONS.settings.emailTemplates;
const CODES: Readonly<Record<number, readonly string[]>> = {
  [TEST_STAFF.admin]: PERMISSION_CODES,
  [TEST_STAFF.templatesView]: [TEMPLATE_CODES.view],
  [TEST_STAFF.templatesEdit]: [TEMPLATE_CODES.view, TEMPLATE_CODES.edit],
};

/** Four bearers; no cryptography (the real verifier is `v1/auth`'s facade). */
class StubAccessTokenVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    return Promise.resolve(USERS[token] ?? null);
  }

  hasPermission(staffId: number, code: string): Promise<boolean> {
    return Promise.resolve((CODES[staffId] ?? []).includes(code));
  }
}

@Global()
@Module({
  providers: [{ provide: ACCESS_TOKEN_VERIFIER, useValue: new StubAccessTokenVerifier() }],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class StubVerifierModule {}

@Module({})
class StubIntegrationsModule {}

/** The global ports of one test app: the email port fake, the queue fake and an empty in-memory `STORAGE` (fresh per app). */
function StubGlobalsModule(email: FakeEmailProvider, queue: FakeQueueService): DynamicModule {
  return {
    module: StubIntegrationsModule,
    global: true,
    providers: [
      { provide: EMAIL_PROVIDER, useValue: email },
      { provide: QueueService, useValue: queue },
      { provide: ProcessorRegistry, useValue: queue },
      { provide: STORAGE, useValue: new InMemoryStorage() },
    ],
    exports: [EMAIL_PROVIDER, QueueService, ProcessorRegistry, STORAGE],
  };
}

/** `BrandingModule` without its repository: the real facade over a stub service. */
function StubBrandingModule(): DynamicModule {
  @Module({
    providers: [{ provide: BrandingFacade, useValue: brandingFacadeOf() }],
    exports: [BrandingFacade],
  })
  class StubBrandingModuleClass {}
  return { module: StubBrandingModuleClass };
}

/** `IdentityModule` without its repository: a stub facade answering `contactOf` from `contacts`. */
function StubIdentityModule(contacts: ReadonlyMap<number, StaffContact>): DynamicModule {
  @Module({
    providers: [{ provide: IdentityFacade, useValue: identityFacadeOf(contacts) }],
    exports: [IdentityFacade],
  })
  class StubIdentityModuleClass {}
  return { module: StubIdentityModuleClass };
}

/** Keeps the test output readable: no JSON log lines from the container. */
class SilentLogger extends LoggerService {
  override log(): void {
    /* silent */
  }
  override warn(): void {
    /* silent */
  }
  override error(): void {
    /* silent */
  }
  override debug(): void {
    /* silent */
  }
}

export interface MailTestApp {
  readonly app: NestFastifyApplication;
  readonly moduleRef: TestingModule;
  readonly repo: FakeMailRepository;
  readonly email: FakeEmailProvider;
  readonly queue: FakeQueueService;
  readonly state: InMemoryMailStateStore;
  readonly logger: RecordingLogger;
  readonly idempotency: InMemoryIdempotencyStore;
  close(): Promise<void>;
}

export async function createMailTestApp(
  contacts: ReadonlyMap<number, StaffContact> = TEST_CONTACTS,
): Promise<MailTestApp> {
  const repo = new FakeMailRepository();
  const email = new FakeEmailProvider();
  const queue = new FakeQueueService(repo.calls);
  const state = new InMemoryMailStateStore();
  const logger = new RecordingLogger();
  const idempotency = new InMemoryIdempotencyStore();
  const config = { env: { NODE_ENV: 'test', PUBLIC_BASE_URL: TEST_PUBLIC_BASE_URL, ...TEST_SMTP } };
  const moduleRef = await Test.createTestingModule({
    imports: [
      StubGlobalsModule(email, queue),
      StubVerifierModule,
      IdempotencyModule,
      ConfigModule,
      LoggerModule,
      MailModule,
    ],
  })
    .overrideProvider(AppConfig)
    .useValue(config)
    .overrideProvider(LoggerService)
    .useValue(logger)
    .overrideModule(BrandingModule)
    .useModule(StubBrandingModule())
    .overrideModule(IdentityModule)
    .useModule(StubIdentityModule(contacts))
    .overrideProvider(MailRepository)
    .useValue(repo)
    .overrideProvider(MAIL_STATE_STORE)
    .useValue(state)
    .overrideProvider(IDEMPOTENCY_STORE)
    .useValue(idempotency)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  registerRequestId(app);
  app.setGlobalPrefix(API_PREFIX, { exclude: [...UNPREFIXED_ROUTES] });
  app.useGlobalFilters(new ProblemDetailsFilter(new SilentLogger()));
  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    moduleRef,
    repo,
    email,
    queue,
    state,
    logger,
    idempotency,
    close: () => app.close(),
  };
}
