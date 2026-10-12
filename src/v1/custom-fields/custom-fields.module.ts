/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module:
 * among `src/v1/**` only `auth` is one (its facade is the verifier every guard resolves; the
 * module-shape spec rejects the decorator anywhere else). The guards on the controller resolve
 * `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the repository resolves `PrismaService`
 * from `DbModule`. No transport: the module publishes no event and makes no outbound call.
 */
import { Module } from '@nestjs/common';
import { CustomFieldsController } from './controller/custom-fields.controller.js';
import { CustomFieldsFacade } from './facade/custom-fields.facade.js';
import { CustomFieldsRepository } from './repository/custom-fields.repository.js';
import { CustomFieldsService } from './service/custom-fields.service.js';
import { CustomFieldsTransformer } from './service/custom-fields.transformer.js';
import { CustomFieldsValidator } from './service/custom-fields.validator.js';

@Module({
  controllers: [CustomFieldsController],
  providers: [
    CustomFieldsService,
    CustomFieldsValidator,
    CustomFieldsTransformer,
    CustomFieldsRepository,
    CustomFieldsFacade,
  ],
  exports: [CustomFieldsFacade],
})
export class CustomFieldsModule {}
