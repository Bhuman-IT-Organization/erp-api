/**
 * Test doubles shared by the layer specs and the controller e2e spec: in-memory repositories with
 * the SAME semantics as the Prisma ones — the member and role lists are keyset-paged on
 * `(sortField, id)` with `shared/http/keyset.ts`'s own comparator and answer the same meta (both
 * cursors, `total`, `rangeStart`), and apply the BE-19 filters, the search box and the cursor exactly
 * as the real query does, the permission
 * rows are stored in Perfex's `feature`/`capability` format, and the audit log can only be appended
 * to. A fake that ignored one of those would let a spec pass while the real repository misbehaved.
 *
 * Every seeded value is invented for the test. Nothing here comes from the client's data.
 */
import {
  compareKeys,
  encodeCursor,
  type DecodedCursor,
  type KeyValue,
} from '../../../shared/http/keyset.js';
import type { ListFilter, ListQuery } from '../../../shared/http/pagination.js';
import type { IdentityTransaction, RoleWriteColumns } from '../repository/identity.repository.js';
import {
  decodeRolePermissions,
  encodeRolePermissions,
} from '../repository/permission-rows.codec.js';
import type {
  AuditListField,
  Department,
  IdentityAuditEntry,
  IdentityAuditPage,
  IdentityAuditRow,
  MemberListField,
  MemberListRequest,
  MemberPage,
  MemberSortField,
  PerfexPermissionRow,
  RoleHolder,
  RoleListField,
  RoleListRequest,
  RoleMember,
  RolePage,
  RoleSortField,
  RoleRow,
  StaffMember,
  StaffName,
} from '../model/identity.model.js';

/** The two roles the seeded members point at. */
export const SEED_ROLES: readonly RoleRow[] = [
  {
    roleId: 10,
    name: 'Seed role A',
    // a:1:{s:5:"staff";a:1:{i:0;s:4:"view";}}
    serializedPermissions: 'a:1:{s:5:"staff";a:1:{i:0;s:4:"view";}}',
  },
  { roleId: 11, name: 'Seed role B', serializedPermissions: null },
];

/** One invented member; exported so a spec can seed more rows than one list page (plan 03.2-05). */
export function member(overrides: Partial<StaffMember> & { staffId: number }): StaffMember {
  return {
    email: `seed-${String(overrides.staffId)}@example.invalid`,
    firstName: `Seed${String(overrides.staffId)}`,
    lastName: 'Member',
    phoneNumber: null,
    facebook: null,
    linkedin: null,
    skype: null,
    hourlyRate: 0,
    defaultLanguage: null,
    direction: null,
    emailSignature: null,
    mediaPathSlug: `seed-${String(overrides.staffId)}-member`,
    profileImage: null,
    dateCreated: '2026-01-01T00:00:00.000Z',
    lastLogin: null,
    lastActivity: null,
    isAdmin: false,
    roleId: null,
    active: true,
    isNotStaff: false,
    ...overrides,
  };
}

/**
 * Four members: an administrator, two ordinary members and one deactivated. Staff 2 carries an
 * invented `profile_image` so the transformer's URL is exercised end to end, and staff 4 carries a
 * crafted one so a spec can prove a traversal value leaves the wire as `null`. Staff 2 has signed in
 * and been active; staff 1, 3 and 4 never have, which is Perfex's "Never" row.
 */
export const SEED_MEMBERS: readonly StaffMember[] = [
  member({ staffId: 1, isAdmin: true, roleId: 10 }),
  member({
    staffId: 2,
    roleId: 10,
    profileImage: 'seed-photo.png',
    lastLogin: '2026-02-03T09:15:00.000Z',
    lastActivity: '2026-02-03T11:45:00.000Z',
  }),
  member({ staffId: 3, roleId: null, active: false }),
  member({ staffId: 4, roleId: 11, isNotStaff: true, profileImage: '../../../etc/passwd' }),
];

