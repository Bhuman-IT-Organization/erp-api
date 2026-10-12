/**
 * Request/response DTOs and the repository row schemas. Types are `z.infer` of the schemas. A list
 * response is BE-19's envelope `{ data, meta }`: the members and roles lists answer the pager's meta
 * `{ nextCursor, prevCursor, total, rangeStart }` (`listPageMetaSchema`, `shared/http/keyset.ts`),
 * the audit log `{ nextCursor }`, the unpaged pickers `{ total }`; a single resource is a bare body;
 * the request id is never in a body (it travels in the `x-request-id` header).
 *
 * What no schema here names, on purpose: `tblstaff.password` and `last_password_change` (written,
 * never read back), the two-factor columns and the HR record columns — identity-access brief §2.1
 * leaves every one of them to Perfex or to a later slice. No audit shape carries a password, a token
 * or an e-mail (brief §7 fixes its columns).
 *
 * `profile_image` is named as `profileImageUrl` (the 96 px copy) and `profileImagePreviewUrl` (the
 * 320 px copy) and never as a file name: the wire carries the same-origin paths the transformer
 * builds, exactly as `v1/branding` carries `logoUrl`. Neither is ever the original upload.
 *
 * `lastLogin` and `lastActivity` are ISO strings or `null`, and each is on the shape whose legacy
 * view renders it: the list row carries `lastLogin` (`tables/staff.php`'s fourth column), and the
 * member response carries both, because it is a documented superset of the list row and
 * `views/admin/staff/member.php` shows Last Active in its header. Both are read-only columns.
 *
 * The two list *query* schemas are the **documented** surface (`@ApiZod`); the enforcement is
 * `shared/http/pagination.ts`'s `parseListQuery` with the module's allowed-field list (BE-19), and
 * `identity.validator.spec.ts` pins the two to the same bounds. They are declared as flat
 * `filter[field]` keys because that is what Fastify's `node:querystring` parser delivers.
 */
import { z } from 'zod';
import {
  exportBlankField,
  exportColumnField,
  exportDateFormatField,
  exportFormatField,
  exportHeaderField,
  exportNoField,
  exportTimeFormatField,
  exportTimeZoneField,
  exportTitleField,
  exportYesField,
} from '../../../shared/http/export.js';
import { listPageMetaSchema } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import { IDENTITY_CHANGE_TYPE_VALUES } from '../identity.routes.js';

const EMAIL_MAX = 100;
const NAME_MAX = 50;
const PHONE_MAX = 30;
const SKYPE_MAX = 50;
const LANGUAGE_MAX = 40;
const URL_MAX = 255;
const SIGNATURE_MAX = 16_000;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 200;
const SEARCH_MAX = 100;

/** `tblstaff.direction` is Perfex's three-character column: left-to-right or right-to-left. */
export const TEXT_DIRECTIONS = ['ltr', 'rtl'] as const;

// --- responses ---------------------------------------------------------------------------------

/** One row of `GET /api/v1/identity/members`. */
export const memberListRowSchema = z
  .object({
    staffId: z.number().int(),
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    phoneNumber: z.string().nullable(),
    /** A same-origin path under Perfex's uploads folder, or `null` when there is no usable photo. */
    profileImageUrl: z.string().nullable(),
    /** The 320 px `thumb_` copy for the list's image preview (D-23), or `null` exactly when the thumbnail is. */
    profileImagePreviewUrl: z.string().nullable(),
    isAdmin: z.boolean(),
    roleId: z.number().int().nullable(),
    /**
     * `tblroles.name` for `roleId`, so the list's Role column renders without a second request —
     * `tables/staff.php` shows `roles.name` to anyone who may view staff, and `GET roles` is
     * administrator-only (ADR-0034 d.3). `null` when the member holds no role, and `null` rather
     * than an error when the id no longer resolves (nothing constrains `tblstaff.role`, SF-7).
     */
    roleName: z.string().nullable(),
    active: z.boolean(),
    dateCreated: z.string(),
    /** ISO timestamp, or `null` when the member has never signed in (Perfex renders "Never"). */
    lastLogin: z.string().nullable(),
  })
  .readonly();

/**
 * The pager's meta plus the export caps: `exportLimit`, the most rows a CSV or Excel export answers
 * (`EXPORT_MAX_ROWS`), and `printLimit`, the most a PDF or print answers (`PRINT_MAX_ROWS`), so the
 * web can say BEFORE a click that this list is over one, with both numbers (03.2 lead decision 2a,
 * 04.1.1 D-06).
 */
