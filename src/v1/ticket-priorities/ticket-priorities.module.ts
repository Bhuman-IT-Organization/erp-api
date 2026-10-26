import { Module } from '@nestjs/common';
import { TicketPrioritiesController } from './controller/ticket-priorities.controller.js';
import { TicketPrioritiesService } from './service/ticket-priorities.service.js';
import { TicketPrioritiesRepository } from './repository/ticket-priorities.repository.js';
import { TicketPrioritiesFacade } from './facade/ticket-priorities.facade.js';
import { SettingsModule } from '../settings/settings.module.js';

@Module({
  imports: [SettingsModule], // the module that provides and exports SettingsFacade
  controllers: [TicketPrioritiesController],
  providers: [TicketPrioritiesService, TicketPrioritiesRepository, TicketPrioritiesFacade],
  exports: [TicketPrioritiesFacade],
})
export class TicketPrioritiesModule {}