/** Perfex-format rows per staff id — the format the table really holds. */
export const SEED_PERMISSION_ROWS: Readonly<Record<number, readonly PerfexPermissionRow[]>> = {
  1: [],
  2: [
    { feature: 'staff', capability: 'view' },
    { feature: 'invoices', capability: 'view' },
    // Not in the ADR-0033 mapping: the enricher must drop and count it, never pass it through.
    { feature: 'edit', capability: 'tasks' },
  ],
  3: [],
  4: [],
};

/**
 * The departments the stubbed `DepartmentsFacade` of identity's test app knows (D-55): ids 1, 2 and
 * 3, by name then id as `listForPicker` answers them.
 */
export const SEED_PICKER_DEPARTMENTS: readonly Department[] = [
  { departmentId: 1, name: 'Seed department one' },
  { departmentId: 3, name: 'Seed department three' },
  { departmentId: 2, name: 'Seed department two' },
];

export const SEED_DEPARTMENT_IDS: Readonly<Record<number, readonly number[]>> = {
  1: [1, 2],
  2: [2],
  3: [],
  4: [],
};

function memberValue(row: StaffMember, field: MemberListField): string | number {
  switch (field) {
    case 'staffId':
      return row.staffId;
    case 'active':
      return row.active ? 1 : 0;
    case 'isAdmin':
      return row.isAdmin ? 1 : 0;
    case 'roleId':
      return row.roleId ?? -1;
    case 'email':
      return row.email;
    case 'firstName':
      return row.firstName;
    case 'lastName':
      return row.lastName;
  }
}

function flag(raw: string): number {
  return ['1', 'true', 'yes'].includes(raw.toLowerCase()) ? 1 : 0;
}

function matches(row: StaffMember, filter: ListFilter<MemberListField>): boolean {
  const actual = memberValue(row, filter.field);
  const numeric = typeof actual === 'number';
  const cast = (raw: string): string | number => {
    if (filter.field === 'active' || filter.field === 'isAdmin') return flag(raw);
    return numeric ? Number(raw) : raw;
  };
  const list: readonly string[] = typeof filter.value === 'string' ? [filter.value] : filter.value;
  const single = typeof filter.value === 'string' ? filter.value : (filter.value[0] ?? '');
  switch (filter.op) {
    case 'eq':
      return actual === cast(single);
    case 'ne':
      return actual !== cast(single);
    case 'in':
      return list.map(cast).includes(actual);
    case 'like':
      return numeric ? true : actual.includes(single);
    case 'gt':
      return actual > cast(single);
    case 'gte':
      return actual >= cast(single);
    case 'lt':
      return actual < cast(single);
    case 'lte':
      return actual <= cast(single);
  }
}

type Key = readonly [KeyValue, number];

/** The value a member row's sort column holds, as the repository reads it (`active` is 0/1). */
function memberSortKey(row: StaffMember, field: MemberSortField): Key {
  switch (field) {
    case 'staffId':
      return [row.staffId, row.staffId];
    case 'firstName':
      return [row.firstName, row.staffId];
    case 'email':
      return [row.email, row.staffId];
    case 'active':
      return [row.active ? 1 : 0, row.staffId];
  }
}

function roleSortKey(row: RoleRow, field: RoleSortField): Key {
  return field === 'name' ? [row.name, row.roleId] : [row.roleId, row.roleId];
}

/**
 * One keyset page of `rows` (already filtered) with the meta rules of the repository: ordered by
 * `compareKeys`, `after` takes the next `limit` rows, `before` the `limit` rows just ahead of the
 * cursor, `total` is every row, `rangeStart` the rank of the first row returned.
 */
