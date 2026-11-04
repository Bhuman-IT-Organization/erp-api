import { Module } from '@nestjs/common';
import { EstimateRequestStatusesController } from './controller/estimate-request-statuses.controller.js';
import { EstimateRequestStatusesFacade } from './facade/estimate-request-statuses.facade.js';
import { EstimateRequestStatusesRepository } from './repository/estimate-request-statuses.repository.js';
import { EstimateRequestStatusesService } from './service/estimate-request-statuses.service.js';
import { EstimateRequestStatusesTransformer } from './service/estimate-request-statuses.transformer.js';
import { EstimateRequestStatusesTransport } from './service/estimate-request-statuses.transport.js';
import { EstimateRequestStatusesValidator } from './service/estimate-request-statuses.validator.js';

@Module({
  controllers: [EstimateRequestStatusesController],
  providers: [
    EstimateRequestStatusesService,
    EstimateRequestStatusesValidator,
    EstimateRequestStatusesTransformer,
    EstimateRequestStatusesTransport,
    EstimateRequestStatusesRepository,
    EstimateRequestStatusesFacade,
  ],
  exports: [EstimateRequestStatusesFacade],
})
export class EstimateRequestStatusesModule {}
