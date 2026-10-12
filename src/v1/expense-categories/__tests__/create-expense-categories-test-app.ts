/**
 * The module inside a real Nest + Fastify application, without a network or a database: the
 * repository is `InMemoryExpenseCategoriesRepository` (`fakes.ts`) seeded with `SEED_ITEMS` (its
 * usage answer settable), the access-token verifier is a stub with three known bearers, the
 * domain-event publisher is the recording one and the logger records its `log` lines (so a spec
 * can assert both), and everything else (the module wiring, the guards, the request-id hook, the
 * global prefix, the problem-details filter) is the production code path, so `app.inject` proves
 * the HTTP contract `main.ts` serves.
 *
 * The bearers follow `v1/identity`'s test app: an administrator, a member holding EVERY code in the
 * `@erp/contracts` catalogue who is still not an administrator (the D-06 proof: no code opens this
 * module), and a member holding none.
 */
import { Global, Module } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { PERMISSION_CODES } from '@erp/contracts';
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
import { LoggerModule } from '../../../shared/logger/logger.module.js';
import { LoggerService, type LogMeta } from '../../../shared/logger/logger.service.js';
import { ExpenseCategoriesModule } from '../expense-categories.module.js';
import { ExpenseCategoriesRepository } from '../repository/expense-categories.repository.js';
import { asRepository, seededStore, type InMemoryExpenseCategoriesRepository } from './fakes.js';

/** The bearers the stub verifier accepts; anything else is `null`, so 401 `ERP-AUTH-0004`. */
export const TEST_BEARERS = {
  /** Staff 1: `tblstaff.admin = 1`, the only bearer this module admits. */
  admin: 'valid-admin',
  /** Staff 2: holds EVERY code in the catalogue, and is still not an administrator. */
  everyCode: 'valid-everycode',
  /** Staff 3: authenticated, holds no code, not an administrator. */
  noPermission: 'valid-noperm',
} as const;

/** The staff id behind each bearer. */
export const TEST_STAFF = {
  admin: 1,
  everyCode: 2,
  noPermission: 3,
} as const;

const FAR_FUTURE_EXPIRY_S = 4_102_444_800; // 2100-01-01T00:00:00Z

function userOf(staffId: number, isAdmin: boolean): AuthenticatedUser {
  return {
    staffId,
    sessionId: `sid-${String(staffId)}`,
    jti: `jti-${String(staffId)}`,
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: FAR_FUTURE_EXPIRY_S,
  };
}

const USERS: Readonly<Record<string, AuthenticatedUser>> = {
  [TEST_BEARERS.admin]: userOf(TEST_STAFF.admin, true),
  [TEST_BEARERS.everyCode]: userOf(TEST_STAFF.everyCode, false),
  [TEST_BEARERS.noPermission]: userOf(TEST_STAFF.noPermission, false),
};

/** Three bearers; no cryptography: the real verifier is `v1/auth`'s facade. */
export class StubAccessTokenVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    return Promise.resolve(USERS[token] ?? null);
  }

  hasPermission(staffId: number, code: string): Promise<boolean> {
    if (staffId === TEST_STAFF.admin || staffId === TEST_STAFF.everyCode) {
      return Promise.resolve(PERMISSION_CODES.includes(code));
    }
    return Promise.resolve(false);
  }
}

@Global()
@Module({
  providers: [{ provide: ACCESS_TOKEN_VERIFIER, useValue: new StubAccessTokenVerifier() }],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class StubVerifierModule {}

/** One `log` call the service made: the message and its meta. */
export interface LoggedLine {
  readonly message: string;
  readonly meta: LogMeta | undefined;
}

/**
 * Keeps the test output readable (no JSON log lines from the container) and records every `log`
 * call, so a spec can assert the D-08 line: its message and `{ id }`, and nothing else.
 */
export class RecordingLogger extends LoggerService {
  readonly lines: LoggedLine[] = [];

  override log(message: string, meta?: LogMeta): void {
    this.lines.push({ message, meta });
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

export interface ExpenseCategoriesTestApp {
  readonly app: NestFastifyApplication;
  readonly moduleRef: TestingModule;
  /** Every route Fastify registered as `METHOD url` (HEAD twins included). */
  readonly routes: readonly string[];
  /** The repository's fake, seeded with `SEED_ITEMS` (ids 1 to 3), its usage answer settable. */
  readonly repo: InMemoryExpenseCategoriesRepository;
  /** Every domain event the module published. */
  readonly events: RecordingDomainEventPublisher;
  /** Every `log` line the module wrote. */
  readonly logger: RecordingLogger;
  close(): Promise<void>;
}

export async function createExpenseCategoriesTestApp(): Promise<ExpenseCategoriesTestApp> {
  const repo = await seededStore();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();

  const moduleRef = await Test.createTestingModule({
    imports: [LoggerModule, EventsModule, StubVerifierModule, ExpenseCategoriesModule],
  })
    .overrideProvider(ExpenseCategoriesRepository)
    .useValue(asRepository(repo))
    .overrideProvider(DOMAIN_EVENT_PUBLISHER)
    .useValue(events)
    .overrideProvider(LoggerService)
    .useValue(logger)
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

  return { app, moduleRef, routes, repo, events, logger, close: () => app.close() };
}
