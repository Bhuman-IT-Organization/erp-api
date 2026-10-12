/**
 * Use-case orchestrator of the module. Every step is a call into a rule layer (validator, enricher,
 * transformer, granting policy) or a repository; nothing here touches Prisma, `fetch` or a breaker
 * directly, and the controller receives the DTO from here — it never imports the transformer
 * (BE-08). Failures are `AppError`s the shared filter maps to problem details.
 *
 * **Every member AND role write runs in this order, and the order is the rule** (ADR-0034 decisions
 * 2 and 3). A role write substitutes `isRoleGrantingChange` for `isGrantingChange` and is refused
 * for *any* change, because a role **is** a permission set and has no non-granting half:
 *
 *   read the member's current state
 *     → `isGrantingChange(before, after)`            what would this request hand out?
 *     → `assertMayGrant(actor, changes)`             403 unless the actor has the administrator flag
 *     → the administrator-only rules of brief §5     staff id 1, own admin, an admin's password
 *     → ONE transaction                              `prisma.$transaction`, opened through
 *                                                    `repository.transaction()` because BE-08 keeps
 *                                                    Prisma inside `repository/`
 *          profile columns → department diff → permission replacement → `audit.append(tx, entries)`
 *     → commit                                       all four land, or none of them do
 *     → publish the brief §7 events                  a notification, outside the transaction
 *
 * The gate runs **before** the transaction opens, so a refused request never touches a row; the
 * audit entries are derived from the same `GrantingChange[]` the gate used, so the record and the
 * refusal can never disagree (threat T-3.1-44). The `requestId` is the request's own `x-request-id`
 * (ADR-0032 lineage) — a granting change with no lineage is never written.
 */
import { Inject, Injectable } from '@nestjs/common';
import { toCleanPermission, toPerfexPermission } from '@erp/contracts';
import { SUPPORTED_LOCALES, toLocale } from '../../../shared/config/legacy-locale.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import {
  parseExportOptions,
  runExport,
  type ExportCell,
  type ExportFile,
} from '../../../shared/http/export.js';
import {
  PASSWORD_HASHER,
  type PasswordHasherPort,
} from '../../../shared/crypto/password-hasher.port.js';
import { getRequestContext } from '../../../shared/logger/request-context.js';
import type {
  AuditListResponseDto,
  CreateMemberBody,
  DepartmentListResponseDto,
  LocaleListResponseDto,
  MemberListResponseDto,
  MemberResponseDto,
  PermissionCatalogueResponseDto,
  RoleListResponseDto,
  RoleResponseDto,
  UpdateMemberBody,
} from '../dto/identity.dto.js';
import {
  IdentityMemberAccessChangedV1,
  IdentityMemberActivatedV1,
  IdentityMemberCreatedV1,
  IdentityMemberDeactivatedV1,
  IdentityMemberPasswordChangedV1,
  IdentityMemberUpdatedV1,
  IdentityPermissionsReplacedV1,
  IdentityRoleCreatedV1,
  IdentityRoleDeletedV1,
  IdentityRoleUpdatedV1,
} from '../events/published.js';
import {
  MEMBER_EXPORT_COLUMNS,
  MEMBER_EXPORT_FILE_STEM,
  ROLE_EXPORT_COLUMNS,
  ROLE_EXPORT_FILE_STEM,
} from '../identity.routes.js';
import type {
  IdentityAuditEntry,
  MemberListRow,
  MemberSaveInput,
  MemberState,
  PerfexPermissionRow,
  RoleDetail,
  RoleHolder,
  RoleListRow,
  RoleRow,
  RoleState,
  StaffContact,
  StaffMember,
  StaffName,
} from '../model/identity.model.js';
import { IdentityAuditRepository } from '../repository/identity-audit.repository.js';
import {
  IdentityRepository,
  type IdentityTransaction,
  type MemberWriteColumns,
} from '../repository/identity.repository.js';
import {
  assertMayGrant,
  auditChangeTypeOf,
  isGrantingChange,
  isRoleGrantingChange,
  type GrantingChange,
} from './granting-policy.js';
import { IdentityEnricher } from './identity.enricher.js';
import { IdentityTransformer } from './identity.transformer.js';
import { IdentityTransport } from './identity.transport.js';
import { IdentityValidator } from './identity.validator.js';

export interface IdentityDescription {
  readonly module: 'identity';
  readonly version: 1;
}

/** Perfex never lets staff id 1 lose the administrator flag (brief §5); neither does Node. */
const PROTECTED_ADMIN_STAFF_ID = 1;

/**
 * The one Perfex feature a member flagged `is_not_staff` never receives rows for — Perfex's own
 * member save skips it, and a migrated screen is 1:1 with the screen it replaces (brief §3). It is
 * a legacy *feature* name, not an ADR-0033 permission code: the code the caller sent is a clean
 * name, and this is what `toPerfexPermission` translated it into.
 */
const LEADS_FEATURE = 'leads';

const FLAG_ON = 1;
const FLAG_OFF = 0;

function flag(value: boolean): number {
  return value ? FLAG_ON : FLAG_OFF;
}

/**
 * Each export column's cell, keyed by the column name, so the column list in `identity.routes.ts`
 * and what is written under it cannot drift (`satisfies` fails the build on a missing column).
 * `active` is the boolean: `1`/`0` in CSV and Excel, the sent yes/no label in PDF and Print; a
 * missing role or login is empty, or the column's sent blank label; `lastLogin` is ISO in a file
 * and the reader's date format in PDF and Print (`kind: 'dateTime'`).
 */
