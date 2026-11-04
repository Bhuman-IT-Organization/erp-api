import { Injectable } from '@nestjs/common';
import type { EstimateRequestStatusRow } from '../model/estimate-request-statuses.model.js';
import { EstimateRequestStatusesService } from '../service/estimate-request-statuses.service.js';

/** Read-only module boundary for estimate request statuses. */
@Injectable()
export class EstimateRequestStatusesFacade {
  constructor(private readonly service: EstimateRequestStatusesService) {}

  describe(): { readonly module: 'estimate-request-statuses'; readonly version: 1 } {
    return this.service.describe();
  }

  findById(id: number): Promise<EstimateRequestStatusRow | null> {
    return this.service.findById(id);
  }

  listAll(): Promise<readonly EstimateRequestStatusRow[]> {
    return this.service.listAll();
  }
}
