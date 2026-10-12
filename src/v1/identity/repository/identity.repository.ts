/**
 * The only file in this module that touches Prisma for the four identity tables (BE-04, BE-08,
 * DB-04; the architecture block in `eslint.config.mjs` rejects the import anywhere else).
 *
 * Owner of every table it writes (ADR-0029, ADR-0034 d.1; `ownership.json` since plan 03.1-05's
 * flip, ratchet 77):
 *   `tblstaff`               node — **writes** the profile columns of brief §2.1 (never
 *                            `profile_image`, `last_activity`, a two-factor column or an HR record
 *                            column) and additionally **reads** three: `profile_image` (the legacy
 *                            staff list and member page render the photo; Perfex's uploader stays
 *                            the only writer, brief §9), `last_login` and `last_activity` (the list's
 *                            fourth column and the member page's header). `v1/auth` keeps `password`
 *                            on re-hash, `last_login` and `last_ip` — the one recorded, column-scoped
 *                            exception to ADR-0034 d.1; a read is not a write and does not touch it.
 *   `tblstaff_departments`   node — all three columns, diffed on save.
 *   `tblstaff_permissions`   node — all three columns, **raw only**: the table has no primary key,
 *                            so Prisma `@@ignore`s it and offers no delegate. Plan 05 taught the
 *                            ownership guard to parse a raw write's target tables, which is what
 *                            makes these two statements legal and everything else refused.
 *   `tblroles`               node — `roleid`, `name` and the PHP `serialize()` `permissions`
 *                            column, which only `permission-rows.codec.ts` encodes because Perfex's
 *                            own roles screen still reads it.
 *
 * Departments are not read here: the member form's picker and the check of a member's department
 * ids go through `DepartmentsFacade` (the transport; D-55), so this module names no departments
 * table. `countDepartmentMembers` is the count identity registers with that facade (D-51).
 *
 * Every write method takes the caller's transaction client, so the **service** owns the transaction
 * boundary: profile columns, department rows, permission rows and the audit row commit together or
 * not at all (ADR-0034 d.3, threat T-3.1-43).
 *
 * Every row is re-parsed through its zod schema, never trusted from the generic (BE-11).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService, type ExtendedPrismaClient } from '../../../shared/db/prisma.service.js';
import {
  encodeCursor,
  keysetWhere,
  type DecodedCursor,
  type KeyValue,
} from '../../../shared/http/keyset.js';
import type { ListFilter } from '../../../shared/http/pagination.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import {
  perfexPermissionRowSchema,
  roleListDbRowSchema,
  roleMemberRowSchema,
  roleRowSchema,
  staffRowSchema,
  type StaffRow,
} from '../dto/identity.dto.js';
import type {
  MemberListField,
  MemberListRequest,
  MemberListRow,
  MemberPage,
  MemberSortField,
  PerfexPermissionRow,
  RoleHolder,
  RoleListField,
  RoleListRequest,
  RoleListRow,
  RoleMember,
  RolePage,
  RoleSortField,
  RoleRow,
  StaffMember,
  StaffName,
} from '../model/identity.model.js';
import { decodeRolePermissions, encodeRolePermissions } from './permission-rows.codec.js';

/**
 * The transaction client an interactive `$transaction` hands its callback. Declared here because
 * `repository/` is the only place allowed to name a Prisma type (BE-08); the service treats it as
 * an opaque token it passes back to a repository.
 */
export type IdentityTransaction = Omit<
  ExtendedPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;

/**
 * The `tblstaff` columns this module reads. Nothing else leaves the row — never the password hash.
 * `profile_image`, `last_login` and `last_activity` are read only: `MemberWriteColumns` has no field
 * for any of them, so no statement here can set one (Perfex's uploader owns the photo and the column,
 * brief §9; `v1/auth` owns `last_login`; Perfex owns `last_activity`).
 */
const STAFF_COLUMNS = {
  staffid: true,
  email: true,
  firstname: true,
  lastname: true,
  phonenumber: true,
  facebook: true,
  linkedin: true,
  skype: true,
  hourly_rate: true,
  default_language: true,
  direction: true,
  email_signature: true,
  media_path_slug: true,
  profile_image: true,
  datecreated: true,
  last_login: true,
  last_activity: true,
  admin: true,
  role: true,
  active: true,
  is_not_staff: true,
} as const;

