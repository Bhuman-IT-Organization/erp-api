/**
 * The module inside a real Nest + Fastify application, without a network or a database: the
 * repository is `InMemoryFixedEquipmentDepreciationsRepository` (`fakes.ts`) seeded with
 * `SEED_FIXED_EQUIPMENT_DEPRECIATIONS`, the access-token verifier is a stub with four known bearers,
 * the domain-event publisher is the recording one and the logger records its `log` lines.
 * Everything else (the module wiring, `JwtAuthGuard` and `PermissionGuard`, the request-id hook, the
 * global prefix, the problem-details filter) is the production code path, so `app.inject` proves the
 * HTTP contract `main.ts` serves.
 *
 * The bearers cover each way in: an administrator (every code), a member holding the full `view` and
 * the writes (scope `all`), a member holding only `viewOwn` and `create` (scope `own`: the rows they
 * created), and a member holding none.
 */
import { Global, Module } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { PERMISSIONS } from '@erp/contracts';
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
import { FixedEquipmentDepreciationsModule } from '../fixed-equipment-depreciations.module.js';
import { FixedEquipmentDepreciationsRepository } from '../repository/fixed-equipment-depreciations.repository.js';
import {
  asRepository,
  seededStore,
  type InMemoryFixedEquipmentDepreciationsRepository,
} from './fakes.js';

const CODES = PERMISSIONS.fixedEquipment.settingDepreciation;

/** The bearers the stub verifier accepts; anything else is `null`, so 401 `ERP-AUTH-0004`. */
export const TEST_BEARERS = {
  /** Staff 1: `tblstaff.admin = 1`, every code. */
  admin: 'valid-admin',
  /** Staff 2: `view` and the three writes, not an administrator: scope `all`. */
  viewer: 'valid-viewer',
  /** Staff 3: `viewOwn` and `create` only: scope `own`, the rows they created. */
  owner: 'valid-owner',
  /** Staff 4: authenticated, holds no code. */
  noPermission: 'valid-noperm',
} as const;

/** The staff id behind each bearer. */
export const TEST_STAFF = {
  admin: 1,
  viewer: 2,
  owner: 3,
  noPermission: 4,
} as const;

/** The codes each non-administrator holds. */
const HELD: Readonly<Record<number, readonly string[]>> = {
  [TEST_STAFF.viewer]: [CODES.view, CODES.create, CODES.edit, CODES.delete],
  [TEST_STAFF.owner]: [CODES.viewOwn, CODES.create],
  [TEST_STAFF.noPermission]: [],
};

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
  [TEST_BEARERS.viewer]: userOf(TEST_STAFF.viewer, false),
  [TEST_BEARERS.owner]: userOf(TEST_STAFF.owner, false),
  [TEST_BEARERS.noPermission]: userOf(TEST_STAFF.noPermission, false),
};

/**
 * Four bearers; no cryptography: the real verifier is `v1/auth`'s facade. As there, an administrator
 * holds every code; a member holds exactly the codes in `HELD`.
 */
export class StubAccessTokenVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    return Promise.resolve(USERS[token] ?? null);
  }

  hasPermission(staffId: number, code: string): Promise<boolean> {
    if (staffId === TEST_STAFF.admin) return Promise.resolve(true);
    return Promise.resolve((HELD[staffId] ?? []).includes(code));
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

/** Keeps the test output readable and records every `log` call, so a spec can assert it. */
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

export interface FixedEquipmentDepreciationsTestApp {
  readonly app: NestFastifyApplication;
  readonly moduleRef: TestingModule;
  /** Every route Fastify registered as `METHOD url` (HEAD twins included). */
  readonly routes: readonly string[];
  /** The repository's fake, seeded with `SEED_FIXED_EQUIPMENT_DEPRECIATIONS` (ids 1 to 4). */
  readonly repo: InMemoryFixedEquipmentDepreciationsRepository;
  /** Every domain event the module published. */
  readonly events: RecordingDomainEventPublisher;
  /** Every `log` line the module wrote. */
  readonly logger: RecordingLogger;
  close(): Promise<void>;
}

export async function createFixedEquipmentDepreciationsTestApp(): Promise<FixedEquipmentDepreciationsTestApp> {
  const repo = seededStore();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();

  const moduleRef = await Test.createTestingModule({
    imports: [LoggerModule, EventsModule, StubVerifierModule, FixedEquipmentDepreciationsModule],
  })
    .overrideProvider(FixedEquipmentDepreciationsRepository)
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
