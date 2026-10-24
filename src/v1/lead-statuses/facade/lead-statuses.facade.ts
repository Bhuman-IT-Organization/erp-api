import { Injectable } from '@nestjs/common';

import type { LeadStatus } from '../model/lead-statuses.model.js';

import {
  LeadStatusesService,
  type LeadStatusesDescription,
} from '../service/lead-statuses.service.js';

/**
 * Public read-only interface for other ERP modules.
 */
@Injectable()
export class LeadStatusesFacade {
  constructor(private readonly service: LeadStatusesService) {}

  /** Return module information. */
  describe(): LeadStatusesDescription {
    return this.service.describe();
  }

  /** Find a lead status by ID. */
  findById(id: number): Promise<LeadStatus | null> {
    return this.service.findById(id);
  }

  /** Return all lead statuses. */
  listAll(): Promise<readonly LeadStatus[]> {
    return this.service.listAll();
  }

  /** Find multiple lead statuses by their IDs. */
  findByIds(ids: readonly number[]): Promise<readonly LeadStatus[]> {
    return this.service.findByIds(ids);
  }
}
