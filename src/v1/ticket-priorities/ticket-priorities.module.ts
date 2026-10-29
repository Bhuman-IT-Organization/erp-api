import { Module } from '@nestjs/common';
import { TicketPrioritiesController } from './controller/ticket-priorities.controller.js';
import { TicketPrioritiesFacade } from './facade/ticket-priorities.facade.js';
import { TicketPrioritiesRepository } from './repository/ticket-priorities.repository.js';
import { TicketPrioritiesService } from './service/ticket-priorities.service.js';
import { TicketPrioritiesTransformer } from './service/ticket-priorities.transformer.js';
import { TicketPrioritiesTransport } from './service/ticket-priorities.transport.js';
import { TicketPrioritiesValidator } from './service/ticket-priorities.validator.js';
import { SettingsModule } from '../settings/settings.module.js';

@Module({
  imports: [SettingsModule],
  controllers: [TicketPrioritiesController],
  providers: [
    TicketPrioritiesService,
    TicketPrioritiesValidator,
    TicketPrioritiesRepository,
    TicketPrioritiesTransformer,
    TicketPrioritiesTransport,
    TicketPrioritiesFacade,
  ],
  exports: [TicketPrioritiesFacade],
})
export class TicketPrioritiesModule {}
