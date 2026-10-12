/**
 * Test doubles shared by the service spec, the facade spec and the controller e2e spec: an
 * in-memory `AuthRepository` with the SAME semantics as the Prisma one (plan 07 findings —
 * `findStaffByEmail` answers ACTIVE rows only, lowest `staffid` first; `rehashPassword` is a
 * compare-and-set returning the changed-row count; `touchLogin` never touches the password-change
 * timestamp) and the seed users every spec logs in with.
 *
 * Hashes are generated in-process at cost 10 under PHP's `$2y$` label — the shape the live rows
 * carry — so the re-hash-on-login path (`needsRehash` → `$2y$12$`) is exercised for real. No real
 * staff password appears anywhere in this repository.
 */
import { genSaltSync, hashSync } from 'bcryptjs';
import type { StaffPermissionRow } from '../dto/auth.dto.js';
import type { StaffIdentity } from '../model/auth.model.js';

/** A cost-10 hash under PHP's label (research Q1: what the live rows carry after the bulk reset). */
export function legacyStyleHash(plaintext: string): string {
  return hashSync(plaintext, genSaltSync(10).replace(/^\$2b\$/, '$2y$'));
}

export const SEED_PASSWORDS = {
  active: 'correct horse',
  admin: 'battery staple',
  inactive: 'inactive pass',
  twoFactor: 'two factor pass',
} as const;

export const SEED_EMAILS = {
  active: 'active@example.test',
  admin: 'admin@example.test',
  inactive: 'inactive@example.test',
  twoFactor: 'twofactor@example.test',
} as const;

export const SEED_STAFF_IDS = { active: 10, admin: 11, inactive: 12, twoFactor: 13 } as const;

/**
 * Perfex rows as `tblstaff_permissions` stores them. The enricher translates them into clean
 * ADR-0033 names (`sales.invoices.view`, `staff.members.view`, `staff.roles.view`); the
 * swapped-order row is never declared, so it has no mapping entry and is **dropped** — which is
 * what the `/me` e2e assertion and the enricher spec prove.
 */
export const SEED_PERMISSIONS: readonly StaffPermissionRow[] = [
  { feature: 'invoices', capability: 'view' },
  { feature: 'staff', capability: 'view' },
  { feature: 'roles', capability: 'view' },
  { feature: 'edit', capability: 'tasks' }, // Perfex's one swapped-order row: unmapped, dropped
];

/** The four seed identities with fresh `$2y$10$` hashes (about 60 ms each at cost 10). */
export function seedStaff(): StaffIdentity[] {
  const base = {
    firstName: 'Seed',
    lastName: 'User',
    roleId: 2,
    isAdmin: false,
    locale: null,
  } as const;
  return [
    {
      ...base,
      staffId: SEED_STAFF_IDS.active,
      email: SEED_EMAILS.active,
      active: true,
      twoFactorEnabled: false,
      passwordHash: legacyStyleHash(SEED_PASSWORDS.active),
    },
    {
      ...base,
      staffId: SEED_STAFF_IDS.admin,
      email: SEED_EMAILS.admin,
      isAdmin: true,
      roleId: null,
      locale: 'en',
      active: true,
      twoFactorEnabled: false,
      passwordHash: legacyStyleHash(SEED_PASSWORDS.admin),
    },
    {
      ...base,
      staffId: SEED_STAFF_IDS.inactive,
      email: SEED_EMAILS.inactive,
      active: false,
      twoFactorEnabled: false,
      passwordHash: legacyStyleHash(SEED_PASSWORDS.inactive),
    },
    {
      ...base,
      staffId: SEED_STAFF_IDS.twoFactor,
      email: SEED_EMAILS.twoFactor,
      active: true,
      twoFactorEnabled: true,
      passwordHash: legacyStyleHash(SEED_PASSWORDS.twoFactor),
    },
  ];
}

export interface TouchRecord {
  readonly staffId: number;
  readonly ip: string;
  readonly at: Date;
}

/** Structurally the Prisma repository's public surface; `AuthModule` binds it through `overrideProvider`. */
export class FakeAuthRepository {
  readonly rows = new Map<number, StaffIdentity>();
  readonly permissions = new Map<number, readonly StaffPermissionRow[]>();
  readonly touches: TouchRecord[] = [];

  constructor(staff: readonly StaffIdentity[] = seedStaff()) {
    for (const row of staff) this.rows.set(row.staffId, row);
    this.permissions.set(SEED_STAFF_IDS.active, SEED_PERMISSIONS);
  }

  findStaffByEmail(email: string): Promise<StaffIdentity | null> {
    const match = [...this.rows.values()]
      .filter((row) => row.active && row.email === email)
      .sort((a, b) => a.staffId - b.staffId)[0];
    return Promise.resolve(match ?? null);
  }

  findStaffById(staffId: number): Promise<StaffIdentity | null> {
    return Promise.resolve(this.rows.get(staffId) ?? null);
  }

  rehashPassword(staffId: number, currentHash: string, newHash: string): Promise<number> {
    const row = this.rows.get(staffId);
    if (row?.passwordHash !== currentHash) return Promise.resolve(0);
    this.rows.set(staffId, { ...row, passwordHash: newHash });
    return Promise.resolve(1);
  }

  touchLogin(staffId: number, ip: string, at: Date): Promise<void> {
    this.touches.push({ staffId, ip, at });
    return Promise.resolve();
  }
}

/**
 * `v1/identity`'s cross-module surface, backed by the rows above. Since plan 03.1-11 `AuthService`
 * reads a member's permission rows through `IdentityFacade.permissionsOf` rather than its own
 * `$queryRaw` (ADR-0034 d.1), so this fake takes the place `FakeAuthRepository.listPermissions` held:
 * the rows are still `tblstaff_permissions`' Perfex `feature`/`capability` pairs, and `AuthEnricher`
 * is still the one place they become clean ADR-0033 names.
 *
 * It is a class and not an object literal so `vi.spyOn(identity, 'permissionsOf')` can count reads —
 * which is how the ADR-0033 decision 6 "rebuilt on every refresh" cases are proven.
 */
export class FakeIdentityFacade {
  constructor(private readonly repo: FakeAuthRepository) {}

  permissionsOf(staffId: number): Promise<readonly StaffPermissionRow[]> {
    return Promise.resolve([...(this.repo.permissions.get(staffId) ?? [])]);
  }

  describe(): { module: 'identity'; version: 1 } {
    return { module: 'identity', version: 1 };
  }
}
