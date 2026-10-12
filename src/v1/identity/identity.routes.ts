/**
 * Route constants, the permission map and the audit change types: the single source for this
 * module's paths and its stable dotted names, used by the controller, the repositories, the tests
 * and erp-web's endpoint list. Relative to the global prefix `api/v1`.
 *
 * The whole path set is declared here even though this plan (03.1-12) builds only the member half
 * and the audit read: plan 03.1-11 adds the role, catalogue and department handlers on these
 * paths, so it adds handlers rather than renaming paths. `locales` was added afterwards, with the
 * staff-parity gaps: it is a third lookup the member form needs, beside `permissions/catalogue` and
 * `departments`.
 */
import { PERMISSIONS } from '@erp/contracts';

export const IDENTITY_ROUTES = {
  base: 'identity',
  members: 'members',
  member: 'members/:id',
  memberStatus: 'members/:id/status',
  roles: 'roles',
  role: 'roles/:id',
  permissionsCatalogue: 'permissions/catalogue',
  departments: 'departments',
  locales: 'locales',
  audit: 'audit',
  /** Plan 03.2-05 (D-26), 04.1.1-02: every member the list's query matches, as CSV, Excel, PDF or print rows. Static, so it wins over `members/:id`. */
  membersExport: 'members/export',
  /** Plan 03.2-05 (D-26), 04.1.1-02: every role the list's query matches, in the same four formats. Static, so it wins over `roles/:id`. */
  rolesExport: 'roles/export',
} as const;

/**
 * The member export's columns, in order: what the staff list shows plus the id. They are also the
 * header row when the web sends no translated `header` labels (D-42), and `column` picks a subset
 * of them (D-13). `active` is `1`/`0` in CSV and Excel, because the API cannot translate "Active",
 * and the sent `yes`/`no` label in PDF and Print; `lastLogin` is ISO 8601 or empty in the files,
 * and the reader's date format (or the sent blank, "Never") in PDF and Print.
 */
export const MEMBER_EXPORT_COLUMNS = [
  'staffId',
  'firstName',
  'lastName',
  'email',
  'roleName',
  'active',
  'lastLogin',
] as const;

/** The role export's columns, in order: what the roles list shows plus the id; every format writes them as numbers and text. */
export const ROLE_EXPORT_COLUMNS = ['roleId', 'name', 'memberCount'] as const;

/** `staff-members-YYYY-MM-DD.<csv|xlsx|pdf>`: a constant stem, so no request input reaches `Content-Disposition`. */
export const MEMBER_EXPORT_FILE_STEM = 'staff-members';

/** `roles-YYYY-MM-DD.<csv|xlsx|pdf>`. */
export const ROLE_EXPORT_FILE_STEM = 'roles';

/**
 * Clean ADR-0033 names from `@erp/contracts`; the enricher translates the stored Perfex rows into
 * them. There is deliberately no entry for `staff.roles.create`/`edit`/`delete`: ADR-0034 decision
 * 2 gates those on the administrator flag, and a permission code must never gate granting — a code
 * can be handed out by the mechanism it protects. They stay in the mapping for Perfex's own
 * screens.
 */
export const IDENTITY_PERMISSIONS = {
  /** `view`, `create`, `edit`; `delete` is reserved — staff delete stays on Perfex (brief §10 Q5). */
  members: PERMISSIONS.staff.members,
  rolesView: PERMISSIONS.staff.roles.view,
} as const;

/**
 * `tblidentity_audit.change_type`, fixed by identity-access brief §7. One per kind of change a
 * granting write can make; `role.*` are written by plan 03.1-11's role handlers on this same tree.
 *
 * **Why these constants live in the routes file** and not in `model/` or `dto/`: four of them
 * (`member.role.changed`, `member.permission.added`, `member.permission.removed`,
 * `member.admin.changed`) are three-segment lower-camel dotted strings, which is byte-identical to
 * the ADR-0033 clean-permission grammar `S_PERMISSION_LITERAL` refuses everywhere except
 * `packages/contracts/src/**` (scope 13), `src/v1/**\/*.routes.ts` (scope 12) and
 * `src/v1/**\/events/*.ts` (scope 14). This is the same grammar collision plan 03.1-03 recorded
 * for BE-13's event names, resolved the same way — by putting the constant in a scope that admits
 * the shape, not by renaming a wire value the brief fixes.
 */
export const IDENTITY_CHANGE_TYPES = {
  roleCreated: 'role.created',
  roleUpdated: 'role.updated',
  roleDeleted: 'role.deleted',
  memberRoleChanged: 'member.role.changed',
  memberPermissionAdded: 'member.permission.added',
  memberPermissionRemoved: 'member.permission.removed',
  memberAdminChanged: 'member.admin.changed',
} as const;

/** The same seven values as a tuple, so a zod enum and the audit DTO can be derived from them. */
export const IDENTITY_CHANGE_TYPE_VALUES = [
  IDENTITY_CHANGE_TYPES.roleCreated,
  IDENTITY_CHANGE_TYPES.roleUpdated,
  IDENTITY_CHANGE_TYPES.roleDeleted,
  IDENTITY_CHANGE_TYPES.memberRoleChanged,
  IDENTITY_CHANGE_TYPES.memberPermissionAdded,
  IDENTITY_CHANGE_TYPES.memberPermissionRemoved,
  IDENTITY_CHANGE_TYPES.memberAdminChanged,
] as const;

export type IdentityChangeType = (typeof IDENTITY_CHANGE_TYPE_VALUES)[number];
