/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module:
 * among `src/v1/**` only `auth` is one (its facade is the verifier every guard resolves; the
 * module-shape spec rejects the decorator anywhere else). The guards on the controller resolve
 * `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the transport resolves
 * `DOMAIN_EVENT_PUBLISHER` from the global `EventsModule`; the repository resolves `PrismaService`
 * from `DbModule`.
 *
 * No v1 module in `imports` (Currencies planning answer 4): another module that counts its own rows
 * naming a currency registers a counter in `CurrencyUsageRegistry` through the exported
 * `CurrenciesFacade`, so the modules that import this one (branding) create no cycle.
 */
import { Module } from '@nestjs/common';
import { CurrenciesController } from './controller/currencies.controller.js';
import { CurrenciesFacade } from './facade/currencies.facade.js';
import { CurrenciesRepository } from './repository/currencies.repository.js';
import { CurrenciesService } from './service/currencies.service.js';
import { CurrenciesTransformer } from './service/currencies.transformer.js';
import { CurrenciesTransport } from './service/currencies.transport.js';
import { CurrenciesValidator } from './service/currencies.validator.js';
import { CurrencyUsageRegistry } from './service/currency-usage.registry.js';

@Module({
  controllers: [CurrenciesController],
  providers: [
    CurrenciesService,
    CurrenciesValidator,
    CurrenciesTransformer,
    CurrenciesTransport,
    CurrenciesRepository,
    CurrencyUsageRegistry,
    CurrenciesFacade,
  ],
  exports: [CurrenciesFacade],
})
export class CurrenciesModule {}
