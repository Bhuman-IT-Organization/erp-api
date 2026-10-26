import { Module } from '@nestjs/common';
import { PredefinedRepliesController } from './controller/predefined-replies.controller.js';
import { PredefinedRepliesRepository } from './repository/predefined-replies.repository.js';
import { PredefinedRepliesService } from './service/predefined-replies.service.js';
import { PredefinedRepliesValidator } from './service/predefined-replies.validator.js';

@Module({
  controllers: [PredefinedRepliesController],
  providers: [PredefinedRepliesRepository, PredefinedRepliesService, PredefinedRepliesValidator],
  exports: [PredefinedRepliesService],
})
export class PredefinedRepliesModule {}
