/**
 * Module wiring: every layer is a provider; only the facade is exported. `SettingsModule` is
 * imported for `SettingsFacade` (the ten branding options, W2A-07) and `CurrenciesModule` for
 * `CurrenciesFacade` (the base currency, D-44), the `auth.module.ts` form of a module edge. No
 * repository: branding owns no table and reads none directly (Currencies planning answer 5). The
 * currencies-change handler resolves `DOMAIN_EVENT_SUBSCRIBER` from the global `EventsModule`.
 */
import { Module } from '@nestjs/common';
import { CurrenciesModule } from '../currencies/currencies.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { BrandingController } from './controller/branding.controller.js';
import { CurrenciesChangeEventHandler } from './events/handlers/currencies-change.handler.js';
import { BrandingFacade } from './facade/branding.facade.js';
import { BrandingService } from './service/branding.service.js';
import { BrandingTransformer } from './service/branding.transformer.js';
import { BrandingTransport } from './service/branding.transport.js';

@Module({
  imports: [SettingsModule, CurrenciesModule],
  controllers: [BrandingController],
  providers: [
    BrandingService,
    BrandingTransformer,
    BrandingTransport,
    CurrenciesChangeEventHandler,
    BrandingFacade,
  ],
  exports: [BrandingFacade],
})
export class BrandingModule {}
