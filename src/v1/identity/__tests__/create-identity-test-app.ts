/**
 * The identity module inside a real Nest + Fastify application, without a database or a network:
 * the two repositories are the in-memory fakes, the access-token verifier is a stub with six known
 * bearers, and everything else — the module wiring, the guards, the request-id hook, the global
 * prefix, the problem-details filter, the events module — is the production code path, so
 * `app.inject` proves the HTTP contract `main.ts` serves.
 *
 * In erp-api the global `AuthModule` provides `ACCESS_TOKEN_VERIFIER`; here a global stub module
 * does, in the same position, so the guards resolve it exactly as they will in production.
 *
 * `IdentityModule` imports `DepartmentsModule` (D-55): here it is replaced whole by
 * `stubDepartmentsModule` over a `FakeDepartmentsFacade` that knows `SEED_PICKER_DEPARTMENTS` and
 * records what identity registers at init and every id it asks about (`departments`).
 *
 * **The bearer set is the point of this file.** ADR-0034 decision 2 says granting needs
 * `tblstaff.admin = 1` and never a permission code, so the stub carries an actor that holds
 * **every code in the catalogue** without the flag: the e2e spec uses it to prove that no amount of
 * permission gets a non-administrator through a granting field.
 */
import { Global, Module } from '@nestjs/common';
import { PERMISSION_CODES } from '@erp/contracts';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
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
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from '../../../shared/crypto/password-hasher.port.js';
import { registerRequestId } from '../../../shared/http/request-id.js';
import { LoggerModule } from '../../../shared/logger/logger.module.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { DepartmentsModule } from '../../departments/departments.module.js';
import { FakeDepartmentsFacade, stubDepartmentsModule } from '../../departments/__tests__/fakes.js';
import { IdentityModule } from '../identity.module.js';
import { IDENTITY_PERMISSIONS } from '../identity.routes.js';
import { IdentityAuditRepository } from '../repository/identity-audit.repository.js';
import { IdentityRepository } from '../repository/identity.repository.js';
import {
  FakeIdentityAuditRepository,
  FakeIdentityRepository,
  SEED_PICKER_DEPARTMENTS,
} from './fakes.js';

/** The six bearers the stub verifier accepts; anything else is `null` → 401 `ERP-AUTH-0004`. */
export const TEST_BEARERS = {
  /** Staff 1: `tblstaff.admin = 1`. The only bearer a granting field may travel on. */
  admin: 'valid-admin',
  /** Staff 2: `staff.members.view` only. */
  viewer: 'valid-viewer',
  /** Staff 3: `staff.members.view`, `create` and `edit`, and NOT an administrator. */
  editor: 'valid-editor',
  /** Staff 4: holds EVERY code in the ADR-0033 catalogue, and is still not an administrator. */
  everyCode: 'valid-everycode',
  /** Staff 5: authenticated, no permission → 403 `ERP-AUTH-0005`. */
  noPermission: 'valid-noperm',
  /**
   * Staff 4 again, but a demoted administrator whose token still carries `admin: true`; `tblstaff`
   * says staff 4 is not one (review CR-02 b of Phase 3.1).
   */
  staleAdmin: 'valid-stale-admin',
} as const;

export const ADMIN_STAFF_ID = 1;
export const VIEWER_STAFF_ID = 2;
export const EDITOR_STAFF_ID = 3;
export const EVERY_CODE_STAFF_ID = 4;
export const NO_PERMISSION_STAFF_ID = 5;

const FAR_FUTURE_EXPIRY_S = 4_102_444_800; // 2100-01-01T00:00:00Z

const EDITOR_CODES: readonly string[] = [
  IDENTITY_PERMISSIONS.members.view,
  IDENTITY_PERMISSIONS.members.create,
  IDENTITY_PERMISSIONS.members.edit,
];

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
  [TEST_BEARERS.admin]: userOf(ADMIN_STAFF_ID, true),
  [TEST_BEARERS.viewer]: userOf(VIEWER_STAFF_ID, false),
  [TEST_BEARERS.editor]: userOf(EDITOR_STAFF_ID, false),
  [TEST_BEARERS.everyCode]: userOf(EVERY_CODE_STAFF_ID, false),
  [TEST_BEARERS.noPermission]: userOf(NO_PERMISSION_STAFF_ID, false),
  [TEST_BEARERS.staleAdmin]: userOf(EVERY_CODE_STAFF_ID, true),
};

/** No cryptography — the real verifier is `v1/auth`'s facade. An admin implies every code. */
export class StubAccessTokenVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    return Promise.resolve(USERS[token] ?? null);
  }

  hasPermission(staffId: number, code: string): Promise<boolean> {
    if (staffId === ADMIN_STAFF_ID) return Promise.resolve(true);
    if (staffId === EVERY_CODE_STAFF_ID) {
      return Promise.resolve(PERMISSION_CODES.includes(code));
    }
    if (staffId === VIEWER_STAFF_ID) {
      return Promise.resolve(code === IDENTITY_PERMISSIONS.members.view);
    }
    if (staffId === EDITOR_STAFF_ID) return Promise.resolve(EDITOR_CODES.includes(code));
    return Promise.resolve(false);
  }
}

/**
 * The hashing port `v1/identity` resolves from the global `AuthModule` in production; here a stub
 * stands in, because this app boots no `AuthModule` (see the docblock of
 * `shared/crypto/password-hasher.port.ts`). It never hashes anything real — the bcrypt contract
 * is `v1/auth`'s own spec.
 */
export class StubPasswordHasher implements PasswordHasherPort {
  readonly calls: string[] = [];
  hash(password: string): Promise<string> {
    this.calls.push(password);
    return Promise.resolve(`stub-hash:${password}`);
  }
}

@Global()
@Module({
  providers: [
    { provide: ACCESS_TOKEN_VERIFIER, useValue: new StubAccessTokenVerifier() },
    { provide: PASSWORD_HASHER, useClass: StubPasswordHasher },
  ],
  exports: [ACCESS_TOKEN_VERIFIER, PASSWORD_HASHER],
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

export interface IdentityTestApp {
  readonly app: NestFastifyApplication;
  readonly moduleRef: TestingModule;
  /** Every route URL Fastify registered (HEAD twins included). */
  readonly routes: readonly string[];
  readonly repo: FakeIdentityRepository;
  readonly audit: FakeIdentityAuditRepository;
  readonly publisher: RecordingDomainEventPublisher;
  /** The stubbed departments facade: the picker, the known ids, what identity registered. */
  readonly departments: FakeDepartmentsFacade;
  close(): Promise<void>;
}

export async function createIdentityTestApp(): Promise<IdentityTestApp> {
  const repo = new FakeIdentityRepository();
  const audit = new FakeIdentityAuditRepository();
  const publisher = new RecordingDomainEventPublisher();
  const logger = new SilentLogger();
  const departments = new FakeDepartmentsFacade(SEED_PICKER_DEPARTMENTS);

  const moduleRef = await Test.createTestingModule({
    imports: [LoggerModule, EventsModule, StubVerifierModule, IdentityModule],
  })
    .overrideModule(DepartmentsModule)
    .useModule(stubDepartmentsModule(departments))
    .overrideProvider(IdentityRepository)
    .useValue(repo)
    .overrideProvider(IdentityAuditRepository)
    .useValue(audit)
    .overrideProvider(DOMAIN_EVENT_PUBLISHER)
    .useValue(publisher)
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
      routes.push(route.url);
    });

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    moduleRef,
    routes,
    repo,
    audit,
    publisher,
    departments,
    close: () => app.close(),
  };
}
