/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module
 * (BE-20): a sending module imports `MailModule` and injects `MailFacade`. The repository resolves
 * `PrismaService` from `DbModule`; the state store resolves `RedisService` from the global `CacheModule`.
 * `BrandingModule` is imported for `BrandingFacade` (the brand every email carries, D-04), the
 * `auth.module.ts` form of a module edge; `IdentityModule` for `IdentityFacade.contactOf` (a
 * member's address and locale, PATTERNS M1). `QueueService` and the email port come from the global
 * `QueueModule` and `IntegrationsModule`. The three processors register with the queue in both
 * processes (`BaseProcessor.onModuleInit`, 04.2-04); only the worker runs them.
 */
import { Module } from '@nestjs/common';
import { BrandingModule } from '../branding/branding.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { StorageModule } from '../../shared/storage/storage.module.js';
import { MailController } from './controller/mail.controller.js';
import { MailFacade } from './facade/mail.facade.js';
import { MailPurgeProcessor } from './jobs/mail-purge.processor.js';
import { MailSendProcessor } from './jobs/mail-send.processor.js';
import { MailSweepProcessor } from './jobs/mail-sweep.processor.js';
import { MAIL_STATE_STORE } from './repository/mail-state.store.js';
import { MailRepository } from './repository/mail.repository.js';
import { RedisMailStateStore } from './repository/redis-mail-state.store.js';
import { MailTemplateRegistry } from './service/mail-template.registry.js';
import { MailService } from './service/mail.service.js';
import { MailTransformer } from './service/mail.transformer.js';
import { MailTransport } from './service/mail.transport.js';
import { MailValidator } from './service/mail.validator.js';

@Module({
  imports: [BrandingModule, IdentityModule, StorageModule],
  controllers: [MailController],
  providers: [
    MailService,
    MailTemplateRegistry,
    MailValidator,
    MailTransformer,
    MailTransport,
    MailRepository,
    MailFacade,
    MailSendProcessor,
    MailSweepProcessor,
    MailPurgeProcessor,
    { provide: MAIL_STATE_STORE, useClass: RedisMailStateStore },
  ],
  exports: [MailFacade],
})
export class MailModule {}
