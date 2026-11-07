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
import { KnowledgeBaseGroupsModule } from '../knowledge-base-groups.module.js';
import { KNOWLEDGE_BASE_GROUPS_PERMISSIONS } from '../knowledge-base-groups.routes.js';
import { KnowledgeBaseGroupsRepository } from '../repository/knowledge-base-groups.repository.js';
import { KnowledgeBaseGroupsService } from '../service/knowledge-base-groups.service.js';
import { InMemoryKnowledgeBaseGroupsRepository } from './fakes.js';

export const TEST_BEARERS = {
  admin: 'valid-admin',
  everyCode: 'valid-everycode',
  viewOnly: 'valid-viewonly',
  createOnly: 'valid-createonly',
  editOnly: 'valid-editonly',
  deleteOnly: 'valid-deleteonly',
  noPermission: 'valid-noperm',
} as const;

export const TEST_STAFF = {
  admin: 1,
  everyCode: 2,
  viewOnly: 3,
  createOnly: 4,
  editOnly: 5,
  deleteOnly: 6,
  noPermission: 7,
} as const;

export const TEST_NOW = new Date('2026-10-02T20:30:15.250Z');

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
  [TEST_BEARERS.viewOnly]: userOf(TEST_STAFF.viewOnly, false),
  [TEST_BEARERS.createOnly]: userOf(TEST_STAFF.createOnly, false),
  [TEST_BEARERS.editOnly]: userOf(TEST_STAFF.editOnly, false),
  [TEST_BEARERS.deleteOnly]: userOf(TEST_STAFF.deleteOnly, false),
  [TEST_BEARERS.noPermission]: userOf(TEST_STAFF.noPermission, false),
};

const STAFF_PERMISSIONS: Readonly<Record<number, readonly string[]>> = {
  [TEST_STAFF.admin]: PERMISSION_CODES,
  [TEST_STAFF.everyCode]: PERMISSION_CODES,
  [TEST_STAFF.viewOnly]: [KNOWLEDGE_BASE_GROUPS_PERMISSIONS.view],
  [TEST_STAFF.createOnly]: [KNOWLEDGE_BASE_GROUPS_PERMISSIONS.create],
  [TEST_STAFF.editOnly]: [KNOWLEDGE_BASE_GROUPS_PERMISSIONS.edit],
  [TEST_STAFF.deleteOnly]: [KNOWLEDGE_BASE_GROUPS_PERMISSIONS.delete],
  [TEST_STAFF.noPermission]: [],
};

export class StubAccessTokenVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    return Promise.resolve(USERS[token] ?? null);
  }

  hasPermission(staffId: number, code: string): Promise<boolean> {
    if (staffId === TEST_STAFF.admin) return Promise.resolve(true);
    const codes = STAFF_PERMISSIONS[staffId] ?? [];
    return Promise.resolve(codes.includes(code));
  }
}

@Global()
@Module({
  providers: [{ provide: ACCESS_TOKEN_VERIFIER, useValue: new StubAccessTokenVerifier() }],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class StubVerifierModule {}

export interface LoggedLine {
  readonly message: string;
  readonly meta: LogMeta | undefined;
}

export class RecordingLogger extends LoggerService {
  readonly lines: LoggedLine[] = [];

  override log(message: string, meta?: LogMeta): void {
    this.lines.push({ message, meta });
  }
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- stubbed logger method for test environment
  override warn(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- stubbed logger method for test environment
  override error(): void {}
  // eslint-disable-next-line @typescript-eslint/no-empty-function -- stubbed logger method for test environment
  override debug(): void {}
}

export interface KnowledgeBaseGroupsTestApp {
  readonly app: NestFastifyApplication;
  readonly moduleRef: TestingModule;
  readonly routes: readonly string[];
  readonly repo: InMemoryKnowledgeBaseGroupsRepository;
  readonly events: RecordingDomainEventPublisher;
  readonly logger: RecordingLogger;
  close(): Promise<void>;
}

export async function createKnowledgeBaseGroupsTestApp(): Promise<KnowledgeBaseGroupsTestApp> {
  const repo = new InMemoryKnowledgeBaseGroupsRepository();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();

  const moduleRef = await Test.createTestingModule({
    imports: [LoggerModule, EventsModule, StubVerifierModule, KnowledgeBaseGroupsModule],
  })
    .overrideProvider(KnowledgeBaseGroupsRepository)
    .useValue(repo)
    .overrideProvider(DOMAIN_EVENT_PUBLISHER)
    .useValue(events)
    .overrideProvider(LoggerService)
    .useValue(logger)
    .compile();

  moduleRef.get(KnowledgeBaseGroupsService).now = () => TEST_NOW;

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

export {
  createKnowledgeBaseGroupsTestApp as createKnowledgeBaseTestApp,
  type KnowledgeBaseGroupsTestApp as KnowledgeBaseTestApp,
};
