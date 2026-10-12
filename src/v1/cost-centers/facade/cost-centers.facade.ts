/**
 * Facade: the ONLY surface other modules may import (ADR-0001; the architecture block in
 * `eslint.config.mjs` rejects a deeper path). It hands out `CostCenter { id, name }`, never the wire
 * DTO and never `created_by`, and replacing it with an HTTP or queue adapter is what makes
 * extraction to a service atomic.
 *
 * Read only: no method writes, and none asserts the administrator flag, because a module-to-module
 * read has no actor. The purchase, expenses and fixed_equipment migrations read it: `listAll` for a
 * cost center picker, `findByIds` for the names a document's ids point at.
 */
import { Injectable } from '@nestjs/common';
import type { CostCenter } from '../model/cost-centers.model.js';
import {
  CostCentersService,
  type CostCentersDescription,
} from '../service/cost-centers.service.js';

/** What other modules may call: the module's description and three read-only lookups. */
@Injectable()
export class CostCentersFacade {
  constructor(private readonly service: CostCentersService) {}

  describe(): CostCentersDescription {
    return this.service.describe();
  }

  /** One cost center, or `null` when the id is missing. */
  findById(id: number): Promise<CostCenter | null> {
    return this.service.findById(id);
  }

  /**
   * Every cost center, the name ascending, then the id (the order Perfex's pickers read); refused
   * loudly above `COST_CENTERS_FACADE_MAX_ROWS`, never truncated.
   */
  listAll(): Promise<readonly CostCenter[]> {
    return this.service.listAll();
  }

  /** The cost centers with these ids, in the order given, each once; an absent id is skipped. */
  findByIds(ids: readonly number[]): Promise<readonly CostCenter[]> {
    return this.service.findByIds(ids);
  }
}
