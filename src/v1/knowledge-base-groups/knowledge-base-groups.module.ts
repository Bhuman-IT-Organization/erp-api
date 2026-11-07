import { Module } from '@nestjs/common';
import { KnowledgeBaseGroupsController } from './controller/knowledge-base-groups.controller.js';
import { KnowledgeBaseGroupsFacade } from './facade/knowledge-base-groups.facade.js';
import { KnowledgeBaseGroupsRepository } from './repository/knowledge-base-groups.repository.js';
import { KnowledgeBaseGroupsService } from './service/knowledge-base-groups.service.js';
import { KnowledgeBaseGroupsTransformer } from './service/knowledge-base-groups.transformer.js';
import { KnowledgeBaseGroupsTransport } from './service/knowledge-base-groups.transport.js';
import { KnowledgeBaseGroupsValidator } from './service/knowledge-base-groups.validator.js';

@Module({
  controllers: [KnowledgeBaseGroupsController],
  providers: [
    KnowledgeBaseGroupsService,
    KnowledgeBaseGroupsValidator,
    KnowledgeBaseGroupsTransformer,
    KnowledgeBaseGroupsTransport,
    KnowledgeBaseGroupsRepository,
    KnowledgeBaseGroupsFacade,
  ],
  exports: [KnowledgeBaseGroupsFacade],
})
export class KnowledgeBaseGroupsModule {}
