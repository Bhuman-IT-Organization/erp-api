import { Injectable } from '@nestjs/common';
import { TicketPrioritiesService } from '../service/ticket-priorities.service.js';
import type { TicketPriority } from '../model/ticket-priority.model.js';
/** The module's public face for other modules: reads priorities through the service and returns `{ id, name }`. */
@Injectable()
export class TicketPrioritiesFacade {
  constructor(private readonly service: TicketPrioritiesService) {}

  findAll(): Promise<readonly TicketPriority[]> {
    return this.service.listAll();
  }

  findById(id: number): Promise<TicketPriority | null> {
    return this.service.findById(id);
  }
}
