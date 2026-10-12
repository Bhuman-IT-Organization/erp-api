/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module:
 * among `src/v1/**` only `auth` is one. The repository resolves `PrismaService` from `DbModule`.
 *
 * The one facade-only module (D-23, by name in `src/v1/__tests__/module-shape.spec.ts`): no
 * controller, no routes, no DTO for HTTP, no events and no owned table, so no `<m>.routes.ts`,
 * `controller/`, `dto/` or `events/`. Written by hand, not copied from erp-docs `05-templates/backend-module`.
 */
import { Module } from '@nestjs/common';
import { SettingsFacade } from './facade/settings.facade.js';
import { SettingsRepository } from './repository/settings.repository.js';
import { SettingsService } from './service/settings.service.js';

@Module({
  providers: [SettingsService, SettingsRepository, SettingsFacade],
  exports: [SettingsFacade],
})
export class SettingsModule {}
