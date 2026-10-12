/**
 * HTTP entry for `api/v1/identity`. Decorators bind the route, the guards and the API documentation
 * (`@ApiZod` names the zod schemas and the error codes — BE-23); the handler makes one service call
 * and returns its DTO. Controllers hold no logic, import no transformer and never catch (the
 * architecture block rejects a `try` here): every failure reaches `ProblemDetailsFilter`.
 *
 * Every handler carries `@UseGuards(JwtAuthGuard, PermissionGuard)`; this module has no anonymous
 * endpoint (identity-access brief §3.1).
 *
 * **Reads keep their view permission; granting does not have one.** ADR-0034 decision 2: changing a
 * member's role, permission set or administrator flag needs `tblstaff.admin = 1` on the actor and
 * never a permission code. So the two save handlers declare `staff.members.create` / `edit` for the
 * profile half — which is what lets a non-administrator save a profile, a department set and a
 * status — and `service/granting-policy.ts` refuses the granting half with 403 `ERP-IDENTITY-0001`.
 * `GET audit` carries the administrator check for the same reason and declares no code at all: who
 * holds what is exactly what the log records.
 *
 * No handler declares `staff.roles.create`, `staff.roles.edit` or `staff.roles.delete`; those codes
 * stay in the `@erp/contracts` mapping for Perfex's own screens and gate nothing here. **The three
 * role writes therefore declare no permission code at all** — a role IS a permission set, so every
 * one of them is a grant and `assertMayGrant` in the service is the whole gate (brief §5's
 * 2026-09-23 correction table, ADR-0034 d.2).
 *
 * **Since the migration lead's 2026-09-24 decision no roles handler declares a code either**, read
 * or write: `staff.roles.view` joins the other 49 declared-but-unused admin-only codes in the
 * catalogue rather than being deleted, and `listRoles`/`getRole` assert the administrator flag in
 * the service. `@erp/contracts`' `ROUTE_GATES` is the one place that gate is declared, and
 * `__tests__/route-gates.spec.ts` compares every handler below with it.
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { CurrentUser } from '../../../shared/http/decorators/current-user.decorator.js';
import {
  Permissions,
  PermissionsAny,
} from '../../../shared/http/decorators/permissions.decorator.js';
import { JwtAuthGuard } from '../../../shared/http/guards/jwt-auth.guard.js';
import { PermissionGuard } from '../../../shared/http/guards/permission.guard.js';
import { replyExport, type ExportFile } from '../../../shared/http/export.js';
import { ApiZod } from '../../../shared/http/openapi.js';
import { HTTP_STATUS } from '../../../shared/http/status.js';
import {
  auditListResponseSchema,
  createMemberBodySchema,
  createRoleBodySchema,
  departmentListResponseSchema,
  exportMembersQuerySchema,
  exportRolesQuerySchema,
  listAuditQuerySchema,
  listMembersQuerySchema,
  listRolesQuerySchema,
  localeListResponseSchema,
  memberListResponseSchema,
  memberParamsSchema,
  memberResponseSchema,
  memberStatusBodySchema,
  permissionCatalogueResponseSchema,
  roleListResponseSchema,
  roleParamsSchema,
  roleResponseSchema,
  updateMemberBodySchema,
  updateRoleBodySchema,
  type AuditListResponseDto,
  type DepartmentListResponseDto,
  type LocaleListResponseDto,
  type MemberListResponseDto,
  type MemberResponseDto,
  type PermissionCatalogueResponseDto,
  type RoleListResponseDto,
  type RoleResponseDto,
} from '../dto/identity.dto.js';
import { IDENTITY_PERMISSIONS, IDENTITY_ROUTES } from '../identity.routes.js';
import { IdentityService } from '../service/identity.service.js';

@Controller(IDENTITY_ROUTES.base)
export class IdentityController {
  constructor(private readonly service: IdentityService) {}

  /** `GET /api/v1/identity/members?limit&cursor&q&filter[…]&sort` → the BE-19 list envelope. */
  @Get(IDENTITY_ROUTES.members)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(IDENTITY_PERMISSIONS.members.view)
  @ApiZod({
    summary: 'List staff members (keyset paging, BE-19 filter and sort grammar)',
    query: listMembersQuerySchema,
    responses: { [HTTP_STATUS.OK]: memberListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  listMembers(@Query() query: unknown): Promise<MemberListResponseDto> {
    return this.service.listMembers(query);
  }

  /**
   * `GET /api/v1/identity/members/export?format&column&header&q&filter[...]&sort` - every member the
   * list's query matches as CSV, Excel, PDF or print rows (D-26, ADR-0043), gated exactly like the
   * list. The service answers the export; `replyExport` sets its headers on the passthrough reply.
   */
  @Get(IDENTITY_ROUTES.membersExport)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(IDENTITY_PERMISSIONS.members.view)
  @ApiZod({
    summary: 'Export every staff member the list query matches as CSV, Excel, PDF or print rows',
    query: exportMembersQuerySchema,
    produces: 'export',
    responses: {},
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005'],
    headers: ['Content-Disposition', 'Cache-Control'],
  })
  async exportMembers(
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ExportFile['body']> {
    return replyExport(reply, await this.service.exportMembers(query));
  }

  /** `GET /api/v1/identity/members/:id` → the member's profile, departments, role and permissions. */
  @Get(IDENTITY_ROUTES.member)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(IDENTITY_PERMISSIONS.members.view)
  @ApiZod({
    summary: 'Read one staff member',
    params: memberParamsSchema,
    responses: { [HTTP_STATUS.OK]: memberResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-AUTH-0005', 'ERP-IDENTITY-0005'],
  })
  getMember(@Param() params: unknown): Promise<MemberResponseDto> {
    return this.service.getMember(params);
  }

  /**
   * `POST /api/v1/identity/members` — the profile half runs on `staff.members.create`; `roleId`,
   * `permissions` or `admin` in the body additionally needs the administrator flag (ADR-0034 d.2).
   */
  @Post(IDENTITY_ROUTES.members)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(IDENTITY_PERMISSIONS.members.create)
  @ApiZod({
    summary: 'Create a staff member; a granting field additionally requires the administrator flag',
    body: createMemberBodySchema,
    responses: { [HTTP_STATUS.CREATED]: memberResponseSchema },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-IDENTITY-0001',
      'ERP-IDENTITY-0002',
      'ERP-IDENTITY-0003',
      // SF-7: `roleId` must name a real role — `tblroles` has no foreign key, so an unchecked id
      // becomes the dangling reference `DELETE /roles/:id` answers 409 to prevent.
      'ERP-IDENTITY-0008',
      // D-55: a department id new for the member that DepartmentsFacade does not know.
      'ERP-IDENTITY-0009',
    ],
  })
  createMember(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<MemberResponseDto> {
    return this.service.createMember(user, body);
  }

  /**
   * `PATCH /api/v1/identity/members/:id` — the profile half runs on `staff.members.edit`; `roleId`,
   * `permissions` or `admin` in the body additionally needs the administrator flag (ADR-0034 d.2).
   */
  @Patch(IDENTITY_ROUTES.member)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(IDENTITY_PERMISSIONS.members.edit)
  @ApiZod({
    summary: 'Update a staff member; a granting field additionally requires the administrator flag',
    params: memberParamsSchema,
    body: updateMemberBodySchema,
    responses: { [HTTP_STATUS.OK]: memberResponseSchema },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-IDENTITY-0001',
      'ERP-IDENTITY-0002',
      'ERP-IDENTITY-0003',
      'ERP-IDENTITY-0004',
      'ERP-IDENTITY-0005',
      // SF-7, as on `POST members`.
      'ERP-IDENTITY-0008',
      // D-55, as on `POST members`.
      'ERP-IDENTITY-0009',
    ],
  })
  updateMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<MemberResponseDto> {
    return this.service.updateMember(user, params, body);
  }

  /** `PATCH /api/v1/identity/members/:id/status` — 204. Deactivation is not granting (brief §5). */
  @Patch(IDENTITY_ROUTES.memberStatus)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(IDENTITY_PERMISSIONS.members.edit)
  @ApiZod({
    summary: 'Activate or deactivate a staff member',
    params: memberParamsSchema,
    body: memberStatusBodySchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-AUTH-0005',
      'ERP-IDENTITY-0004',
      'ERP-IDENTITY-0005',
    ],
  })
  setMemberStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<void> {
    return this.service.setMemberStatus(user, params, body);
  }

  /**
   * `GET /api/v1/identity/roles?limit&cursor&filter[name]&sort` → the BE-19 envelope, `memberCount`
   * per row. **Administrators only, and no permission code at all** (migration-lead decision
   * 2026-09-24, `ROUTE_GATES['/setup/roles'] === 'admin'`): a role row names a permission template, and
   * `staff.roles.view` gated this read while the menu already hid it behind `is_admin()`, so a
   * non-administrator holding that one code could map the whole permission system. The assertion is
   * the service's, exactly as `GET audit` does it — `PermissionGuard` has no `isAdmin` branch by
   * design (ADR-0033 d.4) and a code that opened this read could be handed out by the mechanism it
   * protects.
   */
  @Get(IDENTITY_ROUTES.roles)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'List roles with their member counts (administrators only; keyset paging, BE-19)',
    query: listRolesQuerySchema,
    responses: { [HTTP_STATUS.OK]: roleListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-IDENTITY-0004'],
  })
  listRoles(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<RoleListResponseDto> {
    return this.service.listRoles(user, query);
  }

  /**
   * `GET /api/v1/identity/roles/export?format&column&header&q&filter[name]&sort` - every role the
   * list's query matches as CSV, Excel, PDF or print rows. **Administrators only and no permission
   * code**, exactly like `listRoles`: the service asserts the flag first, for every format.
   */
  @Get(IDENTITY_ROUTES.rolesExport)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Export every role the list query matches as CSV, Excel, PDF or print rows (administrators only)',
    query: exportRolesQuerySchema,
    produces: 'export',
    responses: {},
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-IDENTITY-0004'],
    headers: ['Content-Disposition', 'Cache-Control'],
  })
  async exportRoles(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ExportFile['body']> {
    return replyExport(reply, await this.service.exportRoles(user, query));
  }

  /**
   * `GET /api/v1/identity/roles/:id` — the template in clean ADR-0033 names plus its members.
   * **Administrators only**, for the same reason as the list: this response IS a permission
   * template. It used to admit `staff.roles.view` **or** `staff.members.view` so the member form
   * could pre-tick the grid on a role change; only an administrator may change a role select
   * (ADR-0034 d.2), so that read is an administrator's too and the member form is unaffected.
   */
  @Get(IDENTITY_ROUTES.role)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary:
      'Read one role (administrators only): its template in clean names and the members holding it',
    params: roleParamsSchema,
    responses: { [HTTP_STATUS.OK]: roleResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-IDENTITY-0004', 'ERP-IDENTITY-0008'],
  })
  getRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
  ): Promise<RoleResponseDto> {
    return this.service.getRole(user, params);
  }

  /**
   * `POST /api/v1/identity/roles` — **no permission code**: the body is a name and a permission set,
   * so the whole request is a grant and the administrator flag is the gate (ADR-0034 d.2).
   */
  @Post(IDENTITY_ROUTES.roles)
  @HttpCode(HTTP_STATUS.CREATED)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Create a role (administrators only — a role is a permission set)',
    body: createRoleBodySchema,
    responses: { [HTTP_STATUS.CREATED]: roleResponseSchema },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-IDENTITY-0001',
      'ERP-IDENTITY-0003',
      'ERP-IDENTITY-0007',
    ],
  })
  createRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: unknown,
  ): Promise<RoleResponseDto> {
    return this.service.createRole(user, body);
  }

  /**
   * `PATCH /api/v1/identity/roles/:id` — **no permission code** (ADR-0034 d.2). `applyToMembers` is
   * Perfex's `update_staff_permissions` checkbox: every holder's rows are replaced in the same
   * transaction as the role write.
   */
  @Patch(IDENTITY_ROUTES.role)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Update a role, optionally re-applying its template to every member holding it',
    params: roleParamsSchema,
    body: updateRoleBodySchema,
    responses: { [HTTP_STATUS.OK]: roleResponseSchema },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-IDENTITY-0001',
      'ERP-IDENTITY-0003',
      'ERP-IDENTITY-0007',
      'ERP-IDENTITY-0008',
    ],
  })
  updateRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param() params: unknown,
    @Body() body: unknown,
  ): Promise<RoleResponseDto> {
    return this.service.updateRole(user, params, body);
  }

  /**
   * `DELETE /api/v1/identity/roles/:id` — 204, and **no permission code** (ADR-0034 d.2; deleting is
   * a write to `tblroles`, and one role write left on a grantable code would reopen the hole).
   * 409 `ERP-IDENTITY-0006` while a member still points at the role — Perfex's `is_referenced`.
   */
  @Delete(IDENTITY_ROUTES.role)
  @HttpCode(HTTP_STATUS.NO_CONTENT)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Delete a role (administrators only); refused while a staff member still holds it',
    params: roleParamsSchema,
    responses: { [HTTP_STATUS.NO_CONTENT]: null },
    errors: [
      'ERP-VALIDATION-0001',
      'ERP-AUTH-0004',
      'ERP-IDENTITY-0001',
      'ERP-IDENTITY-0006',
      'ERP-IDENTITY-0008',
    ],
  })
  deleteRole(@CurrentUser() user: AuthenticatedUser, @Param() params: unknown): Promise<void> {
    return this.service.deleteRole(user, params);
  }

  /**
   * `GET /api/v1/identity/permissions/catalogue` — the clean-name grid, from `@erp/contracts` and not
   * from the database. Either view code admits: the member page renders the same grid as the roles
   * page (brief §5).
   */
  @Get(IDENTITY_ROUTES.permissionsCatalogue)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @PermissionsAny(IDENTITY_PERMISSIONS.members.view, IDENTITY_PERMISSIONS.rolesView)
  @ApiZod({
    summary:
      'The permission catalogue the checkbox grid renders, grouped module → resource → action',
    responses: { [HTTP_STATUS.OK]: permissionCatalogueResponseSchema },
    errors: ['ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  getPermissionCatalogue(): PermissionCatalogueResponseDto {
    return this.service.getPermissionCatalogue();
  }

  /**
   * `GET /api/v1/identity/locales` — the language select's option list, the counterpart Perfex builds
   * with `get_available_languages()`. Authenticated and gated on `staff.members.view` like the
   * departments picker: it exists for the member form, and it names what the deployment supports, not
   * what any member holds.
   */
  @Get(IDENTITY_ROUTES.locales)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(IDENTITY_PERMISSIONS.members.view)
  @ApiZod({
    summary: 'List the locales this deployment supports, for the member form language select',
    responses: { [HTTP_STATUS.OK]: localeListResponseSchema },
    errors: ['ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  listLocales(): LocaleListResponseDto {
    return this.service.getLocales();
  }

  /** `GET /api/v1/identity/departments` — the member form's picker; two columns, read only. */
  @Get(IDENTITY_ROUTES.departments)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @Permissions(IDENTITY_PERMISSIONS.members.view)
  @ApiZod({
    summary: 'List departments for the member form picker (id and name only)',
    responses: { [HTTP_STATUS.OK]: departmentListResponseSchema },
    errors: ['ERP-AUTH-0004', 'ERP-AUTH-0005'],
  })
  listDepartments(): Promise<DepartmentListResponseDto> {
    return this.service.listDepartments();
  }

  /**
   * `GET /api/v1/identity/audit` — the append-only identity audit log, **administrators only**
   * (ADR-0034 decision 3). The guard pair is here for the bearer; the administrator check is the
   * service's, because it is not a permission code and `PermissionGuard` has no `isAdmin` branch
   * by design (ADR-0033 decision 4).
   */
  @Get(IDENTITY_ROUTES.audit)
  @UseGuards(JwtAuthGuard, PermissionGuard)
  @ApiZod({
    summary: 'Read the identity audit log (administrators only)',
    query: listAuditQuerySchema,
    responses: { [HTTP_STATUS.OK]: auditListResponseSchema },
    errors: ['ERP-VALIDATION-0001', 'ERP-AUTH-0004', 'ERP-IDENTITY-0004'],
  })
  listAudit(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: unknown,
  ): Promise<AuditListResponseDto> {
    return this.service.listAudit(user, query);
  }
}
