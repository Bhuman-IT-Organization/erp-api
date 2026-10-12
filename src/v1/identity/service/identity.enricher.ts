/**
 * Enricher: the fields the `tblstaff` row does not carry — the member's departments, the name of
 * the role it points at, and its permission set translated from the stored Perfex rows into clean
 * ADR-0033 names. Pure: it returns a new object and never mutates its input.
 *
 * This is the module's translation point in the read direction (ADR-0033 decision 2). A stored row
 * the mapping does not know is **dropped and counted**, never passed through: a Perfex code must
 * not reach a DTO or a guard. The count goes to one `warn`; the code itself never does — the same
 * rule `v1/auth`'s enricher follows (threat T-3.1-25).
 *
 * **The one exception is the audit row** (quick 260925-rvw, ADR-0034 d.3): the log records what was
 * written, so a save that removes a row the mapping does not know must still say which row it
 * removed. `toAuditCodes` names such a row by its raw `feature:capability` — a colon, never a dot,
 * so it can never be read as, or collide with, an ADR-0033 clean name.
 */
import { Injectable } from '@nestjs/common';
import { PERMISSIONS, toCleanPermission } from '@erp/contracts';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import type {
  EnrichedStaffMember,
  PerfexPermissionRow,
  PermissionCatalogueModule,
  PermissionCatalogueResource,
  StaffMember,
} from '../model/identity.model.js';

/** A branch of `@erp/contracts`' clean-name tree; leaves are the codes themselves. */
interface CatalogueBranch {
  readonly [key: string]: string | CatalogueBranch;
}

/** The catalogue is `module -> resource -> action -> code`, so a branch's values are one of two shapes. */
function isBranch(value: string | CatalogueBranch): value is CatalogueBranch {
  return typeof value !== 'string';
}

@Injectable()
export class IdentityEnricher {
  constructor(private readonly logger: LoggerService) {}

  /** Stored Perfex rows → sorted, de-duplicated clean names; unmapped rows are counted, not named. */
  toCleanPermissions(staffId: number, rows: readonly PerfexPermissionRow[]): string[] {
    let dropped = 0;
    const clean = new Set<string>();
    for (const row of rows) {
      const name = toCleanPermission(`${row.feature}.${row.capability}`);
      if (name === null) {
        dropped += 1;
        continue;
      }
      clean.add(name);
    }
    if (dropped > 0) {
      this.logger.warn('permission rows dropped: no mapping entry', { staffId, dropped });
    }
    return [...clean].sort((left, right) => left.localeCompare(right));
  }

  /**
   * Rows → the codes the audit and the granting comparison speak: the clean name where one exists,
   * the raw `feature:capability` where none does. Nothing is dropped — this is the comparison that
   * decides what a save changes, and a row it could not see is a row it would silently delete.
   */
  toAuditCodes(rows: readonly PerfexPermissionRow[]): string[] {
    return rows.map(
      (row) =>
        toCleanPermission(`${row.feature}.${row.capability}`) ?? `${row.feature}:${row.capability}`,
    );
  }

  /**
   * A role's stored Perfex template (`feature => capability[]`) as sorted clean ADR-0033 names — the
   * same translation a member's rows get, so a role and a member speak one language on the wire. A
   * pair the mapping does not know is dropped and counted, never passed through.
   */
  toCleanTemplate(roleId: number, template: Readonly<Record<string, readonly string[]>>): string[] {
    let dropped = 0;
    const clean = new Set<string>();
    for (const [feature, capabilities] of Object.entries(template)) {
      for (const capability of capabilities) {
        const name = toCleanPermission(`${feature}.${capability}`);
        if (name === null) {
          dropped += 1;
          continue;
        }
        clean.add(name);
      }
    }
    if (dropped > 0) {
      this.logger.warn('role template rows dropped: no mapping entry', { roleId, dropped });
    }
    return [...clean].sort((left, right) => left.localeCompare(right));
  }

  /**
   * The permission catalogue the checkbox grid renders, grouped `module -> resource -> action`
   * straight from `@erp/contracts`' clean-name tree. It replaces Perfex's
   * `get_available_staff_permissions()`, which read the database: the catalogue is a contract, not
   * data, so it is derived here and never queried. Pure — the same input every call.
   */
  buildPermissionCatalogue(): PermissionCatalogueModule[] {
    const tree: CatalogueBranch = PERMISSIONS;
    const modules: PermissionCatalogueModule[] = [];
    for (const [module, moduleBranch] of Object.entries(tree)) {
      if (!isBranch(moduleBranch)) continue;
      const resources: PermissionCatalogueResource[] = [];
      for (const [resource, resourceBranch] of Object.entries(moduleBranch)) {
        if (!isBranch(resourceBranch)) continue;
        const actions: { action: string; code: string }[] = [];
        for (const [action, code] of Object.entries(resourceBranch)) {
          if (isBranch(code)) continue;
          actions.push({ action, code });
        }
        if (actions.length > 0) resources.push({ resource, actions });
      }
      if (resources.length > 0) modules.push({ module, resources });
    }
    return modules;
  }

  enrich(
    member: StaffMember,
    departmentIds: readonly number[],
    permissions: readonly string[],
    roleName: string | null,
  ): EnrichedStaffMember {
    return {
      ...member,
      departmentIds: [...departmentIds],
      permissions: [...permissions],
      roleName,
    };
  }
}
