/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module:
 * among `src/v1/**` only `auth` is one (its facade is the verifier every guard resolves; the
 * module-shape spec rejects the decorator anywhere else). The guards on the controller resolve
 * `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the transport resolves
 * `DOMAIN_EVENT_PUBLISHER` from the global `EventsModule` and `SettingsFacade` from the imported
 * `SettingsModule` (Perfex's `expense_credit_payment_mode`, D-37); the repository resolves
 * `PrismaService` from `DbModule`.
 */
import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module.js';
import { PaymentModesController } from './controller/payment-modes.controller.js';
import { PaymentModesFacade } from './facade/payment-modes.facade.js';
import { PaymentModesRepository } from './repository/payment-modes.repository.js';
import { PaymentModesService } from './service/payment-modes.service.js';
import { PaymentModesTransformer } from './service/payment-modes.transformer.js';
import { PaymentModesTransport } from './service/payment-modes.transport.js';
import { PaymentModesValidator } from './service/payment-modes.validator.js';

@Module({
  imports: [SettingsModule],
  controllers: [PaymentModesController],
  providers: [
    PaymentModesService,
    PaymentModesValidator,
    PaymentModesTransformer,
    PaymentModesTransport,
    PaymentModesRepository,
    PaymentModesFacade,
  ],
  exports: [PaymentModesFacade],
})
export class PaymentModesModule {}
