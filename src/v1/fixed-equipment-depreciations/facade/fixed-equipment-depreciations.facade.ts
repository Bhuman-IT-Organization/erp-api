import { Injectable } from '@nestjs/common';
import type {
  FixedEquipmentDepreciation,
  FixedEquipmentDepreciationsDescription,
} from '../model/fixed-equipment-depreciations.model.js';
import { FixedEquipmentDepreciationsService } from '../service/fixed-equipment-depreciations.service.js';

/**
 * What other modules may ask of fixed-equipment-depreciations: module-to-module reads, no actor and
 * no scope (every owner's rows). Other modules import it from `../fixed-equipment-depreciations`.
 */
@Injectable()
export class FixedEquipmentDepreciationsFacade {
  constructor(private readonly service: FixedEquipmentDepreciationsService) {}

  describe(): FixedEquipmentDepreciationsDescription {
    return this.service.describe();
  }

  /** One depreciation by id, or null when there is none. */
  findById(id: number): Promise<FixedEquipmentDepreciation | null> {
    return this.service.findById(id);
  }

  /**
   * Every depreciation, the name ascending, then the id; refused loudly above the facade's maximum
   * of 1000 rows, never truncated.
   */
  listAll(): Promise<readonly FixedEquipmentDepreciation[]> {
    return this.service.listAll();
  }
}
