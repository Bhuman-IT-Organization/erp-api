import 'reflect-metadata';
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
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { PredefinedRepliesModule } from '../predefined-replies.module.js';
import { PredefinedRepliesRepository } from '../repository/predefined-replies.repository.js';
import { asRepository, InMemoryPredefinedRepliesRepository } from './fakes.js';

export const TEST_BEARERS = {
  admin: 'valid-admin',
  everyCode: 'valid-everycode',
  noPermission: 'valid-noperm',
} as const;

const FAR_FUTURE_EXPIRY_S = 4_102_444_800;

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
  [TEST_BEARERS.admin]: userOf(1, true),
  [TEST_BEARERS.everyCode]: userOf(2, false),
  [TEST_BEARERS.noPermission]: userOf(3, false),
};

class StubAccessTokenVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    return Promise.resolve(USERS[token] ?? null);
  }

  hasPermission(staffId: number, code: string): Promise<boolean> {
    if (staffId === 1 || staffId === 2) {
      return Promise.resolve(PERMISSION_CODES.includes(code));
    }

    return Promise.resolve(false);
  }
}

@Global()
@Module({
  providers: [{ provide: ACCESS_TOKEN_VERIFIER, useClass: StubAccessTokenVerifier }],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class StubVerifierModule {}

export interface PredefinedRepliesTestApp {
  readonly app: NestFastifyApplication;
  readonly moduleRef: TestingModule;
  readonly routes: readonly string[];
  readonly repo: InMemoryPredefinedRepliesRepository;
  readonly events: RecordingDomainEventPublisher;
  close(): Promise<void>;
}

export async function createPredefinedRepliesTestApp(): Promise<PredefinedRepliesTestApp> {
  const repo = new InMemoryPredefinedRepliesRepository();
  await repo.seed();

  const events = new RecordingDomainEventPublisher();
  const logger = new LoggerService();

  const moduleRef = await Test.createTestingModule({
    imports: [LoggerModule, EventsModule, StubVerifierModule, PredefinedRepliesModule],
  })
    .overrideProvider(DOMAIN_EVENT_PUBLISHER)
    .useValue(events)
    .overrideProvider(PredefinedRepliesRepository)
    .useValue(asRepository(repo))
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

      for (const method of methods) {
        routes.push(`${method} ${route.url}`);
      }
    });

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  return {
    app,
    moduleRef,
    routes,
    repo,
    events,
    close: () => app.close(),
  };
}
