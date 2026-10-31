import { Injectable } from '@nestjs/common';
import type { FixedEquipmentDepreciation } from '../model/fixed-equipment-depreciations.model.js';
import { FixedEquipmentDepreciationsService } from '../service/fixed-equipment-depreciations.service.js';

/**
 * The module's public face for other modules: reads depreciations through the service and returns
 * the model (`{ id, name, term, creatorId }`), whoever created them.
 */
@Injectable()
export class FixedEquipmentDepreciationsFacade {
  constructor(private readonly service: FixedEquipmentDepreciationsService) {}

  /** Every depreciation, the name ascending. */
  findAll(): Promise<readonly FixedEquipmentDepreciation[]> {
    return this.service.listAll();
  }

  findById(id: number): Promise<FixedEquipmentDepreciation | null> {
    return this.service.findById(id);
  }
}