/** What another module may learn of a member (M13): the id and the two name parts; `active` filters. */
const STAFF_NAME_COLUMNS = {
  staffid: true,
  firstname: true,
  lastname: true,
  active: true,
} as const;
const staffNameRowsSchema = z.array(
  z.object({ staffid: z.number().int(), firstname: z.string(), lastname: z.string() }),
);

/** Perfex's `get_staff_full_name`: the first name, a space, the last name. */
function toStaffName(row: { staffid: number; firstname: string; lastname: string }): StaffName {
  return { staffId: row.staffid, name: `${row.firstname} ${row.lastname}` };
}

const permissionRowsSchema = z.array(perfexPermissionRowSchema);
const departmentRowsSchema = z.array(
  z.object({ staffdepartmentid: z.number().int(), departmentid: z.number().int() }),
);
const roleListDbRowsSchema = z.array(roleListDbRowSchema);
const roleMemberRowsSchema = z.array(roleMemberRowSchema);
const roleHolderRowsSchema = z.array(
  z.object({
    staffid: z.number().int(),
    admin: z.number().int(),
    is_not_staff: z.number().int(),
  }),
);
/** `groupBy({ by: ['role'] })` rows: the role a set of members points at and how many they are. */
const groupedRoleCountsSchema = z.array(
  z.object({
    role: z.number().int().nullable(),
    _count: z.object({ staffid: z.number().int() }),
  }),
);

/**
 * The `tblroles` columns a role save writes. `template` is the domain's `feature => capability[]`
 * map; this file encodes it with `permission-rows.codec.ts` on the way in, so the PHP `serialize()`
 * text exists only inside `repository/` and the service never handles it (BE-08).
 */
export interface RoleWriteColumns {
  readonly name?: string;
  readonly template?: Readonly<Record<string, readonly string[]>>;
}

/** `RoleWriteColumns` as `tblroles` takes them: the template already serialised. */
function roleColumns(columns: RoleWriteColumns): { name?: string; permissions?: string } {
  return {
    ...(columns.name === undefined ? {} : { name: columns.name }),
    ...(columns.template === undefined
      ? {}
      : { permissions: encodeRolePermissions(columns.template) }),
  };
}

/** The `tblstaff` columns a member save writes. `password` is already hashed by the service. */
export interface MemberWriteColumns {
  readonly email?: string;
  readonly firstname?: string;
  readonly lastname?: string;
  readonly phonenumber?: string | null;
  readonly facebook?: string | null;
  readonly linkedin?: string | null;
  readonly skype?: string | null;
  readonly hourly_rate?: number;
  readonly default_language?: string | null;
  readonly direction?: string | null;
  readonly email_signature?: string | null;
  readonly media_path_slug?: string | null;
  readonly admin?: number;
  readonly role?: number | null;
  readonly active?: number;
  readonly is_not_staff?: number;
  readonly password?: string;
  readonly last_password_change?: Date;
}

/** Everything `tblstaff` needs to insert a row; `datecreated` is the service's clock. */
export interface MemberInsertColumns extends MemberWriteColumns {
  readonly email: string;
  readonly firstname: string;
  readonly lastname: string;
  readonly password: string;
  readonly datecreated: Date;
}

/** `staffId`-keyed numeric and string columns the BE-19 filters map onto. */
const MEMBER_FILTER_COLUMNS = {
  staffId: { column: 'staffid', kind: 'number' },
  active: { column: 'active', kind: 'boolean-int' },
  isAdmin: { column: 'admin', kind: 'boolean-int' },
  roleId: { column: 'role', kind: 'number' },
  email: { column: 'email', kind: 'string' },
  firstName: { column: 'firstname', kind: 'string' },
  lastName: { column: 'lastname', kind: 'string' },
} as const satisfies Record<MemberListField, { column: string; kind: string }>;

type WhereValue = Record<string, unknown>;

/** `true`/`1`/`yes` are 1; everything else is 0 — Perfex stores `active`/`admin` as tinyint. */
function toFlag(value: string): number {
  return ['1', 'true', 'yes'].includes(value.toLowerCase()) ? 1 : 0;
}

