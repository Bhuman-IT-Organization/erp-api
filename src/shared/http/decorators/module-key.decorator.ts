/**
 * Names the switchable module a controller class belongs to (ADR-0042), read by
 * `ModuleEnabledGuard`. Put it on the CLASS with `@UseGuards(ModuleEnabledGuard)`, never on a
 * handler, so each handler's own guard list stays `[JwtAuthGuard, PermissionGuard]` (Phase 4.2 M6).
 *
 * `@ModuleOffNotFound()` (ADR-0051, opt-in) makes the class's switched-off module answer the generic
 * 404 `ERP-CORE-0004` instead of its 403, so an anonymous surface gives no oracle; every other class
 * keeps the 403.
 */
import { SetMetadata, type CustomDecorator } from '@nestjs/common';
import type { ModuleName } from '../../config/modules.js';

/** The metadata key `ModuleEnabledGuard` reads. */
export const MODULE_KEY_METADATA = 'erp:module';

/** Marks a controller class as part of a switchable module (ADR-0042). */
export const ModuleKey = (name: ModuleName): CustomDecorator =>
  SetMetadata(MODULE_KEY_METADATA, name);

/** The metadata key of `@ModuleOffNotFound()`, read by `ModuleEnabledGuard`. */
export const MODULE_OFF_NOT_FOUND_METADATA = 'erp:module-off-not-found';

/** ADR-0051: the class's switched-off module answers the generic 404 ERP-CORE-0004 instead of its 403 (no oracle). */
export const ModuleOffNotFound = (): CustomDecorator =>
  SetMetadata(MODULE_OFF_NOT_FOUND_METADATA, true);
