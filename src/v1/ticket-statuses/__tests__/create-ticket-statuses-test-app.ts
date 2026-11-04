import { Global, Module } from '@nestjs/common';
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
import { registerRequestId } from '../../../shared/http/request-id.js';
import { LoggerModule } from '../../../shared/logger/logger.module.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { FakeSettingsFacade, stubSettingsModule } from '../../settings/__tests__/fakes.js';
import { SettingsModule } from '../../settings/settings.module.js';
import { TicketStatusesModule } from '../ticket-statuses.module.js';
import { TicketStatusesRepository } from '../repository/ticket-statuses.repository.js';
import { TicketStatusesService } from '../service/ticket-statuses.service.js';
import { asRepository, seededStore, type InMemoryTicketStatusesRepository } from './fakes.js';

export const TEST_BEARERS = {
  admin: 'valid-admin',
  everyCode: 'valid-everycode',
  noPermission: 'valid-noperm',
} as const;

export const TEST_STAFF = {
  admin: 1,
  everyCode: 2,
  noPermission: 3,
} as const;

export const TEST_NOW = new Date('2026-10-24T10:30:00.000Z');

const DEFAULT_REPLY_OPTION = 'default_ticket_reply_status';
const FAR_FUTURE_EXPIRY_S = 4_102_444_800;

function userOf(staffId: number, isAdmin: boolean): AuthenticatedUser {
  return {
    staffId,
    sessionId: `session-${String(staffId)}`,
    jti: `jti-${String(staffId)}`,
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: FAR_FUTURE_EXPIRY_S,
  };
}

class StubAccessTokenVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    if (token === TEST_BEARERS.admin) return Promise.resolve(userOf(TEST_STAFF.admin, true));
    if (token === TEST_BEARERS.everyCode) {
      return Promise.resolve(userOf(TEST_STAFF.everyCode, false));
    }
    if (token === TEST_BEARERS.noPermission) {
      return Promise.resolve(userOf(TEST_STAFF.noPermission, false));
    }
    return Promise.resolve(null);
  }
  hasPermission(staffId: number, code: string): Promise<boolean> {
    return Promise.resolve(
      code.length > 0 && (staffId === TEST_STAFF.admin || staffId === TEST_STAFF.everyCode),
    );
  }
}

@Global()
@Module({
  providers: [{ provide: ACCESS_TOKEN_VERIFIER, useValue: new StubAccessTokenVerifier() }],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class StubVerifierModule {}

export class RecordingLogger extends LoggerService {
  readonly lines: { message: string; meta: Record<string, unknown> | undefined }[] = [];
  override log(message: string, meta?: Record<string, unknown>): void {
    this.lines.push({ message, meta });
  }
}

export function settingsWithDefaultReplyStatus(value: string | null = null): FakeSettingsFacade {
  return new FakeSettingsFacade(value === null ? [] : [{ name: DEFAULT_REPLY_OPTION, value }]);
}

export interface TicketStatusesTestApp {
  readonly app: NestFastifyApplication;
  readonly moduleRef: TestingModule;
  readonly routes: readonly string[];
  readonly repo: InMemoryTicketStatusesRepository;
  readonly settings: FakeSettingsFacade;
  readonly events: RecordingDomainEventPublisher;
  readonly logger: RecordingLogger;
  setDefaultReplyStatus(value: string | null): void;
  close(): Promise<void>;
}

export async function createTicketStatusesTestApp(): Promise<TicketStatusesTestApp> {
  const repo = seededStore();
  const settings = settingsWithDefaultReplyStatus();
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();

  const moduleRef = await Test.createTestingModule({
    imports: [LoggerModule, EventsModule, StubVerifierModule, TicketStatusesModule],
  })
    .overrideModule(SettingsModule)
    .useModule(stubSettingsModule(settings))
    .overrideProvider(TicketStatusesRepository)
    .useValue(asRepository(repo))
    .overrideProvider(DOMAIN_EVENT_PUBLISHER)
    .useValue(events)
    .overrideProvider(LoggerService)
    .useValue(logger)
    .compile();

  moduleRef.get(TicketStatusesService).now = () => TEST_NOW;

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

  return {
    app,
    moduleRef,
    routes,
    repo,
    settings,
    events,
    logger,
    setDefaultReplyStatus: (value) => {
      settings.options = value === null ? [] : [{ name: DEFAULT_REPLY_OPTION, value }];
    },
    close: () => app.close(),
  };
}