/**
 * One BE-19 filter as a Prisma `where` fragment. The value is always a bound parameter — the eight
 * operators are a closed set and the column comes from the allowlist, so no caller-supplied text
 * ever reaches SQL as syntax (threat T-3.1-42).
 */
function filterFragment(filter: ListFilter<MemberListField>): WhereValue | null {
  const spec = MEMBER_FILTER_COLUMNS[filter.field];
  const list: readonly string[] = typeof filter.value === 'string' ? [filter.value] : filter.value;
  const single = typeof filter.value === 'string' ? filter.value : (filter.value[0] ?? '');
  const cast = (raw: string): number | string => {
    if (spec.kind === 'number') return Number(raw);
    if (spec.kind === 'boolean-int') return toFlag(raw);
    return raw;
  };
  const numeric = spec.kind !== 'string';
  switch (filter.op) {
    case 'eq':
      return { [spec.column]: cast(single) };
    case 'ne':
      return { [spec.column]: { not: cast(single) } };
    case 'in':
      return { [spec.column]: { in: list.map(cast) } };
    case 'like':
      return numeric ? null : { [spec.column]: { contains: single } };
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return { [spec.column]: { [filter.op]: cast(single) } };
    default:
      return null;
  }
}

/** The `tblroles` column each BE-19 role filter field addresses. */
const ROLE_FILTER_COLUMNS = {
  roleId: { column: 'roleid', kind: 'number' },
  name: { column: 'name', kind: 'string' },
} as const satisfies Record<RoleListField, { column: string; kind: string }>;

/**
 * One BE-19 filter on the roles list as a Prisma `where` fragment. Same shape as the member one and
 * for the same reason: the column comes from a two-entry allowlist and the value is always a bound
 * parameter, so no caller text ever reaches SQL as syntax (threat T-3.1-42).
 */
function roleFilterFragment(filter: ListFilter<RoleListField>): WhereValue | null {
  const spec = ROLE_FILTER_COLUMNS[filter.field];
  const list: readonly string[] = typeof filter.value === 'string' ? [filter.value] : filter.value;
  const single = typeof filter.value === 'string' ? filter.value : (filter.value[0] ?? '');
  const numeric = spec.kind === 'number';
  const cast = (raw: string): number | string => (numeric ? Number(raw) : raw);
  switch (filter.op) {
    case 'eq':
      return { [spec.column]: cast(single) };
    case 'ne':
      return { [spec.column]: { not: cast(single) } };
    case 'in':
      return { [spec.column]: { in: list.map(cast) } };
    case 'like':
      return numeric ? null : { [spec.column]: { contains: single } };
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte':
      return { [spec.column]: { [filter.op]: cast(single) } };
    default:
      return null;
  }
}

/** The `tblstaff` column each member sort field orders by; the column never comes from input. */
const MEMBER_SORT_COLUMNS = {
  staffId: 'staffid',
  firstName: 'firstname',
  email: 'email',
  active: 'active',
} as const satisfies Record<MemberSortField, keyof StaffRow>;

/** The `tblroles` column each role sort field orders by. */
const ROLE_SORT_COLUMNS = { roleId: 'roleid', name: 'name' } as const satisfies Record<
  RoleSortField,
  'roleid' | 'name'
>;

/**
 * The `where` fragments of a member list request: its BE-19 filters and Perfex's search box (first
 * name, last name or e-mail). Never the cursor — the page, its `total` and the export's count all
 * start from this, so the three can never disagree about which rows match.
 */
function memberMatch(request: MemberListRequest): WhereValue[] {
  const and: WhereValue[] = [];
  for (const filter of request.query.filters) {
    const fragment = filterFragment(filter);
    if (fragment !== null) and.push(fragment);
  }
  const { search } = request;
  if (search !== null && search !== '') {
    and.push({
      OR: [
        { firstname: { contains: search } },
        { lastname: { contains: search } },
        { email: { contains: search } },
      ],
    });
  }
  return and;
}

/** The `where` fragments of a role list request: its BE-19 filters and `q` over the name. */
function roleMatch(request: RoleListRequest): WhereValue[] {
  const and: WhereValue[] = [];
  for (const filter of request.query.filters) {
    const fragment = roleFilterFragment(filter);
    if (fragment !== null) and.push(fragment);
  }
  const { search } = request;
  if (search !== null && search !== '') and.push({ name: { contains: search } });
  return and;
}

