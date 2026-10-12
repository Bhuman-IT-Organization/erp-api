/**
 * The branding module against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env):
 * `GET /api/v1/branding` through Fastify `inject` on the real path, its transport, the settings
 * module's facade, service and repository and the currencies module's facade, service and
 * repository, all on this spec's own `PrismaService`; and `CurrenciesFacade.baseCurrency()`, the read
 * branding moved onto (D-44), equal to a direct read of the first `isdefault` row by id. Branding
 * owns no table (Currencies planning answer 5), so this spec replaces its repository int spec.
 * Read-only. The mirror holds the customer's data, so every assertion is on SHAPE or on ids only:
 * no value read from it appears in this file or in its output.
 */
import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { DbModule } from '../../../shared/db/db.module.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { EventsModule } from '../../../shared/events/events.module.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../../shared/http/api-prefix.js';
import { ACCESS_TOKEN_VERIFIER } from '../../../shared/http/auth/access-token-verifier.js';
import { LoggerModule } from '../../../shared/logger/logger.module.js';
import { CurrenciesFacade } from '../../currencies/index.js';
import { BrandingModule } from '../branding.module.js';
import { BRANDING_ROUTES } from '../branding.routes.js';
import { brandingResponseSchema } from '../dto/branding.dto.js';

/**
 * The verifier the currencies controller's guards resolve at boot (`AuthModule` gives it in the
 * app); this spec sends no request to a guarded route, so it admits nobody.
 */
@Global()
@Module({
  providers: [
    {
      provide: ACCESS_TOKEN_VERIFIER,
      useValue: {
        verifyAccessToken: () => Promise.resolve(null),
        hasPermission: () => Promise.resolve(false),
      },
    },
  ],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class NoVerifierModule {}

describe.skipIf(!process.env.DATABASE_URL)('branding against the local mirror', () => {
  const service = new PrismaService(new AppConfig(), new HealthService());
  let moduleRef: TestingModule;
  let app: NestFastifyApplication;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [DbModule, LoggerModule, EventsModule, NoVerifierModule, BrandingModule],
    })
      .overrideProvider(PrismaService)
      .useValue(service)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    app.setGlobalPrefix(API_PREFIX, { exclude: [...UNPREFIXED_ROUTES] });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
    await service.client.$disconnect();
  });

  it('GET /api/v1/branding through the module and the real settings and currencies paths answers a formats object that parses (shape only)', async () => {
    const res = await app.inject({ method: 'GET', url: `/${API_PREFIX}/${BRANDING_ROUTES.base}` });
    expect(res.statusCode).toBe(200);
    const { formats } = brandingResponseSchema.parse(JSON.parse(res.payload));
    expect(formats.decimalPlaces).toBe(2);
    expect(formats.thousandSeparator).not.toBe(formats.decimalSeparator);
    expect(formats.timeZone === null || typeof formats.timeZone === 'string').toBe(true);
    if (formats.currency !== null) {
      expect(formats.currency.thousandSeparator).not.toBe(formats.currency.decimalSeparator);
    }
  });

  it('D-44: CurrenciesFacade.baseCurrency() is the first isdefault row by id (ids compared, nothing printed)', async () => {
    const base = await moduleRef.get(CurrenciesFacade, { strict: false }).baseCurrency();
    const direct = await service.client.tblcurrencies.findFirst({
      where: { isdefault: true },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    expect(base === null).toBe(direct === null);
    expect(base?.id).toBe(direct?.id);
    if (base !== null) {
      expect(base.isBase).toBe(true);
      expect(Object.keys(base).sort()).toEqual([
        'decimalSeparator',
        'id',
        'isBase',
        'name',
        'placement',
        'symbol',
        'thousandSeparator',
      ]);
    }
  });
});
