/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module:
 * among `src/v1/**` only `auth` is one (its facade is the verifier every guard resolves; the
 * module-shape spec rejects the decorator anywhere else). The guards on the controller resolve
 * `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the transport resolves
 * `DOMAIN_EVENT_PUBLISHER` from the global `EventsModule`; the repository resolves `PrismaService`
 * from `DbModule`. Copy this module (or erp-docs `05-templates/backend-module`) instead of
 * designing a new shape.
 */
import { Module } from '@nestjs/common';
import { ExpenseCategoriesController } from './controller/expense-categories.controller.js';
import { ExpenseCategoriesFacade } from './facade/expense-categories.facade.js';
import { ExpenseCategoriesRepository } from './repository/expense-categories.repository.js';
import { ExpenseCategoriesService } from './service/expense-categories.service.js';
import { ExpenseCategoriesTransformer } from './service/expense-categories.transformer.js';
import { ExpenseCategoriesTransport } from './service/expense-categories.transport.js';
import { ExpenseCategoriesValidator } from './service/expense-categories.validator.js';

@Module({
  controllers: [ExpenseCategoriesController],
  providers: [
    ExpenseCategoriesService,
    ExpenseCategoriesValidator,
    ExpenseCategoriesTransformer,
    ExpenseCategoriesTransport,
    ExpenseCategoriesRepository,
    ExpenseCategoriesFacade,
  ],
  exports: [ExpenseCategoriesFacade],
})
export class ExpenseCategoriesModule {}
