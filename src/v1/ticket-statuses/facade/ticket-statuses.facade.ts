import { Injectable } from '@nestjs/common';
import type { TicketStatus } from '../model/ticket-statuses.model.js';
import { TicketStatusesService } from '../service/ticket-statuses.service.js';

/** Read-only module boundary for code that needs the available ticket statuses. */
@Injectable()
export class TicketStatusesFacade {
  constructor(private readonly service: TicketStatusesService) {}

  findById(id: number): Promise<TicketStatus | null> {
    return this.service.findById(id);
  }

  listAll(): Promise<readonly TicketStatus[]> {
    return this.service.listAll();
  }
}
