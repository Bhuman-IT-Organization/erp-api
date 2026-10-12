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
import { CostCentersController } from './controller/cost-centers.controller.js';
import { CostCentersFacade } from './facade/cost-centers.facade.js';
import { CostCentersRepository } from './repository/cost-centers.repository.js';
import { CostCentersService } from './service/cost-centers.service.js';
import { CostCentersTransformer } from './service/cost-centers.transformer.js';
import { CostCentersTransport } from './service/cost-centers.transport.js';
import { CostCentersValidator } from './service/cost-centers.validator.js';

@Module({
  imports: [SettingsModule],
  controllers: [CostCentersController],
  providers: [
    CostCentersService,
    CostCentersValidator,
    CostCentersTransformer,
    CostCentersTransport,
    CostCentersRepository,
    CostCentersFacade,
  ],
  exports: [CostCentersFacade],
})
export class CostCentersModule {}
