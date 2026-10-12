/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module:
 * among `src/v1/**` only `auth` is one (its facade is the verifier every guard resolves; the
 * module-shape spec rejects the decorator anywhere else). The guards on the controller resolve
 * `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the transport resolves
 * `DOMAIN_EVENT_PUBLISHER` from the global `EventsModule`; the repository resolves `PrismaService`
 * from `DbModule`. Copy this module (or erp-docs `05-templates/backend-module`) instead of
 * designing a new shape.
 */
import { Module } from '@nestjs/common';
import { TaxesController } from './controller/taxes.controller.js';
import { TaxesFacade } from './facade/taxes.facade.js';
import { TaxesRepository } from './repository/taxes.repository.js';
import { TaxesService } from './service/taxes.service.js';
import { TaxesTransformer } from './service/taxes.transformer.js';
import { TaxesTransport } from './service/taxes.transport.js';
import { TaxesValidator } from './service/taxes.validator.js';

@Module({
  controllers: [TaxesController],
  providers: [
    TaxesService,
    TaxesValidator,
    TaxesTransformer,
    TaxesTransport,
    TaxesRepository,
    TaxesFacade,
  ],
  exports: [TaxesFacade],
})
export class TaxesModule {}
