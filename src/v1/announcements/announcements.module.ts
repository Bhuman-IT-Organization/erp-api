/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module.
 * The guards on the controller resolve `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the
 * transport resolves `SettingsFacade` from the imported `SettingsModule` (Perfex's
 * `default_timezone`); the repository resolves `PrismaService` from `DbModule`.
 */
import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { SettingsModule } from '../settings/settings.module.js';
import { AnnouncementsController } from './controller/announcements.controller.js';
import { AnnouncementsFacade } from './facade/announcements.facade.js';
import { AnnouncementsRepository } from './repository/announcements.repository.js';
import { AnnouncementsService } from './service/announcements.service.js';
import { AnnouncementsTransformer } from './service/announcements.transformer.js';
import { AnnouncementsTransport } from './service/announcements.transport.js';
import { AnnouncementsValidator } from './service/announcements.validator.js';

@Module({
  imports: [IdentityModule, SettingsModule],
  controllers: [AnnouncementsController],
  providers: [
    AnnouncementsService,
    AnnouncementsValidator,
    AnnouncementsTransformer,
    AnnouncementsRepository,
    AnnouncementsTransport,
    AnnouncementsFacade,
  ],
  exports: [AnnouncementsFacade],
})
export class AnnouncementsModule {}
