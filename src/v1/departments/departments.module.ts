/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module:
 * among `src/v1/**` only `auth` is one (its facade is the verifier every guard resolves; the
 * module-shape spec rejects the decorator anywhere else). The guards on the controller resolve
 * `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the repository resolves `PrismaService`
 * from `DbModule`. No transport: the module only reads, so it publishes no event.
 *
 * No v1 module in `imports` (D-51, D-55; the Currencies precedent): identity registers its
 * staff-member counter and the staff directory in `DepartmentLinksRegistry` through the exported
 * `DepartmentsFacade`, so identity may import this module with no cycle.
 */
import { Module } from '@nestjs/common';
import { DepartmentsController } from './controller/departments.controller.js';
import { DepartmentsFacade } from './facade/departments.facade.js';
import { DepartmentsRepository } from './repository/departments.repository.js';
import { DepartmentLinksRegistry } from './service/department-links.registry.js';
import { DepartmentsService } from './service/departments.service.js';
import { DepartmentsTransformer } from './service/departments.transformer.js';
import { DepartmentsValidator } from './service/departments.validator.js';

@Module({
  controllers: [DepartmentsController],
  providers: [
    DepartmentsService,
    DepartmentsValidator,
    DepartmentsTransformer,
    DepartmentsRepository,
    DepartmentLinksRegistry,
    DepartmentsFacade,
  ],
  exports: [DepartmentsFacade],
})
export class DepartmentsModule {}
