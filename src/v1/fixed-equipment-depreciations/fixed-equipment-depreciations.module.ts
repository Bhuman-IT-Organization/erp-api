import { Module } from '@nestjs/common';
import { FixedEquipmentDepreciationsController } from './controller/fixed-equipment-depreciations.controller.js';
import { FixedEquipmentDepreciationsFacade } from './facade/fixed-equipment-depreciations.facade.js';
import { FixedEquipmentDepreciationsRepository } from './repository/fixed-equipment-depreciations.repository.js';
import { FixedEquipmentDepreciationsService } from './service/fixed-equipment-depreciations.service.js';
import { FixedEquipmentDepreciationsTransformer } from './service/fixed-equipment-depreciations.transformer.js';
import { FixedEquipmentDepreciationsTransport } from './service/fixed-equipment-depreciations.transport.js';
import { FixedEquipmentDepreciationsValidator } from './service/fixed-equipment-depreciations.validator.js';

@Module({
  controllers: [FixedEquipmentDepreciationsController],
  providers: [
    FixedEquipmentDepreciationsService,
    FixedEquipmentDepreciationsValidator,
    FixedEquipmentDepreciationsRepository,
    FixedEquipmentDepreciationsTransformer,
    FixedEquipmentDepreciationsTransport,
    FixedEquipmentDepreciationsFacade,
  ],
  exports: [FixedEquipmentDepreciationsFacade],
})
export class FixedEquipmentDepreciationsModule {}
