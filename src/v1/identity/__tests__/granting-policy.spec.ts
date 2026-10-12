/**
 * `granting-policy.ts` — the one place that decides what a grant is (ADR-0034 decision 2).
 *
 * The case that matters most is the last one: an actor holding **every code in the ADR-0033
 * catalogue** is still refused without `tblstaff.admin = 1`. That is the property the ADR's
 * Alternatives table refuses to give up — a permission code can be handed out by the mechanism it
 * protects, so no amount of permission may substitute for the flag.
 */
import { describe, expect, it } from 'vitest';
import { PERMISSION_CODES, PERMISSIONS } from '@erp/contracts';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { IDENTITY_CHANGE_TYPES } from '../identity.routes.js';
import type {
  MemberSaveInput,
  MemberState,
  RoleSaveInput,
  RoleState,
} from '../model/identity.model.js';
import {
  assertMayGrant,
  auditChangeTypeOf,
  GRANTING_FIELDS,
  isGrantingChange,
  isRoleGrantingChange,
  ROLE_GRANTING_FIELDS,
} from '../service/granting-policy.js';

const VIEW = PERMISSIONS.staff.members.view;
const EDIT = PERMISSIONS.staff.members.edit;
const ROLES_VIEW = PERMISSIONS.staff.roles.view;

const FAR_FUTURE_EXPIRY_S = 4_102_444_800;

function actorOf(isAdmin: boolean): AuthenticatedUser {
  return {
    staffId: 7,
    sessionId: 'sid-7',
    jti: 'jti-7',
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: FAR_FUTURE_EXPIRY_S,
  };
}

const ADMIN = actorOf(true);
const NON_ADMIN = actorOf(false);

const before: MemberState = { roleId: 10, permissions: [VIEW], isAdmin: false };

function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof AppError ? error.code : 'not-an-AppError';
  }
  return 'did-not-throw';
}

describe('GRANTING_FIELDS', () => {
  it('is the three fields of a member save that hand out access, as data', () => {
    expect([...GRANTING_FIELDS]).toEqual(['role', 'permissions', 'admin']);
  });
});

describe('isGrantingChange', () => {
  it('finds nothing when the request mentions no granting field', () => {
    expect(isGrantingChange(before, {})).toEqual([]);
  });

  it('finds nothing when every granting field carries the value the member already has', () => {
    const same: MemberSaveInput = { roleId: 10, permissions: [VIEW], isAdmin: false };
    expect(isGrantingChange(before, same)).toEqual([]);
  });

  it('finds a role change, with the before and after value', () => {
    expect(isGrantingChange(before, { roleId: 11 })).toEqual([
      { field: 'role', before: '10', after: '11' },
    ]);
  });

  it('treats clearing the role as a change', () => {
    expect(isGrantingChange(before, { roleId: null })).toEqual([
      { field: 'role', before: '10', after: null },
    ]);
  });

  it('finds an admin-flag change as 0 -> 1', () => {
    expect(isGrantingChange(before, { isAdmin: true })).toEqual([
      { field: 'admin', before: '0', after: '1' },
    ]);
  });

  it('finds one change per permission code added and per code removed', () => {
    expect(isGrantingChange(before, { permissions: [EDIT, ROLES_VIEW] })).toEqual([
      { field: 'permissions', before: null, after: EDIT, permissionCode: EDIT },
      { field: 'permissions', before: null, after: ROLES_VIEW, permissionCode: ROLES_VIEW },
      { field: 'permissions', before: VIEW, after: null, permissionCode: VIEW },
    ]);
  });

  it('finds four changes for a replacement that adds three codes and removes one', () => {
    const changes = isGrantingChange(before, {
      permissions: [EDIT, ROLES_VIEW, PERMISSIONS.sales.invoices.view],
    });
    expect(changes).toHaveLength(4);
    expect(changes.filter((change) => change.after !== null)).toHaveLength(3);
    expect(changes.filter((change) => change.before !== null)).toHaveLength(1);
  });
});

describe('assertMayGrant', () => {
  it('passes for anybody when nothing is granted', () => {
    expect(() => {
      assertMayGrant(NON_ADMIN, []);
    }).not.toThrow();
  });

  it.each([
    ['a role change', { roleId: 11 }],
    ['a permission add', { permissions: [VIEW, EDIT] }],
    ['a permission remove', { permissions: [] }],
    ['an admin-flag change', { isAdmin: true }],
  ])('refuses %s for a non-administrator with ERP-IDENTITY-0001', (_case, after) => {
    const changes = isGrantingChange(before, after);
    expect(changes.length).toBeGreaterThan(0);
    expect(
      codeOf(() => {
        assertMayGrant(NON_ADMIN, changes);
      }),
    ).toBe('ERP-IDENTITY-0001');
  });

  it.each([
    ['a role change', { roleId: 11 }],
    ['a permission add', { permissions: [VIEW, EDIT] }],
    ['a permission remove', { permissions: [] }],
    ['an admin-flag change', { isAdmin: true }],
  ])('passes %s for an administrator', (_case, after) => {
    expect(() => {
      assertMayGrant(ADMIN, isGrantingChange(before, after));
    }).not.toThrow();
  });

  it('refuses an actor holding EVERY code in the catalogue but not the administrator flag', () => {
    const everything: MemberState = {
      roleId: null,
      permissions: [...PERMISSION_CODES],
      isAdmin: false,
    };
    expect(everything.permissions.length).toBeGreaterThan(500);
    const changes = isGrantingChange(before, { isAdmin: true });
    // The actor's own access is irrelevant by construction: the policy never receives it.
    expect(
      codeOf(() => {
        assertMayGrant(NON_ADMIN, changes);
      }),
    ).toBe('ERP-IDENTITY-0001');
    expect(NON_ADMIN.isAdmin).toBe(false);
  });
});

