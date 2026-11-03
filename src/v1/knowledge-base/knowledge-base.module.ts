/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module:
 * among `src/v1/**` only `auth` is one (its facade is the verifier every guard resolves; the
 * module-shape spec rejects the decorator anywhere else). The guards on the controller resolve
 * `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the transport resolves
 * `DOMAIN_EVENT_PUBLISHER` from the global `EventsModule` and `SettingsFacade` from the imported
 * `SettingsModule` (Perfex's `default_timezone`, D-31); the repository resolves `PrismaService` from
 * `DbModule`.
 */
import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { KnowledgeBaseController } from './controller/knowledge-base.controller.js';
import { KnowledgeBaseFacade } from './facade/knowledge-base.facade.js';
import { KnowledgeBaseRepository } from './repository/knowledge-base.repository.js';
import { KnowledgeBaseService } from './service/knowledge-base.service.js';
import { KnowledgeBaseTransformer } from './service/knowledge-base.transformer.js';
import { KnowledgeBaseTransport } from './service/knowledge-base.transport.js';
import { KnowledgeBaseValidator } from './service/knowledge-base.validator.js';

@Module({
  imports: [SettingsModule],
  controllers: [KnowledgeBaseController],
  providers: [
    KnowledgeBaseService,
    KnowledgeBaseValidator,
    KnowledgeBaseTransformer,
    KnowledgeBaseTransport,
    KnowledgeBaseRepository,
    KnowledgeBaseFacade,
  ],
  exports: [KnowledgeBaseFacade],
})
export class KnowledgeBaseModule {}
