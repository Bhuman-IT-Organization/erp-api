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

import { FakeSettingsFacade, stubSettingsModule } from '../../settings/__tests__/fakes.js';
import { SettingsModule } from '../../settings/settings.module.js';
import { LeadStatusesModule } from '../lead-statuses.module.js';
import { LeadStatusesRepository } from '../repository/lead-statuses.repository.js';
import { asRepository, seededStore, type InMemoryLeadStatusesRepository } from './fakes.js';

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
  [TEST_BEARERS.admin]: userOf(TEST_STAFF.admin, true),
  [TEST_BEARERS.everyCode]: userOf(TEST_STAFF.everyCode, false),
  [TEST_BEARERS.noPermission]: userOf(TEST_STAFF.noPermission, false),
};

export class StubAccessTokenVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    return Promise.resolve(USERS[token] ?? null);
  }

  hasPermission(staffId: number, code: string): Promise<boolean> {
    if (staffId === TEST_STAFF.admin) return Promise.resolve(true);

    if (staffId === TEST_STAFF.everyCode) {
      return Promise.resolve(PERMISSION_CODES.some((permissionCode) => permissionCode === code));
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

export interface LoggedLine {
  readonly message: string;
  readonly meta: LogMeta | undefined;
}

export class RecordingLogger extends LoggerService {
  readonly lines: LoggedLine[] = [];

  override log(message: string, meta?: LogMeta): void {
    this.lines.push({ message, meta });
  }

  override warn(): void {
    return;
  }

  override error(): void {
    return;
  }

  override debug(): void {
    return;
  }
}

/**
 * The fake settings facade provides a configurable leads_default_status setting.
 * Use null to simulate a missing setting.
 */
export function settingsWithLeadStatus(defaultStatusId: string | null = '2'): FakeSettingsFacade {
  return new FakeSettingsFacade(
    defaultStatusId === null ? [] : [{ name: 'leads_default_status', value: defaultStatusId }],
  );
}

export interface LeadStatusesTestApp {
  readonly app: NestFastifyApplication;
  readonly moduleRef: TestingModule;
  readonly routes: readonly string[];
  readonly repo: InMemoryLeadStatusesRepository;
  readonly settings: FakeSettingsFacade;
  readonly events: RecordingDomainEventPublisher;
  readonly logger: RecordingLogger;
  close(): Promise<void>;
}

export async function createLeadStatusesTestApp(
  defaultStatusId: string | null = '2',
): Promise<LeadStatusesTestApp> {
  const repo = seededStore();
  const settings = settingsWithLeadStatus(defaultStatusId);
  const events = new RecordingDomainEventPublisher();
  const logger = new RecordingLogger();

  const moduleRef = await Test.createTestingModule({
    imports: [LoggerModule, EventsModule, StubVerifierModule, LeadStatusesModule],
  })
    .overrideModule(SettingsModule)
    .useModule(stubSettingsModule(settings))
    .overrideProvider(LeadStatusesRepository)
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
    settings,
    events,
    logger,
    close: () => app.close(),
  };
}
