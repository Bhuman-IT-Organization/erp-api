import { Module } from '@nestjs/common';
import { PredefinedRepliesController } from './controller/predefined-replies.controller.js';
import { PredefinedRepliesFacade } from './facade/predefined-replies.facade.js';
import { PredefinedRepliesRepository } from './repository/predefined-replies.repository.js';
import { PredefinedRepliesService } from './service/predefined-replies.service.js';
import { PredefinedRepliesTransport } from './service/predefined-replies.transport.js';
import { PredefinedRepliesTransformer } from './service/predefined-replies.transformer.js';
import { PredefinedRepliesValidator } from './service/predefined-replies.validator.js';

@Module({
  controllers: [PredefinedRepliesController],
  providers: [
    PredefinedRepliesRepository,
    PredefinedRepliesService,
    PredefinedRepliesValidator,
    PredefinedRepliesTransport,
    PredefinedRepliesTransformer,
    PredefinedRepliesFacade,
  ],
  exports: [PredefinedRepliesFacade],
})
export class PredefinedRepliesModule {}