/** Sort direction of the query itself: a `before` cursor reads the order backwards, then reverses. */
function readDirection(
  order: 'asc' | 'desc',
  cursor: DecodedCursor<string> | null,
): 'asc' | 'desc' {
  if (cursor?.direction !== 'before') return order;
  return order === 'asc' ? 'desc' : 'asc';
}

/** `{ AND: [...] }`, or `{}` when there is nothing to AND. */
function allOf(fragments: readonly WhereValue[]): WhereValue {
  return fragments.length > 0 ? { AND: [...fragments] } : {};
}

/**
 * The list meta both lists answer, from the page and the two counts (`shared/http/keyset.ts`):
 * `rangeStart` is the first row's rank (0 on an empty page); Next exists while rows remain after the
 * page, Previous while rows exist before it.
 */
function pageMeta(
  sortField: string,
  keys: readonly (readonly [KeyValue, number])[],
  total: number,
  before: number,
): { nextCursor: string | null; prevCursor: string | null; total: number; rangeStart: number } {
  const first = keys[0];
  const last = keys.at(-1);
  if (first === undefined || last === undefined) {
    return { nextCursor: null, prevCursor: null, total, rangeStart: 0 };
  }
  const rangeStart = before + 1;
  return {
    nextCursor:
      rangeStart - 1 + keys.length < total ? encodeCursor(sortField, last, 'after') : null,
    prevCursor: rangeStart > 1 ? encodeCursor(sortField, first, 'before') : null,
    total,
    rangeStart,
  };
}