const MEMBER_EXPORT_CELLS = {
  staffId: { value: (row) => row.staffId },
  firstName: { value: (row) => row.firstName },
  lastName: { value: (row) => row.lastName },
  email: { value: (row) => row.email },
  roleName: { value: (row) => row.roleName },
  active: { value: (row) => row.active },
  lastLogin: { value: (row) => row.lastLogin, kind: 'dateTime' },
} as const satisfies Record<(typeof MEMBER_EXPORT_COLUMNS)[number], ExportCell<MemberListRow>>;

const ROLE_EXPORT_CELLS = {
  roleId: { value: (row) => row.roleId },
  name: { value: (row) => row.name },
  memberCount: { value: (row) => row.memberCount },
} as const satisfies Record<(typeof ROLE_EXPORT_COLUMNS)[number], ExportCell<RoleListRow>>;

/** Perfex's `media_path_slug`: the member's name slugged, or `unknown-<id>` when nothing is left. */
function slugOf(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class IdentityService {
  /** Constructor-assigned (not DI) so a spec can fix the clock; `datecreated` and every audit row read it. */
  now: () => number = () => Date.now();

  constructor(
    private readonly validator: IdentityValidator,
    private readonly repository: IdentityRepository,
    private readonly auditRepository: IdentityAuditRepository,
    private readonly enricher: IdentityEnricher,
    private readonly transformer: IdentityTransformer,
    private readonly transport: IdentityTransport,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasherPort,
  ) {}

  describe(): IdentityDescription {
    return { module: 'identity', version: 1 };
  }

  /**
   * The facade's one method (brief §7): a member's stored permission rows in Perfex's own format.
   * `v1/auth` calls it at login and on every refresh where it used to read `tblstaff_permissions`
   * itself; the translation into clean ADR-0033 names stays `auth`'s enricher's job, so the rows
   * cross the boundary exactly as they did before ADR-0034 d.1 moved the table here.
   */
  permissionsOf(staffId: number): Promise<PerfexPermissionRow[]> {
    return this.repository.listPermissionRows(staffId);
  }

  /** The facade's `listActiveMembers` (M13): every active member's name, by name then id. */
  listActiveMembers(): Promise<readonly StaffName[]> {
    return this.repository.listActiveStaffNames();
  }

  /** The facade's `namesOf` (M13): `staffId -> name` for the ids it knows; no ids, no read. */
  async namesOf(staffIds: readonly number[]): Promise<ReadonlyMap<number, string>> {
    if (staffIds.length === 0) return new Map();
    const names = await this.repository.staffNamesOf(staffIds);
    return new Map(names.map((row) => [row.staffId, row.name]));
  }

  /** The facade's `contactOf` (M1): one member's address, locale and active flag, or null. */
  async contactOf(staffId: number): Promise<StaffContact | null> {
    const member = await this.repository.findMemberById(staffId);
    if (member === null) return null;
    return {
      email: member.email,
      locale: toLocale(member.defaultLanguage),
      active: member.active,
    };
  }

  // --- reads -----------------------------------------------------------------------------------

  /**
   * `GET /api/v1/identity/members` — validator → repository → transformer. The page carries the
   * whole list meta (both cursors, `total`, `rangeStart`); the transformer passes it through.
   */
  async listMembers(input: unknown): Promise<MemberListResponseDto> {
    const request = this.validator.parseMemberListQuery(input);
    const page = await this.repository.listMembers(request);
    return this.transformer.toListResponse(page.items, page);
  }

  /** `GET /api/v1/identity/members/:id` — 404 `ERP-IDENTITY-0005` for an id that is not a member. */
  async getMember(params: unknown): Promise<MemberResponseDto> {
    const { id } = this.validator.parseMemberParams(params);
    return this.memberResponse(await this.requireMember(id));
  }

  /**
   * `GET /api/v1/identity/audit` — **administrators only** (ADR-0034 decision 3, "readable by
   * administrators"). Not a permission code: who holds what is exactly what the log records, so a
   * code that opened it could be handed out by the mechanism it protects.
   */
  async listAudit(actor: AuthenticatedUser, input: unknown): Promise<AuditListResponseDto> {
    this.assertAdministrator(actor, 'the identity audit log is readable by administrators only');
    const query = this.validator.parseAuditListQuery(input);
    const page = await this.auditRepository.list(query);
    return this.transformer.toAuditResponse(page.rows, page.nextCursor);
  }

  /**
   * `GET /api/v1/identity/roles` — **administrators only** (migration-lead decision 2026-09-24,
   * `ROUTE_GATES['/setup/roles'] === 'admin'`). A role row names a permission template, so reading the
   * list is reading the shape of the permission system; the same reasoning ADR-0034 decision 3
   * applies to the audit log applies here, and for the same reason it is not a permission code.
   * The assertion runs before the query, so a refusal costs no database read.
   */
  async listRoles(actor: AuthenticatedUser, input: unknown): Promise<RoleListResponseDto> {
    this.assertAdministrator(actor, 'roles are readable by administrators only');
    const request = this.validator.parseRoleListQuery(input);
    const page = await this.repository.listRoles(request);
    return this.transformer.toRoleListResponse(page.items, page);
  }

  // --- exports (plan 03.2-05, D-26 and D-42; plan 04.1.1-02, ADR-0043) -------------------------

  /**
   * `GET /api/v1/identity/members/export` - every member the list's query matches, as CSV, Excel,
   * PDF or print rows. Gated like the list (`staff.members.view`, on the controller). The shared
   * core parses the export parameters (no row selection here: a `key` is a 400), counts first,
   * refuses over the format's cap before any row is read, then reads with the list's own keyset
   * query, so the rows and their order are exactly the list's.
   */
  async exportMembers(input: unknown): Promise<ExportFile> {
    const options = parseExportOptions(input, { columns: MEMBER_EXPORT_COLUMNS, keys: 'refuse' });
    const request = this.validator.parseMemberExportList(input);
    return runExport({
      stem: MEMBER_EXPORT_FILE_STEM,
      cells: MEMBER_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.countMembers(list),
      page: (list) => this.repository.listMembers(list),
      now: new Date(this.now()),
    });
  }

  /**
   * `GET /api/v1/identity/roles/export` - every role the list's query matches, in any of the four
   * formats. **Administrators only, asserted first**, before any parse or count, exactly as
   * `listRoles` does: a role list is the shape of the permission system (migration-lead decision
   * 2026-09-24).
   */
  async exportRoles(actor: AuthenticatedUser, input: unknown): Promise<ExportFile> {
    this.assertAdministrator(actor, 'roles are exportable by administrators only');
    const options = parseExportOptions(input, { columns: ROLE_EXPORT_COLUMNS, keys: 'refuse' });
    const request = this.validator.parseRoleExportList(input);
    return runExport({
      stem: ROLE_EXPORT_FILE_STEM,
      cells: ROLE_EXPORT_CELLS,
      options,
      request,
      count: (list) => this.repository.countRoles(list),
      page: (list) => this.repository.listRoles(list),
      now: new Date(this.now()),
    });
  }

  /**
   * `GET /api/v1/identity/roles/:id` — **administrators only**, as the list is: the response IS a
   * permission template. 404 `ERP-IDENTITY-0008` for an id that is not a role, and the flag is
   * asserted first so a non-administrator learns no role ids.
   */
  async getRole(actor: AuthenticatedUser, params: unknown): Promise<RoleResponseDto> {
    this.assertAdministrator(actor, 'a role template is readable by administrators only');
    const { id } = this.validator.parseRoleParams(params);
    return this.transformer.toRoleResponse(await this.roleDetail(id));
  }

  /**
   * `GET /api/v1/identity/permissions/catalogue` — the clean-name tree of `@erp/contracts`, which is
   * what the checkbox grid renders. **Not a database read:** it replaces Perfex's
   * `get_available_staff_permissions()`, and the catalogue is a contract (ADR-0033), so it is derived
   * from the package rather than queried. Synchronous on purpose — no I/O to await.
   */
  getPermissionCatalogue(): PermissionCatalogueResponseDto {
    return this.transformer.toPermissionCatalogueResponse(this.enricher.buildPermissionCatalogue());
  }

  /**
   * `GET /api/v1/identity/locales` — the locales this deployment supports, which is what the member
   * form's language select may offer. **Not a database read and not the legacy folder listing:**
   * Perfex builds its select from `application/language/`, and this api may not read the legacy
   * filesystem, so the source is `SUPPORTED_LOCALES` — the set erp-web ships message packs for
   * (`shared/config/legacy-locale.ts` carries the constant and the reason). Synchronous on purpose:
   * no I/O to await, exactly like the permission catalogue.
   */
  getLocales(): LocaleListResponseDto {
    return this.transformer.toLocaleListResponse(SUPPORTED_LOCALES);
  }

  /**
   * `GET /api/v1/identity/departments`: the member form's picker, `{ departmentId, name }` by name,
   * read through `DepartmentsFacade` in the transport (D-55); identity names no departments table.
   */
  async listDepartments(): Promise<DepartmentListResponseDto> {
    return this.transformer.toDepartmentListResponse(await this.transport.listDepartments());
  }

  // --- writes ----------------------------------------------------------------------------------

  /** `POST /api/v1/identity/members` — the member add of brief §3, in one transaction. */
  async createMember(actor: AuthenticatedUser, input: unknown): Promise<MemberResponseDto> {
    const body = this.validator.parseCreateMemberBody(input);
    if ((await this.repository.findStaffIdByEmail(body.email)) !== null) {
      throw new AppError('ERP-IDENTITY-0002');
    }

    const isAdmin = body.admin ?? false;
    // Perfex: an administrator is never `is_not_staff`.
    const isNotStaff = isAdmin ? false : (body.isNotStaff ?? false);
    const plan = this.planPermissionRows([], body.permissions, isAdmin, isNotStaff);
    const before: MemberState = { roleId: null, permissions: plan.before, isAdmin: false };
    const changes = isGrantingChange(before, { ...saveInputOf(body), permissions: plan.after });
    assertMayGrant(actor, changes);
    await this.assertRoleExists(body.roleId);
    await this.assertNewDepartmentsKnown(body.departmentIds, () => Promise.resolve([]));

    const at = new Date(this.now());
    const permissionsChanged = changes.some((change) => change.field === 'permissions');
    const requestId = changes.length > 0 ? this.requestId() : null;

    const staffId = await this.repository.transaction(async (tx) => {
      const created = await this.repository.insertMember(tx, {
        ...profileColumns(body),
        email: body.email,
        firstname: body.firstName,
        lastname: body.lastName,
        password: await this.hasher.hash(body.password),
        datecreated: at,
        last_password_change: at,
        admin: flag(isAdmin),
        role: body.roleId ?? null,
        active: FLAG_ON,
        is_not_staff: flag(isNotStaff),
        media_path_slug: slugOf(body.firstName, body.lastName),
      });
      if (slugOf(body.firstName, body.lastName) === '') {
        await this.repository.setMediaPathSlug(tx, created, `unknown-${String(created)}`);
      }
      if (body.departmentIds !== undefined && body.departmentIds.length > 0) {
        await this.repository.replaceDepartments(tx, created, body.departmentIds);
      }
      if (permissionsChanged) await this.repository.replacePermissionRows(tx, created, plan.rows);
      if (requestId !== null) {
        await this.auditRepository.append(
          tx,
          auditEntriesOf(actor, created, changes, requestId, at),
        );
      }
      return created;
    });

    await this.transport.publish(new IdentityMemberCreatedV1({ staffId, at: at.toISOString() }));
    if (permissionsChanged) {
      await this.transport.publish(
        new IdentityPermissionsReplacedV1({ staffId, at: at.toISOString() }),
      );
    }
    return this.memberResponse(await this.requireMember(staffId));
  }

  /** `PATCH /api/v1/identity/members/:id` — the member edit of brief §3, in one transaction. */
  async updateMember(
    actor: AuthenticatedUser,
    params: unknown,
    input: unknown,
  ): Promise<MemberResponseDto> {
    const { id } = this.validator.parseMemberParams(params);
    const body = this.validator.parseUpdateMemberBody(input);
    const subject = await this.requireMember(id);

    if (body.email !== undefined && body.email !== subject.email) {
      const holder = await this.repository.findStaffIdByEmail(body.email);
      if (holder !== null && holder !== id) throw new AppError('ERP-IDENTITY-0002');
    }

    const isAdmin = body.admin ?? subject.isAdmin;
    const isNotStaff = isAdmin ? false : (body.isNotStaff ?? subject.isNotStaff);
    const plan = this.planPermissionRows(
      await this.repository.listPermissionRows(id),
      body.permissions,
      isAdmin,
      isNotStaff,
    );
    const before: MemberState = {
      roleId: subject.roleId,
      permissions: plan.before,
      isAdmin: subject.isAdmin,
    };
    const changes = isGrantingChange(before, { ...saveInputOf(body), permissions: plan.after });
    assertMayGrant(actor, changes);
    await this.assertRoleExists(body.roleId);
    this.assertMemberRules(actor, subject, body);
    await this.assertAnAdministratorRemains(subject, body);
    await this.assertNewDepartmentsKnown(body.departmentIds, () =>
      this.repository.listDepartmentIds(id),
    );

    const permissionsChanged = changes.some((change) => change.field === 'permissions');
    const setsPassword = body.password !== undefined && body.password !== '';
    // CR-02(a): the admin flag and the role are baked into the access token and the `auth:perm`
    // snapshot, so a real change to either ends the member's sessions (identity.member.accessChanged).
    const accessChanged =
      (body.admin !== undefined && body.admin !== subject.isAdmin) ||
      (body.roleId !== undefined && body.roleId !== subject.roleId);
    const at = new Date(this.now());
    const requestId = changes.length > 0 ? this.requestId() : null;

    await this.repository.transaction(async (tx) => {
      const columns: MemberWriteColumns = {
        ...profileColumns(body),
        ...(body.email === undefined ? {} : { email: body.email }),
        ...(body.firstName === undefined ? {} : { firstname: body.firstName }),
        ...(body.lastName === undefined ? {} : { lastname: body.lastName }),
        ...(body.admin === undefined ? {} : { admin: flag(isAdmin) }),
        ...(body.admin === undefined && body.isNotStaff === undefined
          ? {}
          : { is_not_staff: flag(isNotStaff) }),
        ...(body.roleId === undefined ? {} : { role: body.roleId ?? null }),
        ...(setsPassword
          ? {
              password: await this.hasher.hash(body.password ?? ''),
              last_password_change: at,
            }
          : {}),
      };
      await this.repository.updateMember(tx, id, columns);
      if (body.departmentIds !== undefined) {
        await this.repository.replaceDepartments(tx, id, body.departmentIds);
      }
      if (permissionsChanged) await this.repository.replacePermissionRows(tx, id, plan.rows);
      if (requestId !== null) {
        await this.auditRepository.append(tx, auditEntriesOf(actor, id, changes, requestId, at));
      }
    });

    await this.transport.publish(
      new IdentityMemberUpdatedV1({ staffId: id, at: at.toISOString() }),
    );
    if (accessChanged) {
      await this.transport.publish(
        new IdentityMemberAccessChangedV1({ staffId: id, at: at.toISOString() }),
      );
    }
    if (setsPassword) {
      await this.transport.publish(
        new IdentityMemberPasswordChangedV1({ staffId: id, at: at.toISOString() }),
      );
    }
    if (permissionsChanged) {
      await this.transport.publish(
        new IdentityPermissionsReplacedV1({ staffId: id, at: at.toISOString() }),
      );
    }
    return this.memberResponse(await this.requireMember(id));
  }

  /**
   * `PATCH /api/v1/identity/members/:id/status` — 204. Deactivation is **not** granting (brief §5's
   * correction table), so it runs on `staff.members.edit`; the two administrator-only rules that do
   * apply are enforced here, on the server, rather than by hiding a control.
   */
  async setMemberStatus(actor: AuthenticatedUser, params: unknown, input: unknown): Promise<void> {
    const { id } = this.validator.parseMemberParams(params);
    const { active } = this.validator.parseMemberStatusBody(input);
    await this.applyStatus(actor, id, active);
  }

  /**
   * The status rule: the subject must exist, nobody deactivates themselves, only an administrator
   * changes an administrator's status; then `active` in one transaction (a count write, safe on a
   * row holding a zero `DATE`) and the event.
   */
  private async applyStatus(
    actor: { readonly staffId: number; readonly isAdmin: boolean },
    subjectId: number,
    active: boolean,
  ): Promise<void> {
    const subject = await this.requireMember(subjectId);

    if (actor.staffId === subjectId && !active) {
      throw new AppError('ERP-IDENTITY-0004', 'nobody deactivates themselves');
    }
    if (!actor.isAdmin && subject.isAdmin) {
      throw new AppError(
        'ERP-IDENTITY-0004',
        "only an administrator changes an administrator's status",
      );
    }

    const at = new Date(this.now());
    await this.repository.transaction((tx) =>
      this.repository.updateMember(tx, subjectId, { active: flag(active) }),
    );
    await this.transport.publish(
      active
        ? new IdentityMemberActivatedV1({ staffId: subjectId, at: at.toISOString() })
        : new IdentityMemberDeactivatedV1({ staffId: subjectId, at: at.toISOString() }),
    );
  }

  /**
   * `POST /api/v1/identity/roles` — creating a role is **entirely** a grant (ADR-0034 d.2): the body
   * is a name and a permission set, so there is no profile half and the whole endpoint runs on the
   * administrator flag. One `role.created` audit row names the role; `subject_role_id` is set and
   * `subject_staff_id` is null, because a new role has no members yet.
   */
  async createRole(actor: AuthenticatedUser, input: unknown): Promise<RoleResponseDto> {
    const body = this.validator.parseCreateRoleBody(input);
    if ((await this.repository.findRoleIdByName(body.name)) !== null) {
      throw new AppError('ERP-IDENTITY-0007');
    }

    const changes = isRoleGrantingChange(null, { name: body.name, permissions: body.permissions });
    assertMayGrant(actor, changes);

    const template = this.perfexTemplateFor(body.permissions);
    const at = new Date(this.now());
    const requestId = this.requestId();

    const roleId = await this.repository.transaction(async (tx) => {
      const created = await this.repository.insertRole(tx, { name: body.name, template });
      await this.auditRepository.append(
        tx,
        roleAuditEntriesOf(actor, created, changes, requestId, at),
      );
      return created;
    });

    await this.transport.publish(new IdentityRoleCreatedV1({ roleId, at: at.toISOString() }));
    return this.transformer.toRoleResponse(await this.roleDetail(roleId));
  }

  /**
   * `PATCH /api/v1/identity/roles/:id` — the roles-edit behaviour of brief §3, including Perfex's
   * `update_staff_permissions` checkbox as `applyToMembers`: every member holding the role has their
   * permission rows replaced by the role's new template, **in the same transaction as the role
   * write**, and each affected member gets one `identity.permissions.replaced` event and one audit
   * row per code added or removed (ADR-0034 d.3).
   */
  async updateRole(
    actor: AuthenticatedUser,
    params: unknown,
    input: unknown,
  ): Promise<RoleResponseDto> {
    const { id } = this.validator.parseRoleParams(params);
    const body = this.validator.parseUpdateRoleBody(input);
    const role = await this.requireRole(id);

    if (body.name !== undefined && body.name !== role.name) {
      const holder = await this.repository.findRoleIdByName(body.name);
      if (holder !== null && holder !== id) throw new AppError('ERP-IDENTITY-0007');
    }

    const currentTemplate = this.repository.decodeTemplate(id, role.serializedPermissions);
    const before: RoleState = {
      name: role.name,
      permissions: this.enricher.toCleanTemplate(id, currentTemplate),
    };
    const changes = isRoleGrantingChange(before, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.permissions === undefined ? {} : { permissions: body.permissions }),
    });
    assertMayGrant(actor, changes);

    const nextClean = body.permissions ?? before.permissions;
    const template =
      body.permissions === undefined ? currentTemplate : this.perfexTemplateFor(body.permissions);
    const at = new Date(this.now());
    const requestId = this.requestId();
    const holders =
      body.applyToMembers === true
        ? await this.repository.listRoleHolders(id)
        : ([] as RoleHolder[]);
    const affected = holders.filter((holder) => !holder.isAdmin);

    const memberEntries: IdentityAuditEntry[] = [];
    await this.repository.transaction(async (tx) => {
      await this.repository.updateRole(tx, id, {
        ...(body.name === undefined ? {} : { name: body.name }),
        ...(body.permissions === undefined ? {} : { template }),
      });
      for (const holder of affected) {
        memberEntries.push(
          ...(await this.applyTemplateToMember(tx, holder, nextClean, actor, requestId, at)),
        );
      }
      await this.auditRepository.append(tx, [
        ...roleAuditEntriesOf(actor, id, changes, requestId, at),
        ...memberEntries,
      ]);
    });

    await this.transport.publish(new IdentityRoleUpdatedV1({ roleId: id, at: at.toISOString() }));
    for (const holder of affected) {
      await this.transport.publish(
        new IdentityPermissionsReplacedV1({ staffId: holder.staffId, at: at.toISOString() }),
      );
    }
    return this.transformer.toRoleResponse(await this.roleDetail(id));
  }

  /**
   * `DELETE /api/v1/identity/roles/:id` — 204. Perfex's `is_referenced` refusal, as a 409
   * `ERP-IDENTITY-0006`: a role a member still points at is never deleted, because `tblroles` has no
   * foreign key and the member would be left holding a role that does not exist. The order is plan
   * 12's: 404 for an unknown role, then the administrator gate, then the reference check — so a
   * non-administrator learns nothing about which roles are in use.
   */
  async deleteRole(actor: AuthenticatedUser, params: unknown): Promise<void> {
    const { id } = this.validator.parseRoleParams(params);
    const role = await this.requireRole(id);

    const before: RoleState = {
      name: role.name,
      permissions: this.enricher.toCleanTemplate(
        id,
        this.repository.decodeTemplate(id, role.serializedPermissions),
      ),
    };
    const changes = isRoleGrantingChange(before, null);
    assertMayGrant(actor, changes);

    const members = await this.repository.countMembersOfRole(id);
    if (members > 0) {
      throw new AppError(
        'ERP-IDENTITY-0006',
        `the role is held by ${String(members)} staff member(s)`,
      );
    }

    const at = new Date(this.now());
    const requestId = this.requestId();
    await this.repository.transaction(async (tx) => {
      await this.repository.deleteRole(tx, id);
      await this.auditRepository.append(tx, roleAuditEntriesOf(actor, id, changes, requestId, at));
    });

    await this.transport.publish(new IdentityRoleDeletedV1({ roleId: id, at: at.toISOString() }));
  }

  // --- internals -------------------------------------------------------------------------------

  private async requireRole(roleId: number): Promise<RoleRow> {
    const role = await this.repository.findRole(roleId);
    if (role === null) throw new AppError('ERP-IDENTITY-0008');
    return role;
  }

  /**
   * SF-7 (CR review). `roleId` is validated as any positive integer and written straight into
   * `tblstaff.role`, and `tblroles` has no foreign key — so an id that is not a role created
   * exactly the dangling reference `DELETE /roles/:id` refuses with a 409 to prevent
   * (`ERP-IDENTITY-0006`) and that `memberResponse` already has to defend against
   * (`findRole(roleId)?.name ?? null`). So `createMember` and `updateMember` look the role up
   * before their transaction opens and answer the route's declared 404 `ERP-IDENTITY-0008`.
   *
   * Two deliberate silences: `undefined` means the request does not touch the role, and `null` is
   * the "clear the role" value — neither is a lookup. And this runs **after** `assertMayGrant`, so
   * a non-administrator still gets the 403 and learns nothing about which role ids exist.
   */
  /**
   * D-55 (Departments planning answer 4): refuses a save naming a department id that is NEW for the
   * member (not among the ids `stored` reads) and that `DepartmentsFacade` does not know, with 422
   * `ERP-IDENTITY-0009` naming the unknown ids ascending, before any write (no member row, no
   * department row, no audit row, no event). A stored leftover link to a deleted department is not
   * new, so it is never re-checked and the member still saves. No ids, or no new id, asks nothing.
   */
  private async assertNewDepartmentsKnown(
    departmentIds: readonly number[] | undefined,
    stored: () => Promise<readonly number[]>,
  ): Promise<void> {
    if (departmentIds === undefined || departmentIds.length === 0) return;
    const held = new Set(await stored());
    const added = [...new Set(departmentIds)].filter((id) => !held.has(id));
    if (added.length === 0) return;
    const known = await this.transport.knownDepartmentIds(added);
    const unknown = added.filter((id) => !known.has(id)).sort((a, b) => a - b);
    if (unknown.length > 0) {
      throw new AppError('ERP-IDENTITY-0009', `unknown department id(s): ${unknown.join(', ')}`);
    }
  }

  private async assertRoleExists(roleId: number | null | undefined): Promise<void> {
    if (roleId === undefined || roleId === null) return;
    await this.requireRole(roleId);
  }

  /** The role as `GET roles/:id` answers it: the template in clean names, plus its members. */
  private async roleDetail(roleId: number): Promise<RoleDetail> {
    const role = await this.requireRole(roleId);
    const members = await this.repository.listRoleMembers(roleId);
    return {
      roleId: role.roleId,
      name: role.name,
      permissions: this.enricher.toCleanTemplate(
        roleId,
        this.repository.decodeTemplate(roleId, role.serializedPermissions),
      ),
      members,
      memberCount: members.length,
    };
  }

  /**
   * One member of an `applyToMembers` fan-out: their permission rows are replaced by the role's new
   * template and the codes that actually moved become audit entries. The member's own two Perfex
   * flags still decide what lands (`perfexRowsFor`), so the apply cannot give an `is_not_staff`
   * member the `leads` feature.
   *
   * **An administrator is never in this list** (the caller filters them out) and that is why a role
   * write cannot clear the last administrator: `tblroles` carries no administrator column — the flag
   * lives on `tblstaff` and only a member save can move it (ADR-0034 d.2) — and an administrator
   * holds no permission rows at all by Perfex's own rule, so there is nothing for the fan-out to take
   * away. The reachable form of the rule is in `assertMemberRules`.
   */
  private async applyTemplateToMember(
    tx: IdentityTransaction,
    holder: RoleHolder,
    templateClean: readonly string[],
    actor: AuthenticatedUser,
    requestId: string,
    at: Date,
  ): Promise<IdentityAuditEntry[]> {
    const plan = this.planPermissionRows(
      await this.repository.listPermissionRows(holder.staffId),
      templateClean,
      holder.isAdmin,
      holder.isNotStaff,
    );
    const memberChanges = isGrantingChange(
      { roleId: null, permissions: plan.before, isAdmin: holder.isAdmin },
      { permissions: plan.after },
    );
    if (memberChanges.length > 0) {
      await this.repository.replacePermissionRows(tx, holder.staffId, plan.rows);
    }
    return auditEntriesOf(actor, holder.staffId, memberChanges, requestId, at);
  }

  /**
   * Clean ADR-0033 names → the Perfex `feature => capability[]` template `tblroles.permissions`
   * stores. Perfex's own roles screen reads this column, so the shape is its shape; an unknown clean
   * name fails the save with `ERP-IDENTITY-0003` rather than writing an invented feature.
   */
  private perfexTemplateFor(permissions: readonly string[]): Record<string, string[]> {
    const template: Record<string, string[]> = {};
    for (const row of this.perfexRowsFor(permissions, false)) {
      (template[row.feature] ??= []).push(row.capability);
    }
    return template;
  }

  private async requireMember(staffId: number): Promise<StaffMember> {
    const member = await this.repository.findMemberById(staffId);
    if (member === null) throw new AppError('ERP-IDENTITY-0005');
    return member;
  }

  private async cleanPermissionsOf(staffId: number): Promise<string[]> {
    return this.enricher.toCleanPermissions(
      staffId,
      await this.repository.listPermissionRows(staffId),
    );
  }

  private async memberResponse(member: StaffMember): Promise<MemberResponseDto> {
    const [departmentIds, permissions] = await Promise.all([
      this.repository.listDepartmentIds(member.staffId),
      this.cleanPermissionsOf(member.staffId),
    ]);
    const roleName =
      member.roleId === null
        ? null
        : ((await this.repository.findRole(member.roleId))?.name ?? null);
    return this.transformer.toMemberResponse(
      this.enricher.enrich(member, departmentIds, permissions, roleName),
    );
  }

  /**
   * The administrator-only rules of brief §5 that are **not** granting, so `granting-policy.ts`
   * does not answer them. Perfex enforced several of these only by hiding a control — a recorded
   * privilege-escalation finding, not a behaviour to copy.
   *
   * Two rules were added by the Phase 3.1 review (CR-03, CR-02 b):
   * - **Only an administrator changes an administrator's e-mail.** The e-mail is the login
   *   identifier and the Perfex forgot-password destination, so redirecting it is the same account
   *   takeover as setting the password, which the rule before it already refuses.
   * - **Nobody sets their own administrator flag.** The actor's `isAdmin` is a JWT claim up to one
   *   access-token lifetime old, while `subject.isAdmin` is the `tblstaff` row. A demoted
   *   administrator whose token still says admin passes `assertMayGrant` on the stale claim; this
   *   refuses the self-promotion on the row. A real administrator saving `admin: true` on
   *   themselves is a no-op and stays allowed (the staff form may send the whole body).
   */
  private assertMemberRules(
    actor: AuthenticatedUser,
    subject: StaffMember,
    body: UpdateMemberBody,
  ): void {
    if (subject.staffId === PROTECTED_ADMIN_STAFF_ID && body.admin === false) {
      throw new AppError('ERP-IDENTITY-0004', 'staff id 1 keeps the administrator flag');
    }
    if (actor.staffId === subject.staffId && subject.isAdmin && body.admin === false) {
      throw new AppError('ERP-IDENTITY-0004', 'nobody removes their own administrator flag');
    }
    if (!actor.isAdmin && subject.isAdmin && body.password !== undefined && body.password !== '') {
      throw new AppError(
        'ERP-IDENTITY-0004',
        "only an administrator changes an administrator's password",
      );
    }
    if (
      !actor.isAdmin &&
      subject.isAdmin &&
      body.email !== undefined &&
      body.email !== subject.email
    ) {
      throw new AppError(
        'ERP-IDENTITY-0004',
        "only an administrator changes an administrator's e-mail",
      );
    }
    if (actor.staffId === subject.staffId && body.admin === true && !subject.isAdmin) {
      throw new AppError('ERP-IDENTITY-0004', 'nobody sets their own administrator flag');
    }
  }

  /**
   * The system keeps at least one administrator. Brief §5 protects staff id 1 and the actor's own
   * flag, which covers every path Perfex's screens could reach; this closes the remaining one — an
   * administrator clearing the flag of the only *other* administrator while staff id 1 is no longer
   * one. Generic 403 `ERP-IDENTITY-0004` like the other administrator-only refusals, so it never
   * says how many administrators exist.
   *
   * It lives here and not on the role side deliberately: a role write cannot clear the flag, because
   * `tblroles` has no administrator column and ADR-0034 d.2 keeps `admin` on `tblstaff`.
   */
  private async assertAnAdministratorRemains(
    subject: StaffMember,
    body: UpdateMemberBody,
  ): Promise<void> {
    if (body.admin !== false || !subject.isAdmin) return;
    if ((await this.repository.countAdministrators()) <= 1) {
      throw new AppError('ERP-IDENTITY-0004', 'the last administrator keeps the flag');
    }
  }

  private assertAdministrator(actor: AuthenticatedUser, detail: string): void {
    if (!actor.isAdmin) throw new AppError('ERP-IDENTITY-0004', detail);
  }

  /**
   * Quick task 260925-rvw (review WR-03, WR-04, WR-12): the rows a member save will leave in
   * `tblstaff_permissions`, and both sides of the ONE comparison the gate and the audit read. The
   * request body is never compared directly, because what is written differs from it:
   *
   * - **an administrator stores no rows** (Perfex `Staff_model.php`: `update_permissions($data['admin']
   *   == 1 ? [] : $permissions)`), whether or not `permissions` was sent — so a promotion clears the
   *   rows and audits each removal, and a later demotion has nothing to bring back;
   * - otherwise, with no `permissions` in the body, the stored rows stay exactly as they are;
   * - otherwise the requested clean names become rows (`perfexRowsFor`, which skips `leads` for an
   *   is_not_staff member) **plus every stored row the mapping does not know, carried through
   *   untouched** — a clean-name save cannot express such a row, so it must never delete one.
   *
   * `before`/`after` name each row by its clean name, or by its raw `feature:capability` when it has
   * none (`IdentityEnricher.toAuditCodes`), so an unmapped row that IS removed still passes the gate
   * and still gets its audit row.
   */
  private planPermissionRows(
    stored: readonly PerfexPermissionRow[],
    requested: readonly string[] | undefined,
    isAdmin: boolean,
    isNotStaff: boolean,
  ): PermissionRowsPlan {
    let rows: PerfexPermissionRow[];
    if (isAdmin) rows = [];
    else if (requested === undefined) rows = [...stored];
    else {
      const unmapped = stored.filter(
        (row) => toCleanPermission(`${row.feature}.${row.capability}`) === null,
      );
      rows = [...this.perfexRowsFor(requested, isNotStaff), ...unmapped];
    }
    return {
      before: this.enricher.toAuditCodes(stored),
      after: this.enricher.toAuditCodes(rows),
      rows,
    };
  }

  /**
   * Clean ADR-0033 names → the Perfex rows the table stores (decision 10), with Perfex's own rule
   * that a member flagged `is_not_staff` never receives the `leads` feature (the administrator rule
   * is `planPermissionRows`'). A clean name the mapping does not know fails the save with
   * `ERP-IDENTITY-0003` rather than writing an invented row (T-3.1-4B).
   */
  private perfexRowsFor(
    permissions: readonly string[],
    isNotStaff: boolean,
  ): PerfexPermissionRow[] {
    const rows: PerfexPermissionRow[] = [];
    for (const clean of permissions) {
      const perfex = toPerfexPermission(clean);
      if (perfex === null) {
        throw new AppError('ERP-IDENTITY-0003', `unknown permission name "${clean}"`);
      }
      const separator = perfex.lastIndexOf('.');
      const feature = perfex.slice(0, separator);
      const capability = perfex.slice(separator + 1);
      if (isNotStaff && feature === LEADS_FEATURE) continue;
      rows.push({ feature, capability });
    }
    return rows;
  }

  /** The request's `x-request-id`; a granting change is never written without its lineage. */
  private requestId(): string {
    const context = getRequestContext();
    if (context === undefined) {
      throw new AppError('ERP-INTERNAL-0001', 'no request context for the audit row');
    }
    return context.requestId;
  }
}

