/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module:
 * among `src/v1/**` only `auth` is one (its facade is the verifier every guard resolves; the
 * module-shape spec rejects the decorator anywhere else). The guards on the controller resolve
 * `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the transport resolves
 * `DOMAIN_EVENT_PUBLISHER` from the global `EventsModule` and `SettingsFacade` from the imported
 * `SettingsModule` (Perfex's `default_timezone`, D-31); the repository resolves `PrismaService` from
 * `DbModule`.
 */
import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { ContractTypesController } from './controller/contract-types.controller.js';
import { ContractTypesFacade } from './facade/contract-types.facade.js';
import { ContractTypesRepository } from './repository/contract-types.repository.js';
import { ContractTypesService } from './service/contract-types.service.js';
import { ContractTypesTransformer } from './service/contract-types.transformer.js';
import { ContractTypesTransport } from './service/contract-types.transport.js';
import { ContractTypesValidator } from './service/contract-types.validator.js';

@Module({
  imports: [SettingsModule],
  controllers: [ContractTypesController],
  providers: [
    ContractTypesService,
    ContractTypesValidator,
    ContractTypesTransformer,
    ContractTypesTransport,
    ContractTypesRepository,
    ContractTypesFacade,
  ],
  exports: [ContractTypesFacade],
})
export class ContractTypesModule {}
