/**
 * Enricher: turns the raw `tblstaff_permissions` rows into the `auth:perm:{staffId}` snapshot the
 * `PermissionGuard` reads (research Q2).
 *
 * **This is the ONLY place a Perfex code becomes a clean name (ADR-0033 decision 2.)** Every row
 * is translated through `toCleanPermission` from `@erp/contracts`, so nothing downstream — the
 * guard, `GET /api/v1/auth/me`, erp-web — ever sees Perfex naming.
 *
 * A row whose code has no mapping entry is **dropped, never passed through**: the mapping covers
 * all 507 active declared codes (`packages/contracts/__tests__/perfex-mapping.spec.ts`), so an
 * unmapped row is an inactive-module code or one of ADR-0033 decision 9's broken checks, and
 * letting it through would put a Perfex name where a guard might match it (T-3.1-20). One `warn`
 * names how many were dropped and never which (T-3.1-25 — the log stays small and carries no
 * permission code).
 *
 * Duplicates collapse, the list is sorted so two builds of the same rows are byte-equal, and
 * `isAdmin` is carried because Perfex admins bypass the rows entirely (`staff_can`).
 */
import { toCleanPermission } from '@erp/contracts';
import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type { StaffPermissionRow } from '../dto/auth.dto.js';
import type { PermissionSnapshot, StaffIdentity } from '../model/auth.model.js';

@Injectable()
export class AuthEnricher {
  constructor(private readonly logger: LoggerService) {}

  buildPermissionSnapshot(
    staff: StaffIdentity,
    rows: readonly StaffPermissionRow[],
    builtAt: Date,
  ): PermissionSnapshot {
    let dropped = 0;
    const clean = rows.map((row) => {
      const name = toCleanPermission(`${row.feature}.${row.capability}`);
      if (name === null) dropped += 1;
      return name;
    });
    const codes = [...new Set(clean.filter((name): name is string => name !== null))].sort();
    if (dropped > 0) {
      this.logger.warn('permission rows dropped: no mapping entry', {
        staffId: staff.staffId,
        dropped,
      });
    }
    return {
      v: 1,
      staffId: staff.staffId,
      isAdmin: staff.isAdmin,
      roleId: staff.roleId,
      codes,
      builtAt: builtAt.toISOString(),
    };
  }
}
