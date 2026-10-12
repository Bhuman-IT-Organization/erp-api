/**
 * Domain entity types of the module. Mapped from the repository's rows; nothing here is a DTO and
 * nothing here is a Perfex row — a permission always travels as its clean ADR-0033 name, and the
 * Perfex `feature`/`capability` pair exists only between `toPerfexPermission` and the raw write
 * (ADR-0033 decision 10).
 *
 * `StaffMember` carries the `tblstaff` columns identity-access brief §2.1 gives Node to **write**,
 * plus three the module only ever **reads**: `profile_image` (the legacy staff list and member page
 * render the photo), `last_login` (the list's fourth column) and `last_activity` (the member page's
 * header). A migrated screen that cannot read them cannot be 1:1. Reading is not a write, so
 * ADR-0034 d.1 and `v1/auth`'s column-scoped exception on `last_login` are untouched. No two-factor
 * column, no HR record column, and never the password hash.
 */
import type { DecodedCursor } from '../../../shared/http/keyset.js';
import type { ListQuery } from '../../../shared/http/pagination.js';
import type { IdentityChangeType } from '../identity.routes.js';

/** The `tblstaff` profile columns this module owns (brief §2.1). `hourlyRate` is the Decimal as a number. */
export interface StaffMember {
  readonly staffId: number;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phoneNumber: string | null;
  readonly facebook: string | null;
  readonly linkedin: string | null;
  readonly skype: string | null;
  readonly hourlyRate: number;
  readonly defaultLanguage: string | null;
  readonly direction: string | null;
  readonly emailSignature: string | null;
  readonly mediaPathSlug: string | null;
  /**
   * `tblstaff.profile_image` as stored: the BARE file name Perfex's uploader wrote, never a path and
   * never a URL. The transformer is the only place that turns it into one (`profileImageUrl`), the
   * same split `v1/branding` uses for the company logo (`logoFile` → `logoUrl`).
   */
  readonly profileImage: string | null;
  /** ISO timestamp of `tblstaff.datecreated`. */
  readonly dateCreated: string;
  /**
   * ISO timestamp of `tblstaff.last_login`, or `null` when the member has never signed in (Perfex's
   * staff list renders that as "Never"). Read only: `v1/auth` is the one writer.
   */
  readonly lastLogin: string | null;
  /**
   * ISO timestamp of `tblstaff.last_activity`, or `null`. Read only: Perfex writes it on every
   * legacy request; `views/admin/staff/member.php` shows it beside the member's name.
   */
  readonly lastActivity: string | null;
  readonly isAdmin: boolean;
  readonly roleId: number | null;
  readonly active: boolean;
  readonly isNotStaff: boolean;
}

/** One row of the staff list: the columns the list screen renders, no more. */
export interface MemberListRow {
  readonly staffId: number;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly phoneNumber: string | null;
  /** The bare `tblstaff.profile_image` name; the list's name cell renders the photo (`tables/staff.php`). */
  readonly profileImage: string | null;
  readonly isAdmin: boolean;
  readonly roleId: number | null;
  /**
   * The name of the role the row points at — the list's Role column (`tables/staff.php` renders
   * `roles.name`). `null` when the member holds no role, and `null` when the id no longer resolves
   * to a `tblroles` row: `tblstaff.role` carries no foreign key (SF-7), so a dangling id is a
   * missing name and never an error. Resolved for the whole page in one read, never per row.
   */
  readonly roleName: string | null;
  readonly active: boolean;
  readonly dateCreated: string;
  /** The list's fourth column (`tables/staff.php`): Last Login, or `null` for "Never". */
  readonly lastLogin: string | null;
}

/**
 * One page of the member list, with the list meta the pager renders (`shared/http/keyset.ts`):
 * `nextCursor` is `null` on the last page and `prevCursor` on the first; `total` counts every row the
 * filters and `q` match; `rangeStart` is the 1-based rank of the first row, `0` on an empty page.
 */