@Injectable()
export class IdentityRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Opens one interactive `$transaction` and hands its client to `run`. The service calls this so
   * it owns the boundary while Prisma stays inside `repository/` (BE-08): everything `run` writes
   * — profile columns, department rows, the raw permission rows and the audit row — commits
   * together or not at all.
   */
  transaction<T>(run: (tx: IdentityTransaction) => Promise<T>): Promise<T> {
    return this.prisma.client.$transaction((tx) => run(tx));
  }

  // --- reads -----------------------------------------------------------------------------------

  async findMemberById(staffId: number): Promise<StaffMember | null> {
    const row = await this.prisma.client.tblstaff.findUnique({
      where: { staffid: staffId },
      select: STAFF_COLUMNS,
    });
    return row === null ? null : toMember(staffRowSchema.parse(row));
  }

  /**
   * The staff id holding an e-mail, or `null`. `tblstaff.email` carries no unique constraint in the
   * mirror, so the lowest id wins deterministically — the same rule `v1/auth` uses.
   */
  async findStaffIdByEmail(email: string): Promise<number | null> {
    const row = await this.prisma.client.tblstaff.findFirst({
      where: { email },
      orderBy: { staffid: 'asc' },
      select: { staffid: true },
    });
    return row?.staffid ?? null;
  }

  /**
   * One page of members, keyset-paged on `(sortField, staffid)`: the sort column orders, the id
   * breaks ties, so a page boundary inside a run of equal first names loses and repeats no row. `q`
   * is Perfex's staff-table search box: first name, last name or e-mail. The `own`-style row
   * narrowing of ADR-0033 decision 5 does not apply here: the staff list has no `viewOwn` code.
   *
   * Four queries, whatever the page size: the rows first (the rank needs the first row), then in ONE
   * `Promise.all` the `total` (filters and `q`, never the cursor), the rank of the first row (the
   * same, plus "before the first row") and ONE `findRoleNamesByIds` for the Role column. Never a
   * query per row. A `before` cursor (Previous) reads the order backwards and reverses the rows.
   */
  async listMembers(request: MemberListRequest): Promise<MemberPage> {
    const { query, sortField, order, cursor } = request;
    const column = MEMBER_SORT_COLUMNS[sortField];
    const and = memberMatch(request);
    const read = readDirection(order, cursor);
    const rows = await this.prisma.client.tblstaff.findMany({
      where:
        cursor === null
          ? allOf(and)
          : allOf([...and, keysetWhere(column, 'staffid', cursor, order)]),
      orderBy: [{ [column]: read }, { staffid: read }],
      take: query.limit,
      select: STAFF_COLUMNS,
    });
    const page = rows.map((row) => staffRowSchema.parse(row));
    if (read !== order) page.reverse();
    const keys = page.map((row): readonly [KeyValue, number] => [row[column], row.staffid]);
    const first = keys[0];
    const [total, before, names] = await Promise.all([
      this.prisma.client.tblstaff.count({ where: allOf(and) }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblstaff.count({
            where: allOf([
              ...and,
              keysetWhere(
                column,
                'staffid',
                { sort: sortField, key: first, direction: 'before' },
                order,
              ),
            ]),
          }),
      // The Role column's names for the WHOLE page in one read (see `findRoleNamesByIds`).
      this.findRoleNamesByIds(
        page.map((row) => row.role).filter((id): id is number => id !== null),
      ),
    ]);
    const items = page.map((row) =>
      toListRow(row, row.role === null ? null : (names.get(row.role) ?? null)),
    );
    return { items, ...pageMeta(sortField, keys, total, before) };
  }

  /**
   * Every member the list request's filters and `q` match — the list's own `total`, never the
   * cursor. The export (plan 03.2-05) counts with it before it reads a single row, so a request over
   * `EXPORT_MAX_ROWS` is refused for the price of one `COUNT`.
   */
  countMembers(request: MemberListRequest): Promise<number> {
    return this.prisma.client.tblstaff.count({ where: allOf(memberMatch(request)) });
  }

  async listDepartmentIds(staffId: number): Promise<number[]> {
    const rows = await this.prisma.client.tblstaff_departments.findMany({
      where: { staffid: staffId },
      select: { staffdepartmentid: true, departmentid: true },
      orderBy: { departmentid: 'asc' },
    });
    return departmentRowsSchema.parse(rows).map((row) => row.departmentid);
  }

  /**
   * How many DISTINCT staff members hold `departmentId` in `tblstaff_departments` (a member with two
   * rows of one department counts once): the `staffMembers` counter identity registers with
   * `DepartmentsFacade` (D-51). One typed read; answers a number, never a staff id; writes nothing.
   */
  async countDepartmentMembers(departmentId: number): Promise<number> {
    const holders = await this.prisma.client.tblstaff_departments.groupBy({
      by: ['staffid'],
      where: { departmentid: departmentId },
    });
    return holders.length;
  }

  /**
   * A member's stored permission rows, in Perfex's own format. The table is `@@ignore`d (no primary
   * key), so the tagged template binds `staffId` as a parameter and the ownership guard admits the
   * statement because it is a plain `SELECT`.
   */
  async listPermissionRows(staffId: number): Promise<PerfexPermissionRow[]> {
    const rows = await this.prisma.client.$queryRaw<
      unknown[]
    >`SELECT feature, capability FROM tblstaff_permissions WHERE staff_id = ${staffId}`;
    return permissionRowsSchema.parse(rows);
  }

  async findRole(roleId: number): Promise<RoleRow | null> {
    const row = await this.prisma.client.tblroles.findUnique({
      where: { roleid: roleId },
      select: { roleid: true, name: true, permissions: true },
    });
    if (row === null) return null;
    const parsed = roleRowSchema.parse(row);
    return { roleId: parsed.roleid, name: parsed.name, serializedPermissions: parsed.permissions };
  }

  /**
   * The `feature => capability[]` template of a role, decoded from the PHP `serialize()` column. A
   * malformed column warns once and answers `{}` — a template we cannot read grants nothing.
   */
  async findRoleTemplate(roleId: number): Promise<Record<string, string[]>> {
    const role = await this.findRole(roleId);
    if (role === null) return {};
    return this.decodeTemplate(roleId, role.serializedPermissions);
  }

  /** The same decode for a role row already in hand, so the detail read does not fetch it twice. */
  decodeTemplate(roleId: number, serialized: string | null): Record<string, string[]> {
    return decodeRolePermissions(serialized, (reason) => {
      this.logger.warn('tblroles.permissions is malformed', { roleId, reason });
    });
  }

  /**
   * One page of roles, keyset-paged on `(sortField, roleid)` exactly as `listMembers` pages, with
   * `q` over the role name. The per-row `memberCount` comes from ONE grouped count over
   * `tblstaff.role` restricted to the page's ids, never from loading the members; it runs in the same
   * `Promise.all` as the `total` and the rank of the first row (four queries per page).
   */
  async listRoles(request: RoleListRequest): Promise<RolePage> {
    const { query, sortField, order, cursor } = request;
    const column = ROLE_SORT_COLUMNS[sortField];
    const and = roleMatch(request);
    const read = readDirection(order, cursor);
    const rows = await this.prisma.client.tblroles.findMany({
      where:
        cursor === null
          ? allOf(and)
          : allOf([...and, keysetWhere(column, 'roleid', cursor, order)]),
      orderBy: [{ [column]: read }, { roleid: read }],
      take: query.limit,
      select: { roleid: true, name: true },
    });
    const page = roleListDbRowsSchema.parse(rows);
    if (read !== order) page.reverse();
    const keys = page.map((row): readonly [KeyValue, number] => [row[column], row.roleid]);
    const first = keys[0];
    const [total, before, counts] = await Promise.all([
      this.prisma.client.tblroles.count({ where: allOf(and) }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblroles.count({
            where: allOf([
              ...and,
              keysetWhere(
                column,
                'roleid',
                { sort: sortField, key: first, direction: 'before' },
                order,
              ),
            ]),
          }),
      this.countMembersByRole(page.map((row) => row.roleid)),
    ]);
    const items: RoleListRow[] = page.map((row) => ({
      roleId: row.roleid,
      name: row.name,
      memberCount: counts.get(row.roleid) ?? 0,
    }));
    return { items, ...pageMeta(sortField, keys, total, before) };
  }

  /** Every role the list request's filters and `q` match — the list's `total`; the export's count. */
  countRoles(request: RoleListRequest): Promise<number> {
    return this.prisma.client.tblroles.count({ where: allOf(roleMatch(request)) });
  }

  /** `roleId -> member count` for the ids given; a role nobody holds is simply absent from the map. */
  async countMembersByRole(roleIds: readonly number[]): Promise<Map<number, number>> {
    if (roleIds.length === 0) return new Map();
    const grouped = await this.prisma.client.tblstaff.groupBy({
      by: ['role'],
      where: { role: { in: [...roleIds] } },
      _count: { staffid: true },
    });
    const counts = new Map<number, number>();
    for (const row of groupedRoleCountsSchema.parse(grouped)) {
      if (row.role !== null) counts.set(row.role, row._count.staffid);
    }
    return counts;
  }

  /**
   * `roleId -> tblroles.name` for the ids given — ONE `IN (…)` read for a whole page of members, the
   * shape `countMembersByRole` uses for the roles list's `memberCount`. The staff list's Role column
   * therefore costs a single extra query per page and never one per row. Ids are de-duplicated (a
   * page usually holds few distinct roles), and a role id no longer in `tblroles` is simply absent
   * from the map — the caller reads that as the `null` the member detail read already answers.
   */
  async findRoleNamesByIds(roleIds: readonly number[]): Promise<Map<number, string>> {
    if (roleIds.length === 0) return new Map();
    const rows = await this.prisma.client.tblroles.findMany({
      where: { roleid: { in: [...new Set(roleIds)] } },
      select: { roleid: true, name: true },
    });
    const names = new Map<number, string>();
    for (const row of roleListDbRowsSchema.parse(rows)) names.set(row.roleid, row.name);
    return names;
  }

  /** How many members point at the role — the number `DELETE roles/:id` refuses on. */
  countMembersOfRole(roleId: number): Promise<number> {
    return this.prisma.client.tblstaff.count({ where: { role: roleId } });
  }

  /** The members holding the role, as `GET roles/:id` lists them. Never a password, never a hash. */
  async listRoleMembers(roleId: number): Promise<RoleMember[]> {
    const rows = await this.prisma.client.tblstaff.findMany({
      where: { role: roleId },
      orderBy: { staffid: 'asc' },
      select: { staffid: true, firstname: true, lastname: true, email: true, active: true },
    });
    return roleMemberRowsSchema.parse(rows).map((row) => ({
      staffId: row.staffid,
      firstName: row.firstname,
      lastName: row.lastname,
      email: row.email,
      active: row.active === 1,
    }));
  }

  /**
   * Every active member's name, by first name, last name, then id (the facade's `listActiveMembers`,
   * M13). Four columns leave the row, never the e-mail, the role or the password hash (T-4.2-74).
   */
  async listActiveStaffNames(): Promise<StaffName[]> {
    const rows = await this.prisma.client.tblstaff.findMany({
      where: { active: 1 },
      orderBy: [{ firstname: 'asc' }, { lastname: 'asc' }, { staffid: 'asc' }],
      select: STAFF_NAME_COLUMNS,
    });
    return staffNameRowsSchema.parse(rows).map(toStaffName);
  }

  /** The names of the ids it knows, active or not; an unknown id is left out (`namesOf`, M13). */
  async staffNamesOf(staffIds: readonly number[]): Promise<StaffName[]> {
    const rows = await this.prisma.client.tblstaff.findMany({
      where: { staffid: { in: [...staffIds] } },
      select: STAFF_NAME_COLUMNS,
    });
    return staffNameRowsSchema.parse(rows).map(toStaffName);
  }

  /** The holders the `applyToMembers` fan-out writes to, with the two flags that decide their rows. */
  async listRoleHolders(roleId: number): Promise<RoleHolder[]> {
    const rows = await this.prisma.client.tblstaff.findMany({
      where: { role: roleId },
      orderBy: { staffid: 'asc' },
      select: { staffid: true, admin: true, is_not_staff: true },
    });
    return roleHolderRowsSchema.parse(rows).map((row) => ({
      staffId: row.staffid,
      isAdmin: row.admin === 1,
      isNotStaff: row.is_not_staff === 1,
    }));
  }

  /**
   * The role holding a name, or `null`. `tblroles.name` carries no unique constraint in the mirror
   * (Perfex checks in PHP), so the lowest id wins deterministically and the service refuses the save.
   */
  async findRoleIdByName(name: string): Promise<number | null> {
    const row = await this.prisma.client.tblroles.findFirst({
      where: { name },
      orderBy: { roleid: 'asc' },
      select: { roleid: true },
    });
    return row?.roleid ?? null;
  }

  /** How many members carry `tblstaff.admin = 1` — the count the last-administrator rule reads. */
  countAdministrators(): Promise<number> {
    return this.prisma.client.tblstaff.count({ where: { admin: 1 } });
  }

  // --- writes (every one takes the caller's transaction client) --------------------------------

  /** Inserts the member and answers its new `staffid`. */
  async insertMember(tx: IdentityTransaction, columns: MemberInsertColumns): Promise<number> {
    const created = await tx.tblstaff.create({ data: { ...columns }, select: { staffid: true } });
    return created.staffid;
  }

  async updateMember(
    tx: IdentityTransaction,
    staffId: number,
    columns: MemberWriteColumns,
  ): Promise<void> {
    await tx.tblstaff.updateMany({ where: { staffid: staffId }, data: { ...columns } });
  }

  /** Perfex's `media_path_slug` fallback for a member whose name slugs to nothing: `unknown-<id>`. */
  async setMediaPathSlug(tx: IdentityTransaction, staffId: number, slug: string): Promise<void> {
    await tx.tblstaff.updateMany({ where: { staffid: staffId }, data: { media_path_slug: slug } });
  }

  /** Diffs the member's departments: removes the rows that are gone, adds the rows that are new. */
  async replaceDepartments(
    tx: IdentityTransaction,
    staffId: number,
    departmentIds: readonly number[],
  ): Promise<void> {
    const existing = departmentRowsSchema.parse(
      await tx.tblstaff_departments.findMany({
        where: { staffid: staffId },
        select: { staffdepartmentid: true, departmentid: true },
      }),
    );
    const removed = existing.filter((row) => !departmentIds.includes(row.departmentid));
    if (removed.length > 0) {
      await tx.tblstaff_departments.deleteMany({
        where: { staffdepartmentid: { in: removed.map((row) => row.staffdepartmentid) } },
      });
    }
    const added = departmentIds.filter((id) => !existing.some((row) => row.departmentid === id));
    if (added.length > 0) {
      await tx.tblstaff_departments.createMany({
        data: added.map((departmentid) => ({ staffid: staffId, departmentid })),
      });
    }
  }

  /**
   * Replaces the member's whole permission set, exactly as Perfex's own screens do. **Raw, because
   * there is no other way in:** `tblstaff_permissions` has no primary key, so Prisma `@@ignore`s it
   * and generates no delegate; plan 05's table-aware ownership guard parses the target table out of
   * each statement and admits it only because the register gives the table to `node`.
   *
   * Tagged templates only — never `$executeRawUnsafe`, never interpolation: every value is a bound
   * parameter, and `feature`/`capability` are catalogue-derived strings from `toPerfexPermission`
   * (threat T-3.1-42). One statement per row so the parameter list stays fixed.
   */
  async replacePermissionRows(
    tx: IdentityTransaction,
    staffId: number,
    rows: readonly PerfexPermissionRow[],
  ): Promise<void> {
    await tx.$executeRaw`DELETE FROM tblstaff_permissions WHERE staff_id = ${staffId}`;
    for (const row of rows) {
      await tx.$executeRaw`INSERT INTO tblstaff_permissions (staff_id, feature, capability) VALUES (${staffId}, ${row.feature}, ${row.capability})`;
    }
  }

  /**
   * Inserts the role and answers its new `roleid`. `permissions` is already the PHP `serialize()`
   * text the codec produced — Perfex's own roles screen reads this column, so the encoder is the
   * only thing allowed to write it (brief §6).
   */
  async insertRole(
    tx: IdentityTransaction,
    columns: RoleWriteColumns & {
      readonly name: string;
      readonly template: Readonly<Record<string, readonly string[]>>;
    },
  ): Promise<number> {
    const created = await tx.tblroles.create({
      data: { name: columns.name, permissions: encodeRolePermissions(columns.template) },
      select: { roleid: true },
    });
    return created.roleid;
  }

  async updateRole(
    tx: IdentityTransaction,
    roleId: number,
    columns: RoleWriteColumns,
  ): Promise<void> {
    await tx.tblroles.updateMany({ where: { roleid: roleId }, data: roleColumns(columns) });
  }

  /**
   * Deletes the role. The service refuses the delete while any member still points at the role, so
   * this never leaves a `tblstaff.role` dangling — `tblroles` has no foreign key to enforce it.
   */
  async deleteRole(tx: IdentityTransaction, roleId: number): Promise<void> {
    await tx.tblroles.deleteMany({ where: { roleid: roleId } });
  }
}

/** `tblstaff` row → the domain entity. `admin`, `active` and `is_not_staff` are Perfex tinyints. */
export function toMember(row: StaffRow): StaffMember {
  return {
    staffId: row.staffid,
    email: row.email,
    firstName: row.firstname,
    lastName: row.lastname,
    phoneNumber: row.phonenumber,
    facebook: row.facebook,
    linkedin: row.linkedin,
    skype: row.skype,
    hourlyRate: row.hourly_rate,
    defaultLanguage: row.default_language,
    direction: row.direction,
    emailSignature: row.email_signature,
    mediaPathSlug: row.media_path_slug,
    profileImage: row.profile_image,
    dateCreated: row.datecreated.toISOString(),
    lastLogin: row.last_login?.toISOString() ?? null,
    lastActivity: row.last_activity?.toISOString() ?? null,
    isAdmin: row.admin === 1,
    roleId: row.role,
    active: row.active === 1,
    isNotStaff: row.is_not_staff === 1,
  };
}

/**
 * `tblstaff` row → one list row (the list carries fewer columns than the detail). `roleName` is not
 * on the `tblstaff` row, so the caller passes the one it resolved for the page: `null` for a member
 * with no role and `null` for an id `tblroles` no longer holds.
 */
export function toListRow(row: StaffRow, roleName: string | null): MemberListRow {
  const member = toMember(row);
  return {
    staffId: member.staffId,
    email: member.email,
    firstName: member.firstName,
    lastName: member.lastName,
    phoneNumber: member.phoneNumber,
    profileImage: member.profileImage,
    isAdmin: member.isAdmin,
    roleId: member.roleId,
    roleName,
    active: member.active,
    dateCreated: member.dateCreated,
    lastLogin: member.lastLogin,
  };
}
