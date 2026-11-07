import { Global, Module } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { PERMISSION_CODES } from '@erp/contracts';
import {
  DOMAIN_EVENT_PUBLISHER,
  RecordingDomainEventPublisher,
} from '../../../shared/events/domain-event.publisher.js';
import { EventsModule } from '../../../shared/events/events.module.js';
import { ProblemDetailsFilter } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
  type AuthenticatedUser,
} from '../../../shared/http/auth/access-token-verifier.js';
import { registerRequestId } from '../../../shared/http/request-id.js';
import { LoggerModule } from '../../../shared/logger/logger.module.js';
import { LoggerService, type LogMeta } from '../../../shared/logger/logger.service.js';
import { EstimateRequestStatusesModule } from '../estimate-request-statuses.module.js';
import { EstimateRequestStatusesRepository } from '../repository/estimate-request-statuses.repository.js';
import { EstimateRequestStatusesService } from '../service/estimate-request-statuses.service.js';
import { asRepository, InMemoryEstimateRequestStatusesRepository } from './fakes.js';

export const TEST_BEARERS = {
  admin: 'valid-admin',
  everyCode: 'valid-everycode',
  noPermission: 'valid-noperm',
} as const;

export const TEST_NOW = new Date('2026-10-24T10:30:00.000Z');

const EXPIRY_S = 4_102_444_800;

function userOf(staffId: number, isAdmin: boolean): AuthenticatedUser {
  return {
    staffId,
    sessionId: `sid-${String(staffId)}`,
    jti: `jti-${String(staffId)}`,
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: EXPIRY_S,
  };
}

const USERS: ReadonlyMap<string, AuthenticatedUser> = new Map([
  [TEST_BEARERS.admin, userOf(1, true)],
  [TEST_BEARERS.everyCode, userOf(2, false)],
  [TEST_BEARERS.noPermission, userOf(3, false)],
]);

class StubVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    return Promise.resolve(USERS.get(token) ?? null);
  }

  hasPermission(staffId: number, code: string): Promise<boolean> {
    if (staffId === 1) return Promise.resolve(true);
    if (staffId === 2) return Promise.resolve(PERMISSION_CODES.includes(code));
    return Promise.resolve(false);
  }
}

@Global()
@Module({
  providers: [{ provide: ACCESS_TOKEN_VERIFIER, useClass: StubVerifier }],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class StubVerifierModule {}

class RecordingLogger extends LoggerService {
  readonly lines: { readonly message: string; readonly meta?: LogMeta }[] = [];

  override log(message: string, meta?: LogMeta): void {
    this.lines.push({ message, ...(meta === undefined ? {} : { meta }) });
  }

  override error(): void {
    /* test logger intentionally discards these levels */
  }

  override warn(): void {
    /* test logger intentionally discards these levels */
  }

  override debug(): void {
    /* test logger intentionally discards these levels */
  }
}

export interface EstimateRequestStatusesTestApp {
  readonly app: NestFastifyApplication;
  readonly moduleRef: TestingModule;
  readonly routes: readonly string[];
  readonly repo: InMemoryEstimateRequestStatusesRepository;
  readonly events: RecordingDomainEventPublisher;
  readonly logger: RecordingLogger;
  close(): Promise<void>;
}

export async function createEstimateRequestStatusesTestApp(): Promise<EstimateRequestStatusesTestApp> {
  const repo = new InMemoryEstimateRequestStatusesRepository();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();
  const moduleRef = await Test.createTestingModule({
    imports: [LoggerModule, EventsModule, StubVerifierModule, EstimateRequestStatusesModule],
  })
    .overrideProvider(EstimateRequestStatusesRepository)
    .useValue(asRepository(repo))
    .overrideProvider(DOMAIN_EVENT_PUBLISHER)
    .useValue(events)
    .overrideProvider(LoggerService)
    .useValue(logger)
    .compile();
  moduleRef.get(EstimateRequestStatusesService).now = () => TEST_NOW;

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