export interface MemberPage {
  readonly items: readonly MemberListRow[];
  readonly nextCursor: string | null;
  readonly prevCursor: string | null;
  readonly total: number;
  readonly rangeStart: number;
}

/** The member detail the enricher builds: the profile plus its departments, role name and access. */
export interface EnrichedStaffMember extends StaffMember {
  readonly departmentIds: readonly number[];
  /** Clean ADR-0033 names, sorted; a stored row the mapping does not know is dropped with a warn. */
  readonly permissions: readonly string[];
  readonly roleName: string | null;
}

/**
 * A member's access as stored — the "before" side of every granting decision (ADR-0034 d.2).
 * `permissions` are clean ADR-0033 names.
 */
export interface MemberState {
  readonly roleId: number | null;
  readonly permissions: readonly string[];
  readonly isAdmin: boolean;
}

/**
 * The granting-relevant side of a member save — the "after" side. A field left `undefined` is a
 * field the request does not mention, which is never a grant; `roleId: null` is "no role", which
 * is a grant when the member had one.
 */
export interface MemberSaveInput {
  readonly roleId?: number | null;
  readonly permissions?: readonly string[];
  readonly isAdmin?: boolean;
}

/** A role row as `tblroles` stores it; `permissions` is still the PHP `serialize()` text. */
export interface RoleRow {
  readonly roleId: number;
  readonly name: string;
  readonly serializedPermissions: string | null;
}

/**
 * One row of the roles list. `memberCount` comes from a counting query over `tblstaff.role`, never
 * from loading the members — the list screen shows a count per row and BE-19 gives it no table
 * total.
 */
export interface RoleListRow {
  readonly roleId: number;
  readonly name: string;
  readonly memberCount: number;
}

/** One page of the roles list; the meta is `MemberPage`'s. */
export interface RolePage {
  readonly items: readonly RoleListRow[];
  readonly nextCursor: string | null;
  readonly prevCursor: string | null;
  readonly total: number;
  readonly rangeStart: number;
}

/** A member of a role, as `GET roles/:id` lists them; the same columns the member list shows. */
export interface RoleMember {
  readonly staffId: number;
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly active: boolean;
}

/**
 * A role as the detail screen reads it: the name, the template as **clean ADR-0033 names** (the
 * stored Perfex `feature => capability[]` map is translated by the enricher, exactly as a member's
 * rows are) and the members holding it.
 */
export interface RoleDetail {
  readonly roleId: number;
  readonly name: string;
  readonly permissions: readonly string[];
  readonly members: readonly RoleMember[];
  readonly memberCount: number;
}

/**
 * A member holding the role, as the `applyToMembers` fan-out needs them: the two Perfex flags decide
 * what rows the member actually receives (an administrator receives none; an `is_not_staff` member
 * never receives the `leads` feature), so the fan-out reads them rather than assuming.
 */
export interface RoleHolder {
  readonly staffId: number;
  readonly isAdmin: boolean;
  readonly isNotStaff: boolean;
}

/**
 * A role's granting-relevant state — the "before" side of a role write (ADR-0034 d.2). A role IS a
 * permission set, so both its name and its template are part of the record the audit row keeps.
 */
export interface RoleState {
  readonly name: string;
  /** Clean ADR-0033 names, sorted. */
  readonly permissions: readonly string[];
}

/** The role-write body in the domain's spelling; a field the request does not mention is `undefined`. */
export interface RoleSaveInput {
  readonly name?: string;
  readonly permissions?: readonly string[];
}

/** One department of the member form's picker, as `DepartmentsFacade.listForPicker()` answers it (its `DepartmentName`, D-55). */
export interface Department {
  readonly departmentId: number;
  readonly name: string;
}

/** One resource of the permission catalogue, as the checkbox grid renders it (clean names only). */
export interface PermissionCatalogueResource {
  readonly resource: string;
  readonly actions: readonly { readonly action: string; readonly code: string }[];
}

/** The catalogue grouped `module -> resource -> action`; derived from `@erp/contracts`, never the database. */
export interface PermissionCatalogueModule {
  readonly module: string;
  readonly resources: readonly PermissionCatalogueResource[];
}

