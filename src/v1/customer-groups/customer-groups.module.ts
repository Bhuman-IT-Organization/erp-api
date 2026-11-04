/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module.
 * The guards on the controller resolve `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the
 * repository resolves `PrismaService` from `DbModule`.
 */
import { Module } from '@nestjs/common';
import { CustomerGroupsController } from './controller/customer-groups.controller.js';
import { CustomerGroupsFacade } from './facade/customer-groups.facade.js';
import { CustomerGroupsRepository } from './repository/customer-groups.repository.js';
import { CustomerGroupsService } from './service/customer-groups.service.js';
import { CustomerGroupsTransformer } from './service/customer-groups.transformer.js';
import { CustomerGroupsTransport } from './service/customer-groups.transport.js';
import { CustomerGroupsValidator } from './service/customer-groups.validator.js';

@Module({
  controllers: [CustomerGroupsController],
  providers: [
    CustomerGroupsService,
    CustomerGroupsValidator,
    CustomerGroupsTransformer,
    CustomerGroupsRepository,
    CustomerGroupsTransport,
    CustomerGroupsFacade,
  ],
  exports: [CustomerGroupsFacade],
})
export class CustomerGroupsModule {}