/**
 * The role and admin side of a body, in the domain's spelling. The permission side is never the
 * body's: the caller passes the rows `planPermissionRows` will persist (260925-rvw).
 */
function saveInputOf(body: CreateMemberBody | UpdateMemberBody): MemberSaveInput {
  return {
    ...(body.roleId === undefined ? {} : { roleId: body.roleId ?? null }),
    ...(body.admin === undefined ? {} : { isAdmin: body.admin }),
  };
}

/** A member save's permission rows: what is stored, what will be, and what gets written. */
interface PermissionRowsPlan {
  readonly before: readonly string[];
  readonly after: readonly string[];
  readonly rows: readonly PerfexPermissionRow[];
}

/** The non-granting profile columns a body carries, mapped to their `tblstaff` names. */
function profileColumns(body: CreateMemberBody | UpdateMemberBody): MemberWriteColumns {
  return {
    ...(body.phoneNumber === undefined ? {} : { phonenumber: body.phoneNumber ?? null }),
    ...(body.facebook === undefined ? {} : { facebook: body.facebook ?? null }),
    ...(body.linkedin === undefined ? {} : { linkedin: body.linkedin ?? null }),
    ...(body.skype === undefined ? {} : { skype: body.skype ?? null }),
    ...(body.hourlyRate === undefined ? {} : { hourly_rate: body.hourlyRate }),
    ...(body.defaultLanguage === undefined
      ? {}
      : { default_language: body.defaultLanguage ?? null }),
    ...(body.direction === undefined ? {} : { direction: body.direction ?? null }),
    ...(body.emailSignature === undefined ? {} : { email_signature: body.emailSignature ?? null }),
  };
}