/**
 * A member as another module may name them (M13): the id and Perfex's `get_staff_full_name`, the
 * first name, a space and the last name. No e-mail, no role, no flag: a name is all that crosses.
 */
export interface StaffName {
  readonly staffId: number;
  readonly name: string;
}

/**
 * What another module may know to email a member (PATTERNS M1): the address, the locale of
 * `tblstaff.default_language` through `toLocale` (null when empty or unknown) and whether the
 * member is active. Only identity names `tblstaff`; `v1/mail` reads this instead.
 */
export interface StaffContact {
  readonly email: string;
  readonly locale: string | null;
  readonly active: boolean;
}

/** One `tblstaff_permissions` row in Perfex's own format — the only place the pair appears. */
export interface PerfexPermissionRow {
  readonly feature: string;
  readonly capability: string;
}

/** One append-only `tblidentity_audit` row, as ADR-0034 decision 3 and brief §7 fix its columns. */
export interface IdentityAuditEntry {
  readonly actorStaffId: number;
  readonly subjectStaffId: number | null;
  readonly subjectRoleId: number | null;
  readonly changeType: IdentityChangeType;
  /** The clean ADR-0033 name added or removed; `null` for a role or admin-flag change. */
  readonly permissionCode: string | null;
  readonly beforeValue: string | null;
  readonly afterValue: string | null;
  /** The `x-request-id` of the request that made the change (ADR-0032 lineage). */
  readonly requestId: string;
  readonly createdAt: Date;
}

/** An audit entry as read back: the row's own id is the keyset cursor. */
export interface IdentityAuditRow extends IdentityAuditEntry {
  /** `tblidentity_audit.id` as a decimal string — `BIGINT UNSIGNED` does not fit a JS number. */
  readonly id: string;
}

export interface IdentityAuditPage {
  readonly rows: readonly IdentityAuditRow[];
  readonly nextCursor: string | null;
}

/** The fields `GET members` accepts in `?filter[…]` / `?sort=` (BE-19 allowlist). */
export const MEMBER_LIST_FIELDS = [
  'staffId',
  'active',
  'isAdmin',
  'roleId',
  'email',
  'firstName',
  'lastName',
] as const;
export type MemberListField = (typeof MEMBER_LIST_FIELDS)[number];

/**
 * The member columns the list can be keyset-ordered by (the validator's `MEMBER_SORT_FIELDS` is the
 * runtime allowlist and `satisfies` this type). Role name (a join) and Last login (nullable) are not
 * keyset keys, so they do not sort (D-41).
 */
export type MemberSortField = Extract<
  MemberListField,
  'staffId' | 'firstName' | 'email' | 'active'
>;

/** The fields `GET roles` accepts in `?filter[…]` / `?sort=` (BE-19 allowlist). */
export const ROLE_LIST_FIELDS = ['roleId', 'name'] as const;
export type RoleListField = (typeof ROLE_LIST_FIELDS)[number];

/** The role columns the list can be keyset-ordered by; `memberCount` is an aggregate and does not sort. */
export type RoleSortField = RoleListField;

/**
 * A parsed keyset list request, as the validator hands it to the repository: BE-19's query, the
 * free-text `q`, the one sort field and its order, and the checked cursor (`null` = the first page).
 */
export interface KeysetListRequest<TField extends string, TSort extends string> {
  readonly query: ListQuery<TField>;
  readonly search: string | null;
  readonly sortField: TSort;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<TSort> | null;
}

export type MemberListRequest = KeysetListRequest<MemberListField, MemberSortField>;
export type RoleListRequest = KeysetListRequest<RoleListField, RoleSortField>;

/** The fields `GET audit` accepts in `?filter[…]` / `?sort=` (BE-19 allowlist, ADR-0034 d.3). */
export const AUDIT_LIST_FIELDS = [
  'subjectStaffId',
  'actorStaffId',
  'changeType',
  'createdAt',
] as const;
export type AuditListField = (typeof AUDIT_LIST_FIELDS)[number];