function keysetPage<T>(
  rows: readonly T[],
  keyOf: (row: T) => Key,
  sortField: string,
  order: 'asc' | 'desc',
  cursor: DecodedCursor<string> | null,
  limit: number,
): {
  page: T[];
  nextCursor: string | null;
  prevCursor: string | null;
  total: number;
  rangeStart: number;
} {
  const sorted = [...rows].sort((left, right) => compareKeys(keyOf(left), keyOf(right), order));
  const ahead = (row: T): boolean =>
    cursor !== null && compareKeys(keyOf(row), cursor.key, order) < 0;
  const behind = (row: T): boolean =>
    cursor === null || compareKeys(keyOf(row), cursor.key, order) > 0;
  let page: T[];
  if (cursor?.direction === 'before') {
    const earlier = sorted.filter(ahead);
    page = earlier.slice(Math.max(0, earlier.length - limit));
  } else {
    page = sorted.filter(behind).slice(0, limit);
  }
  const total = sorted.length;
  const first = page[0];
  const last = page.at(-1);
  if (first === undefined || last === undefined) {
    return { page, nextCursor: null, prevCursor: null, total, rangeStart: 0 };
  }
  const rangeStart =
    sorted.filter((row) => compareKeys(keyOf(row), keyOf(first), order) < 0).length + 1;
  return {
    page,
    nextCursor:
      rangeStart - 1 + page.length < total ? encodeCursor(sortField, keyOf(last), 'after') : null,
    prevCursor: rangeStart > 1 ? encodeCursor(sortField, keyOf(first), 'before') : null,
    total,
    rangeStart,
  };
}

export interface RecordedPermissionWrite {
  readonly staffId: number;
  readonly rows: readonly PerfexPermissionRow[];
}

/** The transaction token the fake hands its own write methods; opaque to every caller. */
const FAKE_TX = { fake: true } as unknown as IdentityTransaction;

/** Matches a role row against one BE-19 filter, the same two fields the real query allows. */
function roleMatches(row: RoleRow, filter: ListFilter<RoleListField>): boolean {
  const actual: string | number = filter.field === 'roleId' ? row.roleId : row.name;
  const numeric = typeof actual === 'number';
  const cast = (raw: string): string | number => (numeric ? Number(raw) : raw);
  const list: readonly string[] = typeof filter.value === 'string' ? [filter.value] : filter.value;
  const single = typeof filter.value === 'string' ? filter.value : (filter.value[0] ?? '');
  switch (filter.op) {
    case 'eq':
      return actual === cast(single);
    case 'ne':
      return actual !== cast(single);
    case 'in':
      return list.map(cast).includes(actual);
    case 'like':
      return numeric ? true : actual.includes(single);
    case 'gt':
      return actual > cast(single);
    case 'gte':
      return actual >= cast(single);
    case 'lt':
      return actual < cast(single);
    case 'lte':
      return actual <= cast(single);
  }
}

export class FakeIdentityRepository {
  readonly members: StaffMember[];
  /** Mutable, unlike `SEED_ROLES`: the role writes of plan 03.1-11 land here. */
  readonly roles: RoleRow[];
  readonly departmentIds: Record<number, number[]>;
  readonly permissionRows: Record<number, PerfexPermissionRow[]>;
  readonly permissionWrites: RecordedPermissionWrite[] = [];
  readonly departmentWrites: { staffId: number; departmentIds: readonly number[] }[] = [];
  /** Set by a spec to make the save fail after the profile write, so the rollback can be asserted. */
  failAfterProfileWrite: Error | null = null;
  /**
   * Set by a spec to make `countMembers` / `countRoles` answer this instead of the real count, so the
   * export cap (`EXPORT_MAX_ROWS`) can be crossed without seeding ten thousand rows.
   */
  memberCountOverride: number | null = null;
  roleCountOverride: number | null = null;
  private nextStaffId = 100;
  private nextRoleId = 200;

  constructor(members: readonly StaffMember[] = SEED_MEMBERS) {
    this.members = members.map((row) => ({ ...row }));
    this.roles = SEED_ROLES.map((row) => ({ ...row }));
    this.departmentIds = Object.fromEntries(
      Object.entries(SEED_DEPARTMENT_IDS).map(([id, ids]) => [Number(id), [...ids]]),
    );
    this.permissionRows = Object.fromEntries(
      Object.entries(SEED_PERMISSION_ROWS).map(([id, rows]) => [Number(id), [...rows]]),
    );
  }

  transaction<T>(run: (tx: IdentityTransaction) => Promise<T>): Promise<T> {
    return run(FAKE_TX);
  }

  /** How many name reads (`listActiveStaffNames`, `staffNamesOf`) reached this fake. */
  staffNameReads = 0;

