import { Injectable } from '@nestjs/common';
import { TicketPrioritiesRepository } from '../repository/ticket-priorities.repository.js';
import type { TicketPriority } from '../model/ticket-priority.model.js'; // Ensure this model file exists

/**
 * Facade for Ticket Priorities.
 */
@Injectable()
export class TicketPrioritiesFacade {
  constructor(private readonly repository: TicketPrioritiesRepository) {}

  async findAll(): Promise<TicketPriority[]> {
    return this.repository.findAll();
  }

  async findById(id: number): Promise<TicketPriority | null> {
    return this.repository.findById(id);
  }
}
