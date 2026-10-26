import { Module } from '@nestjs/common';
import { ServicesController } from './controller/services.controller.js';
import { ServicesFacade } from './facade/services.facade.js';
import { ServicesRepository } from './repository/services.repository.js';
import { ServicesService } from './service/services.service.js';
import { ServicesTransformer } from './service/services.transformer.js';
import { ServicesTransport } from './service/services.transport.js';
import { ServicesValidator } from './service/services.validator.js';

@Module({
  controllers: [ServicesController],
  providers: [
    ServicesService,
    ServicesValidator,
    ServicesTransformer,
    ServicesTransport,
    ServicesRepository,
    ServicesFacade,
  ],
  exports: [ServicesFacade],
})
export class ServicesModule {}
