/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module:
 * among `src/v1/**` only `auth` is one (its facade is the verifier every guard resolves; the
 * module-shape spec rejects the decorator anywhere else). The guards on the controller resolve
 * `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the transport resolves
 * `DOMAIN_EVENT_PUBLISHER` from the global `EventsModule`; the repository resolves `PrismaService` from
 * `DbModule`.
 */
import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { LeadSourcesController } from './controller/lead-sources.controller.js';
import { LeadSourcesFacade } from './facade/lead-sources.facade.js';
import { LeadSourcesRepository } from './repository/lead-sources.repository.js';
import { LeadSourcesService } from './service/lead-sources.service.js';
import { LeadSourcesTransformer } from './service/lead-sources.transformer.js';
import { LeadSourcesTransport } from './service/lead-sources.transport.js';
import { LeadSourcesValidator } from './service/lead-sources.validator.js';

@Module({
  imports: [SettingsModule],
  controllers: [LeadSourcesController],
  providers: [
    LeadSourcesService,
    LeadSourcesValidator,
    LeadSourcesTransformer,
    LeadSourcesTransport,
    LeadSourcesRepository,
    LeadSourcesFacade,
  ],
  exports: [LeadSourcesFacade],
})
export class LeadSourcesModule {}