describe('auditChangeTypeOf', () => {
  it('maps every granting change onto the brief §7 change type', () => {
    expect(auditChangeTypeOf({ field: 'role', before: '10', after: '11' })).toBe(
      IDENTITY_CHANGE_TYPES.memberRoleChanged,
    );
    expect(auditChangeTypeOf({ field: 'admin', before: '0', after: '1' })).toBe(
      IDENTITY_CHANGE_TYPES.memberAdminChanged,
    );
    expect(
      auditChangeTypeOf({ field: 'permissions', before: null, after: VIEW, permissionCode: VIEW }),
    ).toBe(IDENTITY_CHANGE_TYPES.memberPermissionAdded);
    expect(
      auditChangeTypeOf({ field: 'permissions', before: VIEW, after: null, permissionCode: VIEW }),
    ).toBe(IDENTITY_CHANGE_TYPES.memberPermissionRemoved);
  });
});

describe('ROLE_GRANTING_FIELDS and isRoleGrantingChange', () => {
  const roleBefore: RoleState = { name: 'Support', permissions: [VIEW, ROLES_VIEW] };

  it('is one field, because a role write has no non-granting half', () => {
    expect([...ROLE_GRANTING_FIELDS]).toEqual(['roleDefinition']);
  });

  it('a create is one roleDefinition change with no before', () => {
    const changes = isRoleGrantingChange(null, { name: 'Support', permissions: [VIEW] });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.field).toBe('roleDefinition');
    expect(changes[0]?.roleChange).toBe('created');
    expect(changes[0]?.before).toBeNull();
    expect(changes[0]?.after).toBe(`Support [${VIEW}]`);
  });

  it('a delete is one roleDefinition change with no after', () => {
    const changes = isRoleGrantingChange(roleBefore, null);
    expect(changes).toHaveLength(1);
    expect(changes[0]?.roleChange).toBe('deleted');
    expect(changes[0]?.after).toBeNull();
    expect(changes[0]?.before).toBe(`Support [${VIEW} ${ROLES_VIEW}]`);
  });

  it('an update is one roleDefinition change carrying both sides, with the template sorted', () => {
    const changes = isRoleGrantingChange(roleBefore, { permissions: [ROLES_VIEW, VIEW] });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.roleChange).toBe('updated');
    expect(changes[0]?.before).toBe(`Support [${VIEW} ${ROLES_VIEW}]`);
    expect(changes[0]?.after).toBe(`Support [${VIEW} ${ROLES_VIEW}]`);
  });

  it('a rename alone is still a grant: the holders’ screens changed', () => {
    const changes = isRoleGrantingChange(roleBefore, { name: 'Helpdesk' });
    expect(changes).toHaveLength(1);
    expect(changes[0]?.after).toBe(`Helpdesk [${VIEW} ${ROLES_VIEW}]`);
  });

  it('an update that changes nothing still records its entry (ADR-0034 d.3)', () => {
    expect(isRoleGrantingChange(roleBefore, {})).toHaveLength(1);
  });

  it('nothing at all is no change', () => {
    expect(isRoleGrantingChange(null, null)).toEqual([]);
  });

  it('refuses a non-admin holding every role write code, and admits an administrator', () => {
    const everyRoleWriteCode = [
      PERMISSIONS.staff.roles.create,
      PERMISSIONS.staff.roles.edit,
      PERMISSIONS.staff.roles.delete,
    ];
    expect(everyRoleWriteCode.every((code) => PERMISSION_CODES.includes(code))).toBe(true);
    for (const after of [null, {}, { name: 'Helpdesk' }] as const) {
      const changes = isRoleGrantingChange(roleBefore, after);
      expect(
        codeOf(() => {
          assertMayGrant(NON_ADMIN, changes);
        }),
      ).toBe('ERP-IDENTITY-0001');
      expect(
        codeOf(() => {
          assertMayGrant(ADMIN, changes);
        }),
      ).toBe('did-not-throw');
    }
  });

  it('maps each role change onto its brief §7 change type', () => {
    const typeOf = (after: RoleSaveInput | null, before: RoleState | null = roleBefore): string => {
      const change = isRoleGrantingChange(before, after)[0];
      expect(change).toBeDefined();
      return change === undefined ? 'missing' : auditChangeTypeOf(change);
    };
    expect(typeOf({ name: 'Helpdesk' }, null)).toBe(IDENTITY_CHANGE_TYPES.roleCreated);
    expect(typeOf({ name: 'Helpdesk' })).toBe(IDENTITY_CHANGE_TYPES.roleUpdated);
    expect(typeOf(null)).toBe(IDENTITY_CHANGE_TYPES.roleDeleted);
  });
});
