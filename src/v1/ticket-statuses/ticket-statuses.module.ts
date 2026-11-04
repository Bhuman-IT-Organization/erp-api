import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { TicketStatusesController } from './controller/ticket-statuses.controller.js';
import { TicketStatusesFacade } from './facade/ticket-statuses.facade.js';
import { TicketStatusesRepository } from './repository/ticket-statuses.repository.js';
import { TicketStatusesService } from './service/ticket-statuses.service.js';
import { TicketStatusesTransformer } from './service/ticket-statuses.transformer.js';
import { TicketStatusesTransport } from './service/ticket-statuses.transport.js';
import { TicketStatusesValidator } from './service/ticket-statuses.validator.js';

@Module({
  imports: [SettingsModule],
  controllers: [TicketStatusesController],
  providers: [
    TicketStatusesService,
    TicketStatusesValidator,
    TicketStatusesTransformer,
    TicketStatusesTransport,
    TicketStatusesRepository,
    TicketStatusesFacade,
  ],
  exports: [TicketStatusesFacade],
})
export class TicketStatusesModule {}
