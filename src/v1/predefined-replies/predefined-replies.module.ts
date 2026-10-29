import { Module } from '@nestjs/common';
import { LoggerService } from '../../shared/logger/logger.service.js';
import { PredefinedRepliesController } from './controller/predefined-replies.controller.js';
import { PredefinedRepliesFacade } from './facade/predefined-replies.facade.js';
import { PredefinedRepliesRepository } from './repository/predefined-replies.repository.js';
import { PredefinedRepliesService } from './service/predefined-replies.service.js';
import { PredefinedRepliesTransport } from './service/predefined-replies.transport.js';
import { PredefinedRepliesValidator } from './service/predefined-replies.validator.js';

@Module({
  controllers: [PredefinedRepliesController],
  providers: [
    LoggerService,
    PredefinedRepliesRepository,
    PredefinedRepliesService,
    PredefinedRepliesValidator,
    PredefinedRepliesTransport,
    PredefinedRepliesFacade,
  ],
  exports: [PredefinedRepliesFacade],
})
export class PredefinedRepliesModule {}