  listActiveStaffNames(): Promise<StaffName[]> {
    this.staffNameReads += 1;
    const byName = (left: StaffMember, right: StaffMember) =>
      left.firstName.localeCompare(right.firstName) ||
      left.lastName.localeCompare(right.lastName) ||
      left.staffId - right.staffId;
    return Promise.resolve(
      this.members
        .filter((row) => row.active)
        .sort(byName)
        .map((row) => ({ staffId: row.staffId, name: `${row.firstName} ${row.lastName}` })),
    );
  }

  staffNamesOf(staffIds: readonly number[]): Promise<StaffName[]> {
    this.staffNameReads += 1;
    return Promise.resolve(
      this.members
        .filter((row) => staffIds.includes(row.staffId))
        .map((row) => ({ staffId: row.staffId, name: `${row.firstName} ${row.lastName}` })),
    );
  }

  findMemberById(staffId: number): Promise<StaffMember | null> {
    return Promise.resolve(this.members.find((row) => row.staffId === staffId) ?? null);
  }

  findStaffIdByEmail(email: string): Promise<number | null> {
    const found = [...this.members]
      .sort((left, right) => left.staffId - right.staffId)
      .find((row) => row.email === email);
    return Promise.resolve(found?.staffId ?? null);
  }

  /** The members the filters and `q` match — the real repository's `where`, never the cursor. */
  private matchingMembers(request: MemberListRequest): StaffMember[] {
    const { query, search } = request;
    return this.members
      .filter((row) => query.filters.every((filter) => matches(row, filter)))
      .filter(
        (row) =>
          search === null ||
          search === '' ||
          row.firstName.includes(search) ||
          row.lastName.includes(search) ||
          row.email.includes(search),
      );
  }

  /** The export's count: every member the filters and `q` match (the list's `total`). */
  countMembers(request: MemberListRequest): Promise<number> {
    return Promise.resolve(this.memberCountOverride ?? this.matchingMembers(request).length);
  }

  listMembers(request: MemberListRequest): Promise<MemberPage> {
    const { query, sortField, order, cursor } = request;
    const matching = this.matchingMembers(request);
    const { page: rows, ...meta } = keysetPage(
      matching,
      (row) => memberSortKey(row, sortField),
      sortField,
      order,
      cursor,
      query.limit,
    );
    // The real query resolves the page's role names in one read and answers `null` for an id
    // `tblroles` no longer holds; the fake resolves against its own roles for the same reason.
    const page = rows.map((row) => ({
      staffId: row.staffId,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      phoneNumber: row.phoneNumber,
      profileImage: row.profileImage,
      isAdmin: row.isAdmin,
      roleId: row.roleId,
      roleName: this.roles.find((role) => role.roleId === row.roleId)?.name ?? null,
      active: row.active,
      dateCreated: row.dateCreated,
      lastLogin: row.lastLogin,
    }));
    return Promise.resolve({ items: page, ...meta });
  }

  listDepartmentIds(staffId: number): Promise<number[]> {
    return Promise.resolve([...(this.departmentIds[staffId] ?? [])]);
  }

  /** How many staff members hold `departmentId` (each counted once, however many rows it has). */
  countDepartmentMembers(departmentId: number): Promise<number> {
    return Promise.resolve(
      Object.values(this.departmentIds).filter((ids) => ids.includes(departmentId)).length,
    );
  }

  listPermissionRows(staffId: number): Promise<PerfexPermissionRow[]> {
    return Promise.resolve([...(this.permissionRows[staffId] ?? [])]);
  }

  findRole(roleId: number): Promise<RoleRow | null> {
    return Promise.resolve(this.roles.find((row) => row.roleId === roleId) ?? null);
  }

  /** The real codec, so a spec that round-trips a template exercises the bytes Perfex reads. */
  decodeTemplate(_roleId: number, serialized: string | null): Record<string, string[]> {
    return decodeRolePermissions(serialized);
  }

  async findRoleTemplate(roleId: number): Promise<Record<string, string[]>> {
    const role = await this.findRole(roleId);
    return role === null ? {} : decodeRolePermissions(role.serializedPermissions);
  }

