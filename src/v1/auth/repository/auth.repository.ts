/**
 * The only Prisma caller in this module (BE-04/DB-04), and it names exactly ONE table: `tblstaff`.
 * Writes `password` (compare-and-set re-hash), `last_login` and `last_ip` — the three login columns
 * ADR-0030 assigns to Node and the one recorded, column-scoped exception to ADR-0034 decision 1
 * (`src/v1/auth/README.md` § Owned tables). Every other column of the row is `v1/identity`'s.
 *
 * **The permission read is gone from this file** (plan 03.1-11, ADR-0034 d.1): `listPermissions` used
 * to `$queryRaw` `tblstaff_permissions`, which `v1/identity` now owns. `AuthService` reads those rows
 * through `identity.facade.permissionsOf(staffId)`, and the `module-shape.spec.ts` identity-tables
 * clause fails the build if this file ever names the table again.
 *
 * The password-change timestamp column is never written here: Perfex's password-expiry check keys
 * on it and a re-hash is not a password change (research Q1). `last_activity` stays Perfex's
 * per-request write.
 */
import { Injectable } from '@nestjs/common';
import { toLocale } from '../../../shared/config/legacy-locale.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import type { StaffIdentity } from '../model/auth.model.js';

/** The columns login needs — nothing else leaves the row (no `token`, no 2FA secret). */
const identityColumns = {
  staffid: true,
  email: true,
  firstname: true,
  lastname: true,
  password: true,
  admin: true,
  role: true,
  active: true,
  two_factor_auth_enabled: true,
  default_language: true,
} as const;

interface IdentityRow {
  readonly staffid: number;
  readonly email: string;
  readonly firstname: string;
  readonly lastname: string;
  readonly password: string;
  readonly admin: number;
  readonly role: number | null;
  readonly active: number;
  readonly two_factor_auth_enabled: boolean | null;
  readonly default_language: string | null;
}

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The active staff row for an e-mail, or `null`. `tblstaff.email` carries no unique constraint in
   * the mirror, so the lowest `staffid` wins deterministically. The caller normalises the e-mail.
   */
  async findStaffByEmail(email: string): Promise<StaffIdentity | null> {
    const row = await this.prisma.client.tblstaff.findFirst({
      where: { email, active: 1 },
      orderBy: { staffid: 'asc' },
      select: identityColumns,
    });
    return row === null ? null : this.toIdentity(row);
  }

  async findStaffById(staffId: number): Promise<StaffIdentity | null> {
    const row = await this.prisma.client.tblstaff.findUnique({
      where: { staffid: staffId },
      select: identityColumns,
    });
    return row === null ? null : this.toIdentity(row);
  }

  /**
   * Compare-and-set re-hash (research Q1 point 3): the row changes only while it still holds
   * `currentHash`. Returns the number of rows changed — `1`, or `0` when Perfex or LDAP rewrote the
   * password in between (the caller logs and carries on; the login already succeeded).
   */
  async rehashPassword(staffId: number, currentHash: string, newHash: string): Promise<number> {
    const { count } = await this.prisma.client.tblstaff.updateMany({
      where: { staffid: staffId, password: currentHash },
      data: { password: newHash },
    });
    return count;
  }

  /** What Perfex's `update_login_info` writes on a successful login: `last_login` and `last_ip`. */
  async touchLogin(staffId: number, ip: string, at: Date): Promise<void> {
    await this.prisma.client.tblstaff.updateMany({
      where: { staffid: staffId },
      data: { last_login: at, last_ip: ip },
    });
  }

  /**
   * The effective permission rows of one staff member (research Q2). The table is `@@ignore`d
   * (no primary key) so the client has no delegate; the tagged template binds `staffId` as a
   * parameter and the ownership guard admits the statement because it is a plain `SELECT`.
   */
  private toIdentity(row: IdentityRow): StaffIdentity {
    return {
      staffId: row.staffid,
      email: row.email,
      firstName: row.firstname,
      lastName: row.lastname,
      passwordHash: row.password,
      isAdmin: row.admin === 1,
      roleId: row.role ?? null,
      active: row.active === 1,
      twoFactorEnabled: row.two_factor_auth_enabled === true,
      locale: toLocale(row.default_language),
    };
  }
}
