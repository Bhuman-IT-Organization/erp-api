/**
 * Transformer: entity → response DTO. Every DTO is built field by field and then parsed through its
 * zod response schema, which strips any key the schema does not name — so a `tblstaff` column brief
 * §2.1 leaves to Perfex, a password hash or an audit internal can never ride along (T-2-14,
 * threat T-3.1-45). The versioned wire shape lives here and in `dto/`; the controller never imports
 * this class (BE-08).
 *
 * One URL contract lives here and nowhere else — the member's photo — and it is the company-logo
 * contract of `v1/branding`'s transformer applied to a second file: the entity carries the bare
 * stored file name, this class turns it into a same-origin path in two sizes (the thumbnail and the
 * preview), and a name the guard refuses is `null` for both rather than a path
 * (`profileImageUrl` below).
 */
import { Injectable } from '@nestjs/common';
import type { SupportedLocale } from '../../../shared/config/legacy-locale.js';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import {
  auditListResponseSchema,
  auditListRowSchema,
  departmentListResponseSchema,
  localeListResponseSchema,
  memberListResponseSchema,
  memberListRowSchema,
  memberResponseSchema,
  permissionCatalogueResponseSchema,
  roleListResponseSchema,
  roleResponseSchema,
  type AuditListResponseDto,
  type AuditListRowDto,
  type DepartmentListResponseDto,
  type ListResponseMeta,
  type LocaleListResponseDto,
  type MemberListResponseDto,
  type MemberListRowDto,
  type MemberResponseDto,
  type PermissionCatalogueResponseDto,
  type RoleListResponseDto,
  type RoleResponseDto,
} from '../dto/identity.dto.js';
import type {
  Department,
  EnrichedStaffMember,
  IdentityAuditRow,
  MemberListRow,
  PermissionCatalogueModule,
  RoleDetail,
  RoleListRow,
} from '../model/identity.model.js';

/**
 * Perfex's staff-photo folder, served same-origin from the legacy document root
 * (`uploads/staff_profile_images/<staffid>/<size>_<file>`, `helpers/staff_helper.php:236`).
 */
export const STAFF_PROFILE_IMAGES_PATH = '/uploads/staff_profile_images';

/**
 * The two size prefixes the wire uses. Perfex's uploader writes exactly two resized copies and
 * deletes the original (`helpers/upload_helper.php`): `thumb_` at 320 px and `small_` at 96 px.
 * `small_` is the one the legacy staff LIST renders — `tables/staff.php` calls
 * `staff_profile_image($staffid, …)` with the default `$type = 'small'` — and stays the list's 40 px
 * thumbnail (`profileImageUrl`, sharp at 2x DPR). The 320 px copy now ships as
 * `profileImagePreviewUrl` because the list's image preview needs it (D-23): it is the largest copy
 * that exists, so the preview shows it at natural size and never upscales. The original upload is
 * never exposed, because Perfex deletes it — there is no third size to address.
 */
export const STAFF_PROFILE_IMAGE_SIZE = 'small';

/** The 320 px copy, the largest Perfex keeps; the list's preview dialog shows it (D-23). */
export const STAFF_PROFILE_PREVIEW_SIZE = 'thumb';

/** A file name longer than this is refused: NAME_MAX on every filesystem Perfex runs on. */
const MAX_FILE_NAME_LENGTH = 255;

/** A path separator, a parent-directory pair, or a control character (\p{Cc}: U+0000-001F, U+007F-009F). */
const UNSAFE_IN_FILE_NAME = /[/\\]|\.\.|\p{Cc}/u;

/**
 * Perfex keeps the uploaded name (`unique_filename` → CodeIgniter `sanitize_filename`, which leaves
 * spaces and parentheses: `42010_Jane Doe_0.jpg`), so the guard refuses only what could leave the
 * member's folder or corrupt the URL: empty, over-long, a separator, `..`, a leading dot, a control
 * character. `profileImageUrl` percent-encodes the one segment built from the name. The company
 * logo in `v1/branding` keeps its strict guard: Perfex names logos `md5(...).ext`
 * (`handle_company_logo_upload`), so there the strict pattern is the real shape.
 */
