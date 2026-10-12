/**
 * Module wiring: every layer is a provider; only the facade is exported. Never a global module:
 * among `src/v1/**` only `auth` is one (its facade is the verifier every guard resolves). The
 * guards on the controller resolve `ACCESS_TOKEN_VERIFIER` from the global `AuthModule`; the
 * transport resolves `DOMAIN_EVENT_PUBLISHER` from the global `EventsModule`; the two repositories
 * resolve `PrismaService` from `DbModule`.
 *
 * `IdentityAuditRepository` is a provider of its own beside `IdentityRepository` (ADR-0034 d.3):
 * the audit log is a second table with a different contract — append-only — and giving it its own
 * class is what makes "this module cannot edit its own audit trail" checkable rather than a habit.
 *
 * `DepartmentsModule` is imported for its facade (D-55): the member form's department picker and
 * the check of a member's new department ids read it through the transport, and
 * `IdentityDepartmentLinks` registers identity's staff-member counter and the staff directory with
 * it at init (D-51, D-49). Departments imports no v1 module, so the import runs one way only.
 */
import { Module } from '@nestjs/common';
import { DepartmentsModule } from '../departments/departments.module.js';
import { IdentityController } from './controller/identity.controller.js';
import { IdentityFacade } from './facade/identity.facade.js';
import { IdentityAuditRepository } from './repository/identity-audit.repository.js';
import { IdentityRepository } from './repository/identity.repository.js';
import { IdentityDepartmentLinks } from './service/identity-department-links.js';
import { IdentityEnricher } from './service/identity.enricher.js';
import { IdentityService } from './service/identity.service.js';
import { IdentityTransformer } from './service/identity.transformer.js';
import { IdentityTransport } from './service/identity.transport.js';
import { IdentityValidator } from './service/identity.validator.js';

@Module({
  imports: [DepartmentsModule],
  controllers: [IdentityController],
  providers: [
    IdentityService,
    IdentityValidator,
    IdentityEnricher,
    IdentityTransformer,
    IdentityTransport,
    IdentityRepository,
    IdentityAuditRepository,
    IdentityFacade,
    IdentityDepartmentLinks,
  ],
  exports: [IdentityFacade],
})
export class IdentityModule {}
