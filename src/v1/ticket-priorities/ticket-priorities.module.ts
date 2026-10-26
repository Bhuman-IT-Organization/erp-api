import { Module } from '@nestjs/common';
import { TicketPrioritiesController } from './controller/ticket-priorities.controller.js';
import { TicketPrioritiesService } from './service/ticket-priorities.service.js';
import { TicketPrioritiesRepository } from './repository/ticket-priorities.repository.js';
import { SettingsModule } from '../settings/settings.module.js';

@Module({
  imports: [SettingsModule],
  controllers: [TicketPrioritiesController],
  providers: [TicketPrioritiesService, TicketPrioritiesRepository],
  exports: [TicketPrioritiesService],
})
export class TicketPrioritiesModule {}