/**
 * The audit entries of a ROLE change: `subject_role_id` is set and `subject_staff_id` is null,
 * because the subject is the role itself (brief §7's column table). `isRoleGrantingChange` returns
 * exactly one entry per role write, so this is one row per create, update and delete.
 */
function roleAuditEntriesOf(
  actor: AuthenticatedUser,
  subjectRoleId: number,
  changes: readonly GrantingChange[],
  requestId: string,
  createdAt: Date,
): IdentityAuditEntry[] {
  return changes.map((change) => ({
    actorStaffId: actor.staffId,
    subjectStaffId: null,
    subjectRoleId,
    changeType: auditChangeTypeOf(change),
    permissionCode: change.permissionCode ?? null,
    beforeValue: change.before,
    afterValue: change.after,
    requestId,
    createdAt,
  }));
}

/**
 * One audit entry per granting change, derived from the very list the gate refused on, all sharing
 * the request's `x-request-id` and timestamp. A permission replacement that adds three codes and
 * removes one therefore writes four rows (ADR-0034 decision 3).
 */
function auditEntriesOf(
  actor: AuthenticatedUser,
  subjectStaffId: number,
  changes: readonly GrantingChange[],
  requestId: string,
  createdAt: Date,
): IdentityAuditEntry[] {
  return changes.map((change) => ({
    actorStaffId: actor.staffId,
    subjectStaffId,
    subjectRoleId: null,
    changeType: auditChangeTypeOf(change),
    permissionCode: change.permissionCode ?? null,
    beforeValue: change.before,
    afterValue: change.after,
    requestId,
    createdAt,
  }));
}
