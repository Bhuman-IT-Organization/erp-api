/**
 * The branding module inside a real Nest + Fastify application, without a database or a network:
 * the settings facade is `FakeBrandingSettings` and the currencies facade `FakeBrandingCurrencies`;
 * everything else (the module wiring, the transport, the currencies-change handler on the real
 * `EventsModule` bus, the request-id hook, the global prefix, the problem-details filter) is the
 * production code path, so `app.inject` proves the HTTP contract `main.ts` serves. A trimmed
 * `create-auth-test-app.ts`: no cookies, no CSRF, no keys, no config stub, because this module
 * needs none of them.
 *
 * `SettingsModule` and `CurrenciesModule` are replaced whole (`stubSettingsModule`,
 * `stubCurrenciesModule`, auth's `FakeIdentityModule` form), not patched: their repositories would
 * need `PrismaService`, and this app has no database.
 */
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { ProblemDetailsFilter } from '../../../shared/errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { EventsModule } from '../../../shared/events/events.module.js';
import { registerRequestId } from '../../../shared/http/request-id.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { stubCurrenciesModule } from '../../currencies/__tests__/fakes.js';
import { CurrenciesModule } from '../../currencies/currencies.module.js';
import { stubSettingsModule } from '../../settings/__tests__/fakes.js';
import { SettingsModule } from '../../settings/settings.module.js';
import { BrandingModule } from '../branding.module.js';
import { FakeBrandingCurrencies, FakeBrandingSettings } from './fakes.js';

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

export interface BrandingTestApp {
  readonly app: NestFastifyApplication;
  readonly moduleRef: TestingModule;
  /** Every route URL Fastify registered (HEAD twins included). */
  readonly routes: readonly string[];
  /** The ten options' source (settable `options`; `calls` records each read). */
  readonly settings: FakeBrandingSettings;
  /** The base currency's source (settable `base`; `baseCalls` counts each read). */
  readonly currencies: FakeBrandingCurrencies;
  close(): Promise<void>;
}

export async function createBrandingTestApp(): Promise<BrandingTestApp> {
  const settings = new FakeBrandingSettings();
  const currencies = new FakeBrandingCurrencies();
  const logger = new SilentLogger();

  const moduleRef = await Test.createTestingModule({ imports: [EventsModule, BrandingModule] })
    .overrideModule(SettingsModule)
    .useModule(stubSettingsModule(settings))
    .overrideModule(CurrenciesModule)
    .useModule(stubCurrenciesModule(currencies))
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

  return { app, moduleRef, routes, settings, currencies, close: () => app.close() };
}
