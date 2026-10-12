/**
 * The module inside a real Nest + Fastify application, without a network: the repository is the
 * module's own in-memory store seeded with `SEED_ITEMS`, the access-token verifier is a stub with
 * five known bearers, the domain-event publisher is the recording one (so a spec can assert the
 * events), and everything else — the module wiring, the guards, the request-id hook, the global
 * prefix, the problem-details filter — is the production code path, so `app.inject` proves the
 * HTTP contract `main.ts` serves.
 *
 * In erp-api the global `AuthModule` provides `ACCESS_TOKEN_VERIFIER`; here a global stub module
 * does, in the same position, so the guards resolve it exactly as they will in production.
 *
 * The global `ConfigModule` provides `AppConfig` and `ModuleSwitch` in erp-api; here a stub does,
 * from `options.disabledModules` (`MODULES_DISABLED`, ADR-0042). A module that can be switched off
 * puts `@ModuleKey('<m>')` and `@UseGuards(ModuleEnabledGuard)` on its controller class and proves
 * the 403 with `createExampleItemTestApp({ disabledModules: ['<m>'] })` (Phase 4.2 M6).
 */
import { Global, Module } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfig } from '../../../shared/config/app-config.js';
import { ModuleSwitch, type ModuleName } from '../../../shared/config/modules.js';
import { ProblemDetailsFilter } from '../../../shared/errors/problem-details.filter.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  RecordingDomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { EventsModule } from '../../../shared/events/events.module.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
  type AuthenticatedUser,
} from '../../../shared/http/auth/access-token-verifier.js';
import { registerRequestId } from '../../../shared/http/request-id.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { ExampleItemModule } from '../example-item.module.js';
import { EXAMPLE_ITEM_PERMISSIONS } from '../example-item.routes.js';
import { ExampleItemRepository } from '../repository/example-item.repository.js';
import { seedRepository } from './fakes.js';

/** The bearers the stub verifier accepts; anything else is `null` → 401 `ERP-AUTH-0004`. */
export const TEST_BEARERS = {
  /** Staff 1: holds `view` — the full-view code, so the guard resolves scope `all`. */
  view: 'valid-view',
  /** Staff 3: holds `viewOwn` only, so the guard resolves scope `own` (owns id 2). */
  viewOwn: 'valid-viewown',
  /** Staff 2: authenticated, no permission → 403 `ERP-AUTH-0005`. */
  noPermission: 'valid-noperm',
  /** Staff 4: holds `view`, `create` and `edit`. */
  writer: 'valid-writer',
  /** Staff 5: holds `view` only, so a write answers 403. */
  viewOnly: 'valid-viewonly',
} as const;

/** The staff id behind each bearer. */
export const TEST_STAFF = {
  view: 1,
  noPermission: 2,
  viewOwn: 3,
  writer: 4,
  viewOnly: 5,
} as const;

const FAR_FUTURE_EXPIRY_S = 4_102_444_800; // 2100-01-01T00:00:00Z

const { view, viewOwn, create, edit } = EXAMPLE_ITEM_PERMISSIONS;

/** Which codes each staff member holds; nobody here is an administrator. */
const HELD: Readonly<Record<number, readonly string[]>> = {
  [TEST_STAFF.view]: [view],
  [TEST_STAFF.viewOwn]: [viewOwn],
  [TEST_STAFF.writer]: [view, create, edit],
  [TEST_STAFF.viewOnly]: [view],
};

const STAFF_BY_BEARER: Readonly<Record<string, number>> = Object.fromEntries(
  Object.entries(TEST_BEARERS).map(([who, token]) => [
    token,
    TEST_STAFF[who as keyof typeof TEST_BEARERS],
  ]),
);

function userOf(staffId: number): AuthenticatedUser {
  return {
    staffId,
    sessionId: `sid-${String(staffId)}`,
    jti: `jti-${String(staffId)}`,
    isAdmin: false,
    roleId: null,
    tokenVersion: 0,
    expiresAt: FAR_FUTURE_EXPIRY_S,
  };
}

/** Five bearers and their codes; no cryptography — the real verifier is `v1/auth`'s facade. */
export class StubAccessTokenVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    const staffId = STAFF_BY_BEARER[token];
    return Promise.resolve(staffId === undefined ? null : userOf(staffId));
  }

  hasPermission(staffId: number, code: string): Promise<boolean> {
    return Promise.resolve((HELD[staffId] ?? []).includes(code));
  }
}

@Global()
@Module({
  providers: [{ provide: ACCESS_TOKEN_VERIFIER, useValue: new StubAccessTokenVerifier() }],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class StubVerifierModule {}

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

export interface ExampleItemTestApp {
  readonly app: NestFastifyApplication;
  readonly moduleRef: TestingModule;
  /** Every route Fastify registered as `METHOD url` (HEAD twins included). */
  readonly routes: readonly string[];
  /** The module's store, seeded with `SEED_ITEMS` (ids 1–3). */
  readonly repo: ExampleItemRepository;
  /** Every domain event the module published. */
  readonly events: RecordingDomainEventPublisher;
  close(): Promise<void>;
}

export interface ExampleItemTestAppOptions {
  /** `MODULES_DISABLED` (ADR-0042); absent is the env default, every module on. */
  readonly disabledModules?: readonly ModuleName[];
}

export async function createExampleItemTestApp(
  options: ExampleItemTestAppOptions = {},
): Promise<ExampleItemTestApp> {
  const repo = new ExampleItemRepository();
  await seedRepository(repo);
  const events = new RecordingDomainEventPublisher();
  const logger = new SilentLogger();
  const config = { env: { MODULES_DISABLED: options.disabledModules ?? [] } };

  @Global()
  @Module({
    providers: [{ provide: AppConfig, useValue: config }, ModuleSwitch],
    exports: [AppConfig, ModuleSwitch],
  })
  class StubConfigModule {}

  const moduleRef = await Test.createTestingModule({
    imports: [EventsModule, StubConfigModule, StubVerifierModule, ExampleItemModule],
  })
    .overrideProvider(ExampleItemRepository)
    .useValue(repo)
    .overrideProvider(DOMAIN_EVENT_PUBLISHER)
    .useValue(events)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  registerRequestId(app);
  app.setGlobalPrefix(API_PREFIX, { exclude: [...UNPREFIXED_ROUTES] });
  app.useGlobalFilters(new ProblemDetailsFilter(logger));

  const routes: string[] = [];
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (route) => {
      const methods = Array.isArray(route.method) ? route.method : [route.method];
      for (const method of methods) routes.push(`${method} ${route.url}`);
    });

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return { app, moduleRef, routes, repo, events, close: () => app.close() };
}