export const listResponseMetaSchema = listPageMetaSchema.extend({
  exportLimit: z.number().int().positive(),
  printLimit: z.number().int().positive(),
});

export const memberListResponseSchema = z
  .object({
    data: z.array(memberListRowSchema),
    /** The pager's meta (both opaque cursors, `total`, the first row's rank) and the export cap. */
    meta: listResponseMetaSchema,
  })
  .readonly();

/** `GET /api/v1/identity/members/:id` — the profile columns of brief §2.1 plus the member's access. */
export const memberResponseSchema = z
  .object({
    staffId: z.number().int(),
    email: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    phoneNumber: z.string().nullable(),
    facebook: z.string().nullable(),
    linkedin: z.string().nullable(),
    skype: z.string().nullable(),
    hourlyRate: z.number(),
    defaultLanguage: z.string().nullable(),
    direction: z.string().nullable(),
    emailSignature: z.string().nullable(),
    mediaPathSlug: z.string().nullable(),
    /** A same-origin path under Perfex's uploads folder, or `null` when there is no usable photo. */
    profileImageUrl: z.string().nullable(),
    /** The 320 px `thumb_` copy for the image preview (D-23), or `null` exactly when the thumbnail is. */
    profileImagePreviewUrl: z.string().nullable(),
    dateCreated: z.string(),
    /** ISO timestamp, or `null` when the member has never signed in. */
    lastLogin: z.string().nullable(),
    /** ISO timestamp of the member's last legacy request, or `null` (the member page's header). */
    lastActivity: z.string().nullable(),
    isAdmin: z.boolean(),
    roleId: z.number().int().nullable(),
    roleName: z.string().nullable(),
    active: z.boolean(),
    isNotStaff: z.boolean(),
    departmentIds: z.array(z.number().int()),
    permissions: z.array(z.string()),
  })
  .readonly();

/** One row of `GET /api/v1/identity/audit` — brief §7's columns, nothing else. */
export const auditListRowSchema = z
  .object({
    id: z.string(),
    actorStaffId: z.number().int(),
    subjectStaffId: z.number().int().nullable(),
    subjectRoleId: z.number().int().nullable(),
    changeType: z.enum(IDENTITY_CHANGE_TYPE_VALUES),
    permissionCode: z.string().nullable(),
    beforeValue: z.string().nullable(),
    afterValue: z.string().nullable(),
    requestId: z.string(),
    createdAt: z.string(),
  })
  .readonly();

export const auditListResponseSchema = z
  .object({
    data: z.array(auditListRowSchema),
    meta: z.object({ nextCursor: z.string().nullable() }),
  })
  .readonly();

/** One row of `GET /api/v1/identity/roles`; `memberCount` is what the roles list shows per row. */
export const roleListRowSchema = z
  .object({
    roleId: z.number().int(),
    name: z.string(),
    memberCount: z.number().int().nonnegative(),
  })
  .readonly();

export const roleListResponseSchema = z
  .object({
    data: z.array(roleListRowSchema),
    /** The members list's meta: both cursors, `total`, `rangeStart` and the export cap. */
    meta: listResponseMetaSchema,
  })
  .readonly();