function isSafeFileName(file: string): boolean {
  return (
    file !== '' &&
    file.length <= MAX_FILE_NAME_LENGTH &&
    !file.startsWith('.') &&
    !UNSAFE_IN_FILE_NAME.test(file)
  );
}

/**
 * The same-origin path of one member's `size` photo copy, or `null` for an empty or refused name: the
 * rule `profileImageUrl` applies.
 */
function staffProfileImagePath(
  staffId: number,
  file: string | null,
  size: typeof STAFF_PROFILE_IMAGE_SIZE | typeof STAFF_PROFILE_PREVIEW_SIZE,
): string | null {
  if (file === null || !isSafeFileName(file)) return null;
  return `${STAFF_PROFILE_IMAGES_PATH}/${String(staffId)}/${encodeURIComponent(`${size}_${file}`)}`;
}

@Injectable()
export class IdentityTransformer {
  toListRow(row: MemberListRow): MemberListRowDto {
    return memberListRowSchema.parse({
      staffId: row.staffId,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      phoneNumber: row.phoneNumber,
      profileImageUrl: this.profileImageUrl(
        row.staffId,
        row.profileImage,
        STAFF_PROFILE_IMAGE_SIZE,
      ),
      profileImagePreviewUrl: this.profileImageUrl(
        row.staffId,
        row.profileImage,
        STAFF_PROFILE_PREVIEW_SIZE,
      ),
      isAdmin: row.isAdmin,
      roleId: row.roleId,
      roleName: row.roleName,
      active: row.active,
      dateCreated: row.dateCreated,
      lastLogin: row.lastLogin,
    });
  }

  /** The BE-19 list envelope with the pager's meta, which the repository computed. */
  toListResponse(rows: readonly MemberListRow[], meta: ListPageMeta): MemberListResponseDto {
    return memberListResponseSchema.parse({
      data: rows.map((row) => this.toListRow(row)),
      meta: this.toListMeta(meta),
    });
  }

  toMemberResponse(member: EnrichedStaffMember): MemberResponseDto {
    return memberResponseSchema.parse({
      staffId: member.staffId,
      email: member.email,
      firstName: member.firstName,
      lastName: member.lastName,
      phoneNumber: member.phoneNumber,
      facebook: member.facebook,
      linkedin: member.linkedin,
      skype: member.skype,
      hourlyRate: member.hourlyRate,
      defaultLanguage: member.defaultLanguage,
      direction: member.direction,
      emailSignature: member.emailSignature,
      mediaPathSlug: member.mediaPathSlug,
      profileImageUrl: this.profileImageUrl(
        member.staffId,
        member.profileImage,
        STAFF_PROFILE_IMAGE_SIZE,
      ),
      profileImagePreviewUrl: this.profileImageUrl(
        member.staffId,
        member.profileImage,
        STAFF_PROFILE_PREVIEW_SIZE,
      ),
      dateCreated: member.dateCreated,
      lastLogin: member.lastLogin,
      lastActivity: member.lastActivity,
      isAdmin: member.isAdmin,
      roleId: member.roleId,
      roleName: member.roleName,
      active: member.active,
      isNotStaff: member.isNotStaff,
      departmentIds: [...member.departmentIds],
      permissions: [...member.permissions],
    });
  }

  /** The BE-19 roles envelope; each row carries its `memberCount`, the meta is the members list's. */
  toRoleListResponse(rows: readonly RoleListRow[], meta: ListPageMeta): RoleListResponseDto {
    return roleListResponseSchema.parse({
      data: rows.map((row) => ({
        roleId: row.roleId,
        name: row.name,
        memberCount: row.memberCount,
      })),
      meta: this.toListMeta(meta),
    });
  }

