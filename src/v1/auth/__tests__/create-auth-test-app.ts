/**
 * The auth module inside a real Nest + Fastify application, without a database, Redis or a
 * network: `AppConfig` is a stub (an RSA key generated per run, `NODE_ENV=test`, no `REDIS_URL`),
 * the repository is `FakeAuthRepository`, the session store is the in-memory fake and the
 * transport's `fetchImpl` is a recording fake that answers "erp_sso active" (405 + `X-Erp-Sso`)
 * unless a test swaps it. Everything else — the module wiring, the guards, the request-id hook,
 * the cookie/CSRF plugins, compression, the global prefix, the problem-details filter, the breaker registry and
 * the health controller — is the production code path, so `app.inject` proves the HTTP contract
 * `main.ts` serves.
 *
 * Since plan 03.1-11 `AuthModule` imports `IdentityModule` (`AuthService` reads permission rows
 * through `IdentityFacade.permissionsOf` — ADR-0034 d.1), so this app boots `DbModule` for
 * `PrismaService` and then **overrides `IdentityFacade`** with a fake reading the same
 * `FakeAuthRepository` rows the old `listPermissions` returned: the identity providers are
 * constructed, nothing queries, and every existing assertion about the permission snapshot keeps its
 * meaning. `PrismaService` against the stub URL is never touched — the same pattern
 * `src/v1/__tests__/openapi-covers-routes.spec.ts` uses.
 */
import { exportPKCS8, generateKeyPair } from 'jose';
import { Module, type DynamicModule, type ModuleMetadata } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { AppConfig } from '../../../shared/config/app-config.js';
import { ConfigModule } from '../../../shared/config/config.module.js';
import type { Env } from '../../../shared/config/env.schema.js';
import type { ModuleName } from '../../../shared/config/modules.js';
import { ProblemDetailsFilter } from '../../../shared/errors/problem-details.filter.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  RecordingDomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { EventsModule } from '../../../shared/events/events.module.js';
import { HealthModule } from '../../../shared/health/health.module.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { registerCompression } from '../../../shared/http/compression.js';
import { registerFastifyPlugins } from '../../../shared/http/fastify-plugins.js';
import { setupApiDocs } from '../../../shared/http/openapi.js';
import { registerRequestId } from '../../../shared/http/request-id.js';
import { LoggerModule } from '../../../shared/logger/logger.module.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { BreakerRegistry } from '../../../shared/resilience/breaker.js';
import { ResilienceModule } from '../../../shared/resilience/resilience.module.js';
import { IdentityModule } from '../../identity/identity.module.js';
import { IdentityFacade } from '../../identity/index.js';
import { AuthModule } from '../auth.module.js';
import { AUTH_HTTP_SECURITY } from '../index.js';
import { AUTH_SESSION_STORE } from '../repository/auth-session.store.js';
import { InMemoryAuthSessionStore } from '../repository/in-memory-auth-session.store.js';
import { AuthRepository } from '../repository/auth.repository.js';
import { AuthTransport, LEGACY_SSO_ACTIVE_HEADER } from '../service/auth.transport.js';
import { FakeAuthRepository, FakeIdentityFacade } from './fakes.js';

export const TEST_LEGACY_BASE_URL = 'http://legacy.test';

/**
 * `AuthModule` imports `IdentityModule` since plan 03.1-11, and this app has no database — so the
 * whole module is **replaced**, not patched: `overrideModule` keeps `IdentityRepository` and
 * `PrismaService` from being constructed at all, which is why this file still names no Prisma type
 * (`G_PRISMA` in scope 5 forbids it) and why `GET /api/v1/health` still reports only the probes this
 * app really has — importing `DbModule` would register a `db` probe that fails against the stub URL
 * and turn the breaker cases' 200 into a 503.
 */
function FakeIdentityModule(identity: FakeIdentityFacade): DynamicModule {
  @Module({
    providers: [{ provide: IdentityFacade, useValue: identity }],
    exports: [IdentityFacade],
  })
  class StubIdentityModule {}
  return { module: StubIdentityModule };
}

export interface RecordedLegacyCall {
  readonly url: string;
  readonly method: string | undefined;
}

/** A recording fake `fetch`; `answer` is swapped per test, `calls` grows with every call. */
export class FakeLegacyFetch {
  readonly calls: RecordedLegacyCall[] = [];
  answer: () => Promise<Response> = () =>
    Promise.resolve(
      new Response(null, {
        status: 405,
        headers: { allow: 'POST', [LEGACY_SSO_ACTIVE_HEADER]: 'active' },
      }),
    );