/** One member of a role in `GET /api/v1/identity/roles/:id`. Never a password, never a hash. */
export const roleMemberSchema = z
  .object({
    staffId: z.number().int(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    active: z.boolean(),
  })
  .readonly();

/** `GET /api/v1/identity/roles/:id` — the template in clean ADR-0033 names, plus its members. */
export const roleResponseSchema = z
  .object({
    roleId: z.number().int(),
    name: z.string(),
    permissions: z.array(z.string()),
    members: z.array(roleMemberSchema),
    memberCount: z.number().int().nonnegative(),
  })
  .readonly();

/** One resource row of the catalogue grid. */
export const permissionCatalogueResourceSchema = z
  .object({
    resource: z.string(),
    actions: z.array(z.object({ action: z.string(), code: z.string() })),
  })
  .readonly();

/**
 * `GET /api/v1/identity/permissions/catalogue` — the clean-name tree of `@erp/contracts`, grouped
 * `module -> resource -> action`, which is exactly the shape the checkbox grid renders (it replaces
 * Perfex's `get_available_staff_permissions()`). Not read from the database and not paged, so the
 * envelope carries `total` — the number of codes — and no cursor.
 */
export const permissionCatalogueResponseSchema = z
  .object({
    data: z.array(
      z.object({ module: z.string(), resources: z.array(permissionCatalogueResourceSchema) }),
    ),
    meta: z.object({ total: z.number().int().nonnegative() }),
  })
  .readonly();

/**
 * `GET /api/v1/identity/locales` — what the member form's language select may offer. Each entry is
 * the BCP-47 tag the web switches on plus the `legacyLanguage` value to submit as `defaultLanguage`,
 * which is what `tblstaff.default_language` stores (Perfex's pack folder name). Not a table read and
 * not paged, so the envelope carries `total` and no cursor; the "System Default" option is the web's
 * (`defaultLanguage: null`), not a row here.
 */
export const localeListResponseSchema = z
  .object({
    data: z.array(z.object({ locale: z.string(), legacyLanguage: z.string() })),
    meta: z.object({ total: z.number().int().nonnegative() }),
  })
  .readonly();

/** `GET /api/v1/identity/departments`: the picker, `{ departmentId, name }` as `DepartmentsFacade` answers it (D-55). */
export const departmentListResponseSchema = z
  .object({
    data: z.array(z.object({ departmentId: z.number().int(), name: z.string() })),
    meta: z.object({ total: z.number().int().nonnegative() }),
  })
  .readonly();

// --- queries (documented surface; parseListQuery enforces) --------------------------------------

const limitField = z.coerce
  .number()
  .int()
  .min(LIST_QUERY_LIMITS.min)
  .max(LIST_QUERY_LIMITS.max)
  .default(LIST_QUERY_LIMITS.default);
const cursorField = z.string().min(1).optional();

export const listMembersQuerySchema = z.object({
  limit: limitField,
  cursor: cursorField,
  /** Free-text search over first name, last name and e-mail (Perfex's staff-table search box). */
  q: z.string().max(SEARCH_MAX).optional(),
  /** One of `staffId` (default), `firstName`, `email`, `active`; a leading `-` is descending. */
  sort: z.string().optional(),
  'filter[active]': z.string().optional(),
  'filter[isAdmin]': z.string().optional(),
  'filter[roleId]': z.string().optional(),
  'filter[email]': z.string().optional(),
  'filter[firstName]': z.string().optional(),
  'filter[lastName]': z.string().optional(),
});

export const listAuditQuerySchema = z.object({
  limit: limitField,
  cursor: cursorField,
  sort: z.string().optional(),
  'filter[subjectStaffId]': z.string().optional(),
  'filter[actorStaffId]': z.string().optional(),
  'filter[changeType]': z.string().optional(),
  'filter[createdAt]': z.string().optional(),
});

export const listRolesQuerySchema = z.object({
  limit: limitField,
  cursor: cursorField,
  /** Free-text search over the role name, bounded like the members list's. */
  q: z.string().max(SEARCH_MAX).optional(),
  /** `roleId` (default) or `name`; a leading `-` is descending. */
  sort: z.string().optional(),
  'filter[name]': z.string().optional(),
});

/**
 * `GET members/export` - the list query minus `limit` and `cursor` (an export is every row), plus
 * the export parameters of ADR-0043 as literal keys. Documentation only: `parseExportOptions` in
 * `shared/http/export.ts` is the gate (each refusal a 400 on its own path). No `key`: the members
 * list has no row selection (D-27).
 */
export const exportMembersQuerySchema = listMembersQuerySchema
  .omit({ limit: true, cursor: true })
  .extend({
    header: exportHeaderField,
    format: exportFormatField,
    column: exportColumnField,
    title: exportTitleField,
    yes: exportYesField,
    no: exportNoField,
    blank: exportBlankField,
    dateFormat: exportDateFormatField,
    timeFormat: exportTimeFormatField,
    timeZone: exportTimeZoneField,
  });

/** `GET roles/export` - the list query minus `limit` and `cursor`, plus the export parameters (no `key`). */
export const exportRolesQuerySchema = listRolesQuerySchema
  .omit({ limit: true, cursor: true })
  .extend({
    header: exportHeaderField,
    format: exportFormatField,
    column: exportColumnField,
    title: exportTitleField,
    yes: exportYesField,
    no: exportNoField,
    blank: exportBlankField,
    dateFormat: exportDateFormatField,
    timeFormat: exportTimeFormatField,
    timeZone: exportTimeZoneField,
  });

/** `:id` of the member routes. */
export const memberParamsSchema = z.object({ id: z.coerce.number().int().positive() });

/** `:id` of the role routes. */
export const roleParamsSchema = z.object({ id: z.coerce.number().int().positive() });

// --- write bodies ------------------------------------------------------------------------------

const profileFields = {
  phoneNumber: z.string().max(PHONE_MAX).nullish(),
  facebook: z.string().max(URL_MAX).nullish(),
  linkedin: z.string().max(URL_MAX).nullish(),
  skype: z.string().max(SKYPE_MAX).nullish(),
  hourlyRate: z.number().nonnegative().optional(),
  defaultLanguage: z.string().max(LANGUAGE_MAX).nullish(),
  direction: z.enum(TEXT_DIRECTIONS).nullish(),
  emailSignature: z.string().max(SIGNATURE_MAX).nullish(),
  isNotStaff: z.boolean().optional(),
  departmentIds: z.array(z.number().int().positive()).optional(),
} as const;

/**
 * The three granting fields, in the wire spelling. `roleId`, `permissions` and `admin` are the
 * fields `granting-policy.ts` answers for; a request carrying any of them needs `tblstaff.admin = 1`
 * on the actor (ADR-0034 d.2). `permissions` are clean ADR-0033 names; an unknown one is a 422.
 */
const grantingFields = {
  roleId: z.number().int().positive().nullish(),
  permissions: z.array(z.string().min(1)).optional(),
  admin: z.boolean().optional(),
} as const;

/** `POST /api/v1/identity/members`. Strict: an unknown key is a 400, never a silently ignored grant. */
export const createMemberBodySchema = z.strictObject({
  email: z.email().max(EMAIL_MAX),
  firstName: z.string().min(1).max(NAME_MAX),
  lastName: z.string().min(1).max(NAME_MAX),
  password: z.string().min(PASSWORD_MIN).max(PASSWORD_MAX),
  ...profileFields,
  ...grantingFields,
});

/** `PATCH /api/v1/identity/members/:id`. An empty `password` means "unchanged" (brief §3). */
export const updateMemberBodySchema = z.strictObject({
  email: z.email().max(EMAIL_MAX).optional(),
  firstName: z.string().min(1).max(NAME_MAX).optional(),
  lastName: z.string().min(1).max(NAME_MAX).optional(),
  password: z.union([z.literal(''), z.string().min(PASSWORD_MIN).max(PASSWORD_MAX)]).optional(),
  ...profileFields,
  ...grantingFields,
});

/** `PATCH /api/v1/identity/members/:id/status` — 204, and never a grant. */
export const memberStatusBodySchema = z.strictObject({ active: z.boolean() });

const ROLE_NAME_MAX = 150;

/**
 * `POST /api/v1/identity/roles`. A role IS a permission set, so the whole body is a granting field
 * and the endpoint is gated on the administrator flag (ADR-0034 d.2) — there is no profile half to
 * let a non-administrator through. `permissions` are clean ADR-0033 names; an unknown one is a 422.
 */
export const createRoleBodySchema = z.strictObject({
  name: z.string().min(1).max(ROLE_NAME_MAX),
  permissions: z.array(z.string().min(1)).default([]),
});

/**
 * `PATCH /api/v1/identity/roles/:id`. `applyToMembers` is Perfex's `update_staff_permissions`
 * checkbox: every member holding the role has their permission rows replaced by the new template,
 * in the same transaction as the role write.
 */
export const updateRoleBodySchema = z.strictObject({
  name: z.string().min(1).max(ROLE_NAME_MAX).optional(),
  permissions: z.array(z.string().min(1)).optional(),
  applyToMembers: z.boolean().optional(),
});

// --- repository rows ---------------------------------------------------------------------------

/**
 * One `tblstaff` row as the typed delegate returns it. `hourly_rate` is a Prisma `Decimal`, which
 * `z.coerce.number()` reads through its `toString`; `datecreated` is a `Date`.
 */
export const staffRowSchema = z.object({
  staffid: z.number().int(),
  email: z.string(),
  firstname: z.string(),
  lastname: z.string(),
  phonenumber: z.string().nullable(),
  facebook: z.string().nullable(),
  linkedin: z.string().nullable(),
  skype: z.string().nullable(),
  hourly_rate: z.coerce.number(),
  default_language: z.string().nullable(),
  direction: z.string().nullable(),
  email_signature: z.string().nullable(),
  media_path_slug: z.string().nullable(),
  profile_image: z.string().nullable(),
  datecreated: z.date(),
  last_login: z.date().nullable(),
  last_activity: z.date().nullable(),
  admin: z.number().int(),
  role: z.number().int().nullable(),
  active: z.number().int(),
  is_not_staff: z.number().int(),
});

/** One `tblstaff_permissions` row of the raw read — the table has no primary key, so no delegate. */
export const perfexPermissionRowSchema = z.object({
  feature: z.string(),
  capability: z.string(),
});

/** One `tblroles` row; `permissions` is still PHP `serialize()` text (brief §2.1). */
export const roleRowSchema = z.object({
  roleid: z.number().int(),
  name: z.string(),
  permissions: z.string().nullable(),
});

/** One `tblidentity_audit` row as the typed delegate returns it (`id` is a `BIGINT UNSIGNED`). */
export const auditRowSchema = z.object({
  id: z.bigint(),
  actor_staff_id: z.number().int(),
  subject_staff_id: z.number().int().nullable(),
  subject_role_id: z.number().int().nullable(),
  change_type: z.enum(IDENTITY_CHANGE_TYPE_VALUES),
  permission_code: z.string().nullable(),
  before_value: z.string().nullable(),
  after_value: z.string().nullable(),
  request_id: z.string(),
  created_at: z.date(),
});

/** One `tblroles` row of the list read: the two columns the list needs, never the template text. */
export const roleListDbRowSchema = z.object({
  roleid: z.number().int(),
  name: z.string(),
});

/** One `tblstaff` row of a role's member list. */
export const roleMemberRowSchema = z.object({
  staffid: z.number().int(),
  firstname: z.string(),
  lastname: z.string(),
  email: z.string(),
  active: z.number().int(),
});

export type MemberListRowDto = z.infer<typeof memberListRowSchema>;
export type ListResponseMeta = z.infer<typeof listResponseMetaSchema>;
export type MemberListResponseDto = z.infer<typeof memberListResponseSchema>;
export type MemberResponseDto = z.infer<typeof memberResponseSchema>;
export type AuditListRowDto = z.infer<typeof auditListRowSchema>;
export type AuditListResponseDto = z.infer<typeof auditListResponseSchema>;
export type ListMembersQuery = z.infer<typeof listMembersQuerySchema>;
export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
export type MemberParams = z.infer<typeof memberParamsSchema>;
export type CreateMemberBody = z.infer<typeof createMemberBodySchema>;
export type UpdateMemberBody = z.infer<typeof updateMemberBodySchema>;
export type MemberStatusBody = z.infer<typeof memberStatusBodySchema>;
export type StaffRow = z.infer<typeof staffRowSchema>;
export type PerfexPermissionRowDto = z.infer<typeof perfexPermissionRowSchema>;
export type RoleRowDto = z.infer<typeof roleRowSchema>;
export type AuditRow = z.infer<typeof auditRowSchema>;
export type RoleListRowDto = z.infer<typeof roleListRowSchema>;
export type RoleListResponseDto = z.infer<typeof roleListResponseSchema>;
export type RoleMemberDto = z.infer<typeof roleMemberSchema>;
export type RoleResponseDto = z.infer<typeof roleResponseSchema>;
export type PermissionCatalogueResponseDto = z.infer<typeof permissionCatalogueResponseSchema>;
export type DepartmentListResponseDto = z.infer<typeof departmentListResponseSchema>;
export type LocaleListResponseDto = z.infer<typeof localeListResponseSchema>;
export type ListRolesQuery = z.infer<typeof listRolesQuerySchema>;
export type ExportMembersQuery = z.infer<typeof exportMembersQuerySchema>;
export type ExportRolesQuery = z.infer<typeof exportRolesQuerySchema>;
export type RoleParams = z.infer<typeof roleParamsSchema>;
export type CreateRoleBody = z.infer<typeof createRoleBodySchema>;
export type UpdateRoleBody = z.infer<typeof updateRoleBodySchema>;
export type RoleListDbRow = z.infer<typeof roleListDbRowSchema>;
export type RoleMemberRow = z.infer<typeof roleMemberRowSchema>;