  /**
   * The four meta fields, field by field (a page object passed as the meta carries nothing else),
   * and the export caps from their one definitions, `EXPORT_MAX_ROWS` and `PRINT_MAX_ROWS`.
   */
  private toListMeta(meta: ListPageMeta): ListResponseMeta {
    return {
      nextCursor: meta.nextCursor,
      prevCursor: meta.prevCursor,
      total: meta.total,
      rangeStart: meta.rangeStart,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    };
  }

  toRoleResponse(role: RoleDetail): RoleResponseDto {
    return roleResponseSchema.parse({
      roleId: role.roleId,
      name: role.name,
      permissions: [...role.permissions],
      members: role.members.map((member) => ({
        staffId: member.staffId,
        firstName: member.firstName,
        lastName: member.lastName,
        email: member.email,
        active: member.active,
      })),
      memberCount: role.memberCount,
    });
  }

  /** `total` is the number of codes the catalogue declares, so the grid can show a count. */
  toPermissionCatalogueResponse(
    modules: readonly PermissionCatalogueModule[],
  ): PermissionCatalogueResponseDto {
    const total = modules.reduce(
      (sum, module) =>
        sum + module.resources.reduce((inner, resource) => inner + resource.actions.length, 0),
      0,
    );
    return permissionCatalogueResponseSchema.parse({
      data: modules.map((module) => ({
        module: module.module,
        resources: module.resources.map((resource) => ({
          resource: resource.resource,
          actions: resource.actions.map((action) => ({ action: action.action, code: action.code })),
        })),
      })),
      meta: { total },
    });
  }

  /**
   * The locales the deployment supports, from the `SUPPORTED_LOCALES` constant rather than a table:
   * each entry is the BCP-47 tag the web switches on and the legacy pack name the member's
   * `default_language` column must hold. `total` is the count, as the catalogue does it.
   */
  toLocaleListResponse(locales: readonly SupportedLocale[]): LocaleListResponseDto {
    return localeListResponseSchema.parse({
      data: locales.map((entry) => ({
        locale: entry.locale,
        legacyLanguage: entry.legacyLanguage,
      })),
      meta: { total: locales.length },
    });
  }

  /** Two keys and no more, built key by key: anything else a department carried is dropped here (T-3.1-51, D-55). */
  toDepartmentListResponse(departments: readonly Department[]): DepartmentListResponseDto {
    return departmentListResponseSchema.parse({
      data: departments.map((row) => ({ departmentId: row.departmentId, name: row.name })),
      meta: { total: departments.length },
    });
  }

  toAuditRow(row: IdentityAuditRow): AuditListRowDto {
    return auditListRowSchema.parse({
      id: row.id,
      actorStaffId: row.actorStaffId,
      subjectStaffId: row.subjectStaffId,
      subjectRoleId: row.subjectRoleId,
      changeType: row.changeType,
      permissionCode: row.permissionCode,
      beforeValue: row.beforeValue,
      afterValue: row.afterValue,
      requestId: row.requestId,
      createdAt: row.createdAt.toISOString(),
    });
  }

  toAuditResponse(
    rows: readonly IdentityAuditRow[],
    nextCursor: string | null,
  ): AuditListResponseDto {
    return auditListResponseSchema.parse({
      data: rows.map((row) => this.toAuditRow(row)),
      meta: { nextCursor },
    });
  }

  /**
   * `tblstaff.profile_image` → the same-origin path Perfex serves the `size` copy from (`small` 96 px
   * or `thumb` 320 px), or `null`. `null` on an empty column **and** on any name `isSafeFileName`
   * refuses (empty, over 255 characters, a `/` or `\`, `..`, a leading dot, a control character),
   * for BOTH sizes, so a crafted value can never leave this folder or reach the wire. Every other
   * name is accepted and the one segment built from it (`<size>_<file>`) is percent-encoded
   * (`encodeURIComponent`), so a space, `%`, `#` or `?` in a Perfex name stays inside that segment.
   */
  private profileImageUrl(
    staffId: number,
    file: string | null,
    size: typeof STAFF_PROFILE_IMAGE_SIZE | typeof STAFF_PROFILE_PREVIEW_SIZE,
  ): string | null {
    return staffProfileImagePath(staffId, file, size);
  }
}