  readonly impl: typeof fetch = (input, init) => {
    this.calls.push({
      url: input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
      method: init?.method,
    });
    return this.answer();
  };
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

export interface AuthTestAppOptions {
  /** Modules mounted beside the auth set (the route-coverage spec passes `V1Module` and the db/cache modules). */
  readonly imports?: NonNullable<ModuleMetadata['imports']>;
  /** Serve `/api/v1/docs` and `/api/v1/openapi.json` (default off — the e2e specs assert the route set without them). */
  readonly docs?: boolean;
  /** `MODULES_DISABLED` (ADR-0042); default none, every module on. */
  readonly disabledModules?: readonly ModuleName[];
}

export interface RegisteredRoute {
  readonly method: string;
  readonly url: string;
}

export interface AuthTestApp {
  readonly app: NestFastifyApplication;
  readonly moduleRef: TestingModule;
  /** Every route URL Fastify registered (HEAD twins included). */
  readonly routes: readonly string[];
  /** The same routes with their method (`onRoute` hook; one entry per method, HEAD twins included). */
  readonly routeTable: readonly RegisteredRoute[];
  readonly store: InMemoryAuthSessionStore;
  readonly repo: FakeAuthRepository;
  /** The `v1/identity` facade fake `AuthService` reads permission rows through (ADR-0034 d.1). */
  readonly identity: FakeIdentityFacade;
  readonly publisher: RecordingDomainEventPublisher;
  readonly breakers: BreakerRegistry;
  readonly transport: AuthTransport;
  readonly legacyFetch: FakeLegacyFetch;
  close(): Promise<void>;
}

async function stubConfig(disabledModules: readonly ModuleName[]): Promise<AppConfig> {
  const { privateKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
  const env: Env = {
    NODE_ENV: 'test',
    PORT: 0,
    DATABASE_URL: 'mysql://unused:unused@127.0.0.1:1/unused',
    OWNERSHIP_GUARD: 'enforce',
    REDIS_URL: undefined,
    LEGACY_BASE_URL: TEST_LEGACY_BASE_URL,
    AUTH_REDIS_DB: 1,
    QUEUE_REDIS_DB: 2,
    DB_POOL_ROLE: 'api',
    MODULES_DISABLED: disabledModules,
    AUTH_JWT_PRIVATE_KEY_PEM: Buffer.from(await exportPKCS8(privateKey), 'utf8').toString('base64'),
    AUTH_JWT_ISSUER: 'erp-api',
    AUTH_JWT_AUDIENCE: 'erp-web',
    AUTH_COOKIE_SECURE: false,
    RESILIENCE_BREAKER_VOLUME_THRESHOLD: undefined,
    RESILIENCE_BREAKER_HALF_OPEN_AFTER_MS: undefined,
    API_DOCS_ENABLED: false,
    FILE_STORAGE_DIR: undefined,
    UPLOAD_MAX_BYTES: 67_108_864,
    UPLOAD_MAX_FILES: 10,
  };
  return { env };
}

export async function createAuthTestApp(options: AuthTestAppOptions = {}): Promise<AuthTestApp> {
  const config = await stubConfig(options.disabledModules ?? []);
  const repo = new FakeAuthRepository();
  const identity = new FakeIdentityFacade(repo);
  const store = new InMemoryAuthSessionStore();
  const publisher = new RecordingDomainEventPublisher();
  const legacyFetch = new FakeLegacyFetch();
  const logger = new SilentLogger();

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule,
      LoggerModule,
      ResilienceModule,
      HealthModule,
      EventsModule,
      AuthModule,
      ...(options.imports ?? []),
    ],
  })
    .overrideProvider(AppConfig)
    .useValue(config)
    .overrideModule(IdentityModule)
    .useModule(FakeIdentityModule(identity))
    .overrideProvider(LoggerService)
    .useValue(logger)
    .overrideProvider(DOMAIN_EVENT_PUBLISHER)
    .useValue(publisher)
    .overrideProvider(AuthRepository)
    .useValue(repo)
    .overrideProvider(AUTH_SESSION_STORE)
    .useValue(store)
    .compile();

  const transport = moduleRef.get(AuthTransport);
  transport.fetchImpl = legacyFetch.impl;
  transport.retryDeps = { sleep: () => Promise.resolve(), random: () => 0 };
  const breakers = moduleRef.get(BreakerRegistry);

  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  // Before anything registers a route: SwaggerModule adds its handlers at setup time, Nest's at init.
  const routes: string[] = [];
  const routeTable: RegisteredRoute[] = [];
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (route) => {
      routes.push(route.url);
      for (const method of Array.isArray(route.method) ? route.method : [route.method]) {
        routeTable.push({ method, url: route.url });
      }
    });

  registerRequestId(app);
  await registerFastifyPlugins(app, AUTH_HTTP_SECURITY, { cookieSecure: false });
  await registerCompression(app);
  app.setGlobalPrefix(API_PREFIX, { exclude: [...UNPREFIXED_ROUTES] });
  setupApiDocs(app, options.docs ?? false);
  app.useGlobalFilters(new ProblemDetailsFilter(logger));

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    moduleRef,
    routes,
    routeTable,
    store,
    repo,
    identity,
    publisher,
    breakers,
    transport,
    legacyFetch,
    close: () => app.close(),
  };
}
