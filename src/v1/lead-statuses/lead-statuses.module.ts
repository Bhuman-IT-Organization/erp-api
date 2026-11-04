import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';

import { LeadStatusesController } from './controller/lead-statuses.controller.js';
import { LeadStatusesFacade } from './facade/lead-statuses.facade.js';
import { LeadStatusesRepository } from './repository/lead-statuses.repository.js';
import { LeadStatusesService } from './service/lead-statuses.service.js';
import { LeadStatusesTransformer } from './service/lead-statuses.transformer.js';
import { LeadStatusesTransport } from './service/lead-statuses.transport.js';
import { LeadStatusesValidator } from './service/lead-statuses.validator.js';

@Module({
  imports: [SettingsModule],
  controllers: [LeadStatusesController],
  providers: [
    LeadStatusesService,
    LeadStatusesValidator,
    LeadStatusesTransformer,
    LeadStatusesTransport,
    LeadStatusesRepository,
    LeadStatusesFacade,
  ],
  exports: [LeadStatusesFacade],
})
export class LeadStatusesModule {}