  /** `q` matches case-insensitively, as `LIKE` does under the local database's collation. */
  private matchingRoles(request: RoleListRequest): RoleRow[] {
    const { query, search } = request;
    const needle = search?.toLowerCase() ?? '';
    return this.roles
      .filter((row) => query.filters.every((filter) => roleMatches(row, filter)))
      .filter((row) => needle === '' || row.name.toLowerCase().includes(needle));
  }

  /** The export's count: every role the filters and `q` match (the list's `total`). */
  countRoles(request: RoleListRequest): Promise<number> {
    return Promise.resolve(this.roleCountOverride ?? this.matchingRoles(request).length);
  }

  listRoles(request: RoleListRequest): Promise<RolePage> {
    const { query, sortField, order, cursor } = request;
    const matching = this.matchingRoles(request);
    const { page, ...meta } = keysetPage(
      matching,
      (row) => roleSortKey(row, sortField),
      sortField,
      order,
      cursor,
      query.limit,
    );
    return Promise.resolve({
      items: page.map((row) => ({
        roleId: row.roleId,
        name: row.name,
        memberCount: this.members.filter((member) => member.roleId === row.roleId).length,
      })),
      ...meta,
    });
  }

  /** `roleId -> name` for the ids given; an id no role holds is absent, as the real map has it. */
  findRoleNamesByIds(roleIds: readonly number[]): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    for (const id of roleIds) {
      const role = this.roles.find((row) => row.roleId === id);
      if (role !== undefined) names.set(id, role.name);
    }
    return Promise.resolve(names);
  }

  countMembersByRole(roleIds: readonly number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    for (const id of roleIds) {
      const held = this.members.filter((member) => member.roleId === id).length;
      if (held > 0) counts.set(id, held);
    }
    return Promise.resolve(counts);
  }

  countMembersOfRole(roleId: number): Promise<number> {
    return Promise.resolve(this.members.filter((member) => member.roleId === roleId).length);
  }

  listRoleMembers(roleId: number): Promise<RoleMember[]> {
    return Promise.resolve(
      this.members
        .filter((member) => member.roleId === roleId)
        .map((member) => ({
          staffId: member.staffId,
          firstName: member.firstName,
          lastName: member.lastName,
          email: member.email,
          active: member.active,
        })),
    );
  }

  listRoleHolders(roleId: number): Promise<RoleHolder[]> {
    return Promise.resolve(
      this.members
        .filter((member) => member.roleId === roleId)
        .map((member) => ({
          staffId: member.staffId,
          isAdmin: member.isAdmin,
          isNotStaff: member.isNotStaff,
        })),
    );
  }

  findRoleIdByName(name: string): Promise<number | null> {
    const found = [...this.roles]
      .sort((left, right) => left.roleId - right.roleId)
      .find((row) => row.name === name);
    return Promise.resolve(found?.roleId ?? null);
  }

  countAdministrators(): Promise<number> {
    return Promise.resolve(this.members.filter((member) => member.isAdmin).length);
  }

  readonly roleWrites: { roleId: number; columns: RoleWriteColumns }[] = [];
  /** Set by a spec to make a role write fail after the role row landed, so the rollback is provable. */
  failAfterRoleWrite: Error | null = null;

  insertRole(
    _tx: IdentityTransaction,
    columns: RoleWriteColumns & {
      readonly name: string;
      readonly template: Readonly<Record<string, readonly string[]>>;
    },
  ): Promise<number> {
    const roleId = this.nextRoleId;
    this.nextRoleId += 1;
    this.roles.push({
      roleId,
      name: columns.name,
      serializedPermissions: encodeRolePermissions(columns.template),
    });
    this.roleWrites.push({ roleId, columns });
    if (this.failAfterRoleWrite !== null) return Promise.reject(this.failAfterRoleWrite);
    return Promise.resolve(roleId);
  }

  updateRole(_tx: IdentityTransaction, roleId: number, columns: RoleWriteColumns): Promise<void> {
    const index = this.roles.findIndex((row) => row.roleId === roleId);
    const current = this.roles[index];
    if (current !== undefined) {
      this.roles[index] = {
        ...current,
        ...(columns.name === undefined ? {} : { name: columns.name }),
        ...(columns.template === undefined
          ? {}
          : { serializedPermissions: encodeRolePermissions(columns.template) }),
      };
    }
    this.roleWrites.push({ roleId, columns });
    if (this.failAfterRoleWrite !== null) return Promise.reject(this.failAfterRoleWrite);
    return Promise.resolve();
  }

  deleteRole(_tx: IdentityTransaction, roleId: number): Promise<void> {
    const index = this.roles.findIndex((row) => row.roleId === roleId);
    if (index >= 0) this.roles.splice(index, 1);
    this.roleWrites.push({ roleId, columns: {} });
    if (this.failAfterRoleWrite !== null) return Promise.reject(this.failAfterRoleWrite);
    return Promise.resolve();
  }

  insertMember(
    _tx: IdentityTransaction,
    columns: { email: string; firstname: string; lastname: string },
  ): Promise<number> {
    const staffId = this.nextStaffId;
    this.nextStaffId += 1;
    this.members.push(
      member({
        staffId,
        email: columns.email,
        firstName: columns.firstname,
        lastName: columns.lastname,
      }),
    );
    return Promise.resolve(staffId);
  }

  updateMember(
    _tx: IdentityTransaction,
    staffId: number,
    columns: Record<string, unknown>,
  ): Promise<void> {
    const index = this.members.findIndex((row) => row.staffId === staffId);
    const current = this.members[index];
    if (current !== undefined) {
      this.members[index] = {
        ...current,
        ...(typeof columns.email === 'string' ? { email: columns.email } : {}),
        ...(typeof columns.firstname === 'string' ? { firstName: columns.firstname } : {}),
        ...(typeof columns.lastname === 'string' ? { lastName: columns.lastname } : {}),
        ...(typeof columns.admin === 'number' ? { isAdmin: columns.admin === 1 } : {}),
        ...(typeof columns.active === 'number' ? { active: columns.active === 1 } : {}),
        ...('role' in columns
          ? { roleId: typeof columns.role === 'number' ? columns.role : null }
          : {}),
      };
    }
    if (this.failAfterProfileWrite !== null) return Promise.reject(this.failAfterProfileWrite);
    return Promise.resolve();
  }

  readonly slugWrites: { staffId: number; slug: string }[] = [];

  setMediaPathSlug(_tx: IdentityTransaction, staffId: number, slug: string): Promise<void> {
    this.slugWrites.push({ staffId, slug });
    return Promise.resolve();
  }

  replaceDepartments(
    _tx: IdentityTransaction,
    staffId: number,
    departmentIds: readonly number[],
  ): Promise<void> {
    this.departmentWrites.push({ staffId, departmentIds: [...departmentIds] });
    this.departmentIds[staffId] = [...departmentIds];
    return Promise.resolve();
  }

  replacePermissionRows(
    _tx: IdentityTransaction,
    staffId: number,
    rows: readonly PerfexPermissionRow[],
  ): Promise<void> {
    this.permissionWrites.push({ staffId, rows: [...rows] });
    this.permissionRows[staffId] = [...rows];
    return Promise.resolve();
  }
}

/** The audit log's fake: append and list, exactly the two methods the real class has. */
export class FakeIdentityAuditRepository {
  readonly appended: IdentityAuditEntry[] = [];
  private nextId = 1;

  append(_tx: IdentityTransaction, entries: readonly IdentityAuditEntry[]): Promise<void> {
    this.appended.push(...entries);
    return Promise.resolve();
  }

  list(query: ListQuery<AuditListField>): Promise<IdentityAuditPage> {
    const rows: IdentityAuditRow[] = this.appended.map((entry, index) => ({
      ...entry,
      id: String(index + this.nextId),
    }));
    const descending =
      (query.sort.find((entry) => entry.field === 'createdAt')?.direction ?? 'desc') === 'desc';
    const ordered = descending ? [...rows].reverse() : rows;
    const page = ordered.slice(0, query.limit);
    const last = page.at(-1);
    const hasMore = ordered.length > query.limit;
    return Promise.resolve({
      rows: page,
      nextCursor: hasMore && last !== undefined ? last.id : null,
    });
  }
}
