/**
 * IdentityRepository against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * Reads are plain. The two writes this spec proves are the ones only this module may make:
 * `tblstaff` through the typed delegate, and `tblstaff_permissions` through **raw SQL**, which is
 * the only way in — the table has no primary key, so Prisma `@@ignore`s it and generates no
 * delegate, and plan 03.1-05's table-aware ownership guard is what admits the statement.
 *
 * Everything this spec writes it creates itself and deletes again: one staff row on an
 * `@example.invalid` e-mail, its department rows and its permission rows. No seeded row is touched
 * and no value from the local data is read into an assertion.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import type { MemberPage, RolePage } from '../model/identity.model.js';
import { IdentityRepository } from '../repository/identity.repository.js';
import { encodeRolePermissions } from '../repository/permission-rows.codec.js';
import { IdentityValidator } from '../service/identity.validator.js';

const TEST_EMAIL = 'int-spec-03.1-12-repository@example.invalid';
const TEST_DEPARTMENT_IDS = [1, 2];
/** Every role this spec creates carries this prefix, so `afterAll` can delete exactly its own rows. */
const TEST_ROLE_PREFIX = 'int-spec-03.1-11-role';
/**
 * An id `tblroles` does not hold. `tblstaff.role` carries no foreign key (SF-7), so the list has to
 * survive one: the Role column answers `null`, exactly as the member detail read already does.
 */
const DANGLING_ROLE_ID = 999_999_42;

/**
 * The list requests go through the real validator, so the int spec pages with exactly the cursor,
 * sort and search the endpoint would hand the repository.
 */
const validator = new IdentityValidator();
type QueryInput = Record<string, string>;
const memberRequest = (input: QueryInput = {}) => validator.parseMemberListQuery(input);
const roleRequest = (input: QueryInput = {}) => validator.parseRoleListQuery(input);

/** `{ cursor }` when there is one: a first page sends no cursor key at all. */
const withCursor = (cursor: string | null): QueryInput => (cursor === null ? {} : { cursor });

interface Walk {
  readonly forward: number[];
  readonly backward: number[];
  readonly totals: Set<number>;
}

/**
 * Follows `nextCursor` from the first page to the last, checking each page's `rangeStart` against
 * the rows already seen, then `prevCursor` from the last page back to the first. `idOf` reads the
 * row id; `load` fetches one page for a cursor (`null` = the first page).
 */
async function walk<TPage extends MemberPage | RolePage>(
  load: (cursor: string | null) => Promise<TPage>,
  idOf: (page: TPage) => number[],
): Promise<Walk> {
  const forward: number[] = [];
  const totals = new Set<number>();
  let page = await load(null);
  for (;;) {
    const ids = idOf(page);
    totals.add(page.total);
    expect(page.rangeStart).toBe(ids.length === 0 ? 0 : forward.length + 1);
    forward.push(...ids);
    if (page.nextCursor === null) break;
    page = await load(page.nextCursor);
  }
  const backward = [...idOf(page)];
  while (page.prevCursor !== null) {
    page = await load(page.prevCursor);
    backward.unshift(...idOf(page));
    expect(page.rangeStart).toBe(forward.indexOf(idOf(page)[0] ?? -1) + 1);
  }
  return { forward, backward, totals };
}

describe.skipIf(!process.env.DATABASE_URL)('IdentityRepository against the local mirror', () => {
  const service = new PrismaService(new AppConfig(), new HealthService());
  const repository = new IdentityRepository(service, new LoggerService());
  let staffId = 0;

  beforeAll(async () => {
    await service.client
      .$executeRaw`DELETE FROM tblstaff_permissions WHERE staff_id IN (SELECT staffid FROM tblstaff WHERE email = ${TEST_EMAIL})`;
    await service.client.tblstaff.deleteMany({ where: { email: TEST_EMAIL } });
    staffId = await repository.transaction((tx) =>
      repository.insertMember(tx, {
        email: TEST_EMAIL,
        firstname: 'IntSpec',
        lastname: 'Repository',
        password: 'not-a-real-hash',
        datecreated: new Date(),
        admin: 0,
        active: 1,
        is_not_staff: 0,
      }),
    );
  });

  afterAll(async () => {
    await service.client.$executeRaw`DELETE FROM tblstaff_permissions WHERE staff_id = ${staffId}`;
    await service.client.tblstaff_departments.deleteMany({ where: { staffid: staffId } });
    await service.client.tblstaff.deleteMany({ where: { staffid: staffId } });
    await service.client.tblroles.deleteMany({ where: { name: { startsWith: TEST_ROLE_PREFIX } } });
    await service.client.$disconnect();
  });

  it('inserted the member and reads it back through the typed delegate', async () => {
    const member = await repository.findMemberById(staffId);
    expect(member?.email).toBe(TEST_EMAIL);
    expect(member?.isAdmin).toBe(false);
    expect(member?.active).toBe(true);
  });

  it('answers the staff id for an e-mail, and null for one nobody holds', async () => {
    expect(await repository.findStaffIdByEmail(TEST_EMAIL)).toBe(staffId);
    expect(await repository.findStaffIdByEmail('nobody-03.1-12@example.invalid')).toBeNull();
  });

  it('pages the member list by keyset on staffid', async () => {
    const page = await repository.listMembers(memberRequest({ limit: '2' }));
    expect(page.items).toHaveLength(2);
    const lastId = page.items[1]?.staffId;
    expect(decodeCursor(page.nextCursor, 'staffId')?.key).toEqual([lastId, lastId]);
    const next = await repository.listMembers(
      memberRequest({ limit: '2', ...withCursor(page.nextCursor) }),
    );
    expect(next.items[0]?.staffId).toBeGreaterThan(page.items[1]?.staffId ?? 0);
  });

  /**
   * The pager's contract against the real collation: sorted by first name, five rows a page, the
   * Next walk visits every member exactly once and as many as `total` says, and the Previous walk
   * from the last page visits the same rows in the same order. Three members sharing one first
   * name are inserted so the id tie-break is crossed by a page boundary, whatever the local data.
   */
  it('walks every member once by firstName, limit 5, forward and back, and the count equals total', async () => {
    const tie = (suffix: string): Promise<number> =>
      repository.transaction((tx) =>
        repository.insertMember(tx, {
          email: `int-spec-03.2-01-tie-${suffix}@example.invalid`,
          firstname: 'IntSpecTie',
          lastname: suffix,
          password: 'not-a-real-hash',
          datecreated: new Date(),
          admin: 0,
          active: 1,
          is_not_staff: 0,
        }),
      );
    const ties = [await tie('a'), await tie('b'), await tie('c')];
    try {
      const { forward, backward, totals } = await walk(
        (cursor) =>
          repository.listMembers(
            memberRequest({ sort: 'firstName', limit: '5', ...withCursor(cursor) }),
          ),
        (page) => page.items.map((row) => row.staffId),
      );
      expect(new Set(forward).size).toBe(forward.length);
      expect([...totals]).toEqual([forward.length]);
      expect(backward).toEqual(forward);
      expect(forward.filter((id) => ties.includes(id))).toEqual(ties);
      for (const id of [...ties, staffId]) expect(forward).toContain(id);

      const desc = await walk(
        (cursor) =>
          repository.listMembers(
            memberRequest({ sort: '-firstName', limit: '5', ...withCursor(cursor) }),
          ),
        (page) => page.items.map((row) => row.staffId),
      );
      expect([...desc.forward].sort((a, b) => a - b)).toEqual([...forward].sort((a, b) => a - b));
      expect(desc.backward).toEqual(desc.forward);
    } finally {
      await service.client.tblstaff.deleteMany({ where: { staffid: { in: ties } } });
    }
  });

  it('walks every member once by email and by active, limit 7, and counts only what q matches', async () => {
    for (const sort of ['email', '-active']) {
      const { forward, backward, totals } = await walk(
        (cursor) =>
          repository.listMembers(memberRequest({ sort, limit: '7', ...withCursor(cursor) })),
        (page) => page.items.map((row) => row.staffId),
      );
      expect(new Set(forward).size).toBe(forward.length);
      expect([...totals]).toEqual([forward.length]);
      expect(backward).toEqual(forward);
    }
    const searched = await repository.listMembers(memberRequest({ q: TEST_EMAIL, limit: '1' }));
    expect(searched).toMatchObject({ total: 1, rangeStart: 1, nextCursor: null, prevCursor: null });
  });

  it('filters the member list by the BE-19 allowlist and finds the row it created', async () => {
    const page = await repository.listMembers(memberRequest({ 'filter[email]': TEST_EMAIL }));
    expect(page.items.map((row) => row.staffId)).toEqual([staffId]);
  });

  it('searches first name, last name and e-mail through ?q=', async () => {
    const page = await repository.listMembers(memberRequest({ q: 'int-spec-03.1-12-repository' }));
    expect(page.items.map((row) => row.staffId)).toEqual([staffId]);
  });

  it("countMembers (the export's count, plan 03.2-05) equals the list's total for the same filters and q", async () => {
    for (const input of [
      {},
      { q: TEST_EMAIL },
      { 'filter[active]': '1' },
      { q: 'no-such-member-x' },
    ]) {
      const page = await repository.listMembers(memberRequest({ ...input, limit: '1' }));
      expect(await repository.countMembers(memberRequest(input)), JSON.stringify(input)).toBe(
        page.total,
      );
    }
    expect(await repository.countMembers(memberRequest({ q: TEST_EMAIL }))).toBe(1);
  });

  it('diffs department rows: adds, then removes what is gone', async () => {
    await repository.transaction((tx) =>
      repository.replaceDepartments(tx, staffId, TEST_DEPARTMENT_IDS),
    );
    expect(await repository.listDepartmentIds(staffId)).toEqual(TEST_DEPARTMENT_IDS);
    const kept = TEST_DEPARTMENT_IDS.slice(0, 1);
    await repository.transaction((tx) => repository.replaceDepartments(tx, staffId, kept));
    expect(await repository.listDepartmentIds(staffId)).toEqual(kept);
    await repository.transaction((tx) => repository.replaceDepartments(tx, staffId, []));
    expect(await repository.listDepartmentIds(staffId)).toEqual([]);
  });

  it('writes tblstaff_permissions through raw SQL — the only way into a table with no primary key', async () => {
    await repository.transaction((tx) =>
      repository.replacePermissionRows(tx, staffId, [
        { feature: 'staff', capability: 'view' },
        { feature: 'roles', capability: 'view' },
      ]),
    );
    const rows = await repository.listPermissionRows(staffId);
    expect(rows.map((row) => `${row.feature}.${row.capability}`).sort()).toEqual([
      'roles.view',
      'staff.view',
    ]);
  });

  it('replaces the whole permission set, so a removed row is gone', async () => {
    await repository.transaction((tx) =>
      repository.replacePermissionRows(tx, staffId, [{ feature: 'staff', capability: 'view' }]),
    );
    expect(await repository.listPermissionRows(staffId)).toEqual([
      { feature: 'staff', capability: 'view' },
    ]);
    await repository.transaction((tx) => repository.replacePermissionRows(tx, staffId, []));
    expect(await repository.listPermissionRows(staffId)).toEqual([]);
  });

  it('countDepartmentMembers equals a direct distinct count of staffid per department (D-51)', async () => {
    const rows = await service.client.tblstaff_departments.findMany({
      select: { staffid: true, departmentid: true },
    });
    const staffByDepartment = new Map<number, Set<number>>();
    for (const row of rows) {
      const holders = staffByDepartment.get(row.departmentid) ?? new Set<number>();
      holders.add(row.staffid);
      staffByDepartment.set(row.departmentid, holders);
    }
    const ids = [...staffByDepartment.keys(), 2_147_483_000];
    const counted = await Promise.all(ids.map((id) => repository.countDepartmentMembers(id)));
    expect(counted).toEqual(ids.map((id) => staffByDepartment.get(id)?.size ?? 0));
  });

  it('decodes a real tblroles.permissions column into a feature => capability[] map', async () => {
    const page = await repository.listMembers(memberRequest({ limit: '1' }));
    expect(page.items.length).toBeGreaterThan(0);
    const template = await repository.findRoleTemplate(1);
    expect(typeof template).toBe('object');
    for (const capabilities of Object.values(template)) {
      expect(Array.isArray(capabilities)).toBe(true);
    }
  });

  describe('the facade name reads (plan 04.2-12, M13)', () => {
    /** The real client behind a holder that records every `tblstaff.findMany` argument. */
    const findManyArgs: unknown[] = [];
    const recording = new IdentityRepository(
      {
        client: {
          tblstaff: {
            findMany: (args: Parameters<typeof service.client.tblstaff.findMany>[0]) => {
              findManyArgs.push(args);
              return service.client.tblstaff.findMany(args);
            },
          },
        },
      } as unknown as PrismaService,
      new LoggerService(),
    );
    const FOUR_COLUMNS = { staffid: true, firstname: true, lastname: true, active: true };

    it('lists the active members it created by name, selecting four columns and never the password', async () => {
      findManyArgs.length = 0;
      const active = await recording.listActiveStaffNames();
      expect(active).toContainEqual({ staffId, name: 'IntSpec Repository' });
      expect(findManyArgs).toEqual([
        {
          where: { active: 1 },
          orderBy: [{ firstname: 'asc' }, { lastname: 'asc' }, { staffid: 'asc' }],
          select: FOUR_COLUMNS,
        },
      ]);
    });

    it('names the ids it knows whatever their state, selecting the same four columns', async () => {
      findManyArgs.length = 0;
      const names = await recording.staffNamesOf([staffId, 2_000_000_000]);
      expect(names).toEqual([{ staffId, name: 'IntSpec Repository' }]);
      expect(findManyArgs).toEqual([
        { where: { staffid: { in: [staffId, 2_000_000_000] } }, select: FOUR_COLUMNS },
      ]);
    });
  });
});

/**
 * The role half against the real `tblroles` (plan 03.1-11). Every row this block writes it names
 * with `TEST_ROLE_PREFIX` and the outer `afterAll` deletes; no seeded role is touched, and the one
 * seeded row it reads (`findRoleTemplate`) it only reads.
 */
describe.skipIf(!process.env.DATABASE_URL)('IdentityRepository role writes and reads', () => {
  const service = new PrismaService(new AppConfig(), new HealthService());
  const repository = new IdentityRepository(service, new LoggerService());
  const created: number[] = [];

  afterAll(async () => {
    await service.client.tblroles.deleteMany({ where: { roleid: { in: created } } });
    await service.client.$disconnect();
  });

  it('writes tblroles.permissions so it decodes back to exactly what was sent — multi-byte included', async () => {
    const template = { staff: ['view', 'edit'], موظفون: ['view'] };
    const roleId = await repository.transaction((tx) =>
      repository.insertRole(tx, { name: `${TEST_ROLE_PREFIX}-codec`, template }),
    );
    created.push(roleId);
    const row = await repository.findRole(roleId);
    expect(row?.name).toBe(`${TEST_ROLE_PREFIX}-codec`);
    // The stored bytes are Perfex's own serialize() text, byte-counted (s:12 for six characters).
    expect(row?.serializedPermissions).toBe(encodeRolePermissions(template));
    expect(row?.serializedPermissions).toContain('s:12:');
    expect(await repository.findRoleTemplate(roleId)).toEqual(template);
  });

  it('updates the name and the template independently, and each round-trips', async () => {
    const roleId = await repository.transaction((tx) =>
      repository.insertRole(tx, {
        name: `${TEST_ROLE_PREFIX}-update`,
        template: { staff: ['view'] },
      }),
    );
    created.push(roleId);
    await repository.transaction((tx) =>
      repository.updateRole(tx, roleId, { name: `${TEST_ROLE_PREFIX}-update-2` }),
    );
    expect((await repository.findRole(roleId))?.name).toBe(`${TEST_ROLE_PREFIX}-update-2`);
    expect(await repository.findRoleTemplate(roleId)).toEqual({ staff: ['view'] });
    await repository.transaction((tx) =>
      repository.updateRole(tx, roleId, { template: { roles: ['view', 'edit'] } }),
    );
    expect(await repository.findRoleTemplate(roleId)).toEqual({ roles: ['view', 'edit'] });
    expect((await repository.findRole(roleId))?.name).toBe(`${TEST_ROLE_PREFIX}-update-2`);
  });

  it('answers the role id for a name and null for one nobody holds', async () => {
    const roleId = await repository.transaction((tx) =>
      repository.insertRole(tx, { name: `${TEST_ROLE_PREFIX}-name`, template: {} }),
    );
    created.push(roleId);
    expect(await repository.findRoleIdByName(`${TEST_ROLE_PREFIX}-name`)).toBe(roleId);
    expect(await repository.findRoleIdByName(`${TEST_ROLE_PREFIX}-absent`)).toBeNull();
  });

  it('pages the roles list by keyset on roleid, with a member count per row and the total', async () => {
    const page = await repository.listRoles(roleRequest({ limit: '2' }));
    expect(page.items).toHaveLength(2);
    const lastId = page.items[1]?.roleId;
    expect(decodeCursor(page.nextCursor, 'roleId')?.key).toEqual([lastId, lastId]);
    expect(page.total).toBeGreaterThanOrEqual(2);
    for (const row of page.items) expect(row.memberCount).toBeGreaterThanOrEqual(0);
    const next = await repository.listRoles(
      roleRequest({ limit: '2', ...withCursor(page.nextCursor) }),
    );
    expect(next.items[0]?.roleId).toBeGreaterThan(page.items[1]?.roleId ?? 0);
  });

  it('walks every role once by name, limit 3, forward and back, and the count equals total', async () => {
    // Two roles sharing one name, so a page boundary can fall inside a tie on the real collation.
    const insertTie = (): Promise<number> =>
      repository.transaction((tx) =>
        repository.insertRole(tx, { name: `${TEST_ROLE_PREFIX}-walk-tie`, template: {} }),
      );
    const tieIds = [await insertTie(), await insertTie()];
    created.push(...tieIds);
    const { forward, backward, totals } = await walk(
      (cursor) =>
        repository.listRoles(roleRequest({ sort: 'name', limit: '3', ...withCursor(cursor) })),
      (page) => page.items.map((row) => row.roleId),
    );
    expect(new Set(forward).size).toBe(forward.length);
    expect([...totals]).toEqual([forward.length]);
    expect(backward).toEqual(forward);
    expect(forward.filter((id) => tieIds.includes(id))).toEqual(tieIds);
  });

  it('searches the role name through ?q=, case-insensitively, and counts only the matches', async () => {
    const roleId = await repository.transaction((tx) =>
      repository.insertRole(tx, { name: `${TEST_ROLE_PREFIX}-Warehouse-Q`, template: {} }),
    );
    created.push(roleId);
    const page = await repository.listRoles(roleRequest({ q: `${TEST_ROLE_PREFIX}-WAREHOUSE-q` }));
    expect(page.items.map((row) => row.roleId)).toEqual([roleId]);
    expect(page).toMatchObject({ total: 1, rangeStart: 1, nextCursor: null, prevCursor: null });
  });

  it("countRoles (the export's count, plan 03.2-05) equals the list's total for the same q", async () => {
    const roleId = await repository.transaction((tx) =>
      repository.insertRole(tx, { name: `${TEST_ROLE_PREFIX}-count`, template: {} }),
    );
    created.push(roleId);
    for (const input of [{}, { q: `${TEST_ROLE_PREFIX}-COUNT` }]) {
      const page = await repository.listRoles(roleRequest({ ...input, limit: '1' }));
      expect(await repository.countRoles(roleRequest(input)), JSON.stringify(input)).toBe(
        page.total,
      );
    }
    expect(await repository.countRoles(roleRequest({ q: `${TEST_ROLE_PREFIX}-COUNT` }))).toBe(1);
  });

  it('filters the roles list by name and finds only the row it created', async () => {
    const roleId = await repository.transaction((tx) =>
      repository.insertRole(tx, { name: `${TEST_ROLE_PREFIX}-filter`, template: {} }),
    );
    created.push(roleId);
    const page = await repository.listRoles(
      roleRequest({ 'filter[name]': `${TEST_ROLE_PREFIX}-filter` }),
    );
    expect(page.items.map((row) => row.roleId)).toEqual([roleId]);
    expect(page.items[0]?.memberCount).toBe(0);
  });

  it('counts the members of a role, lists them and lists their holder flags', async () => {
    const roleId = await repository.transaction((tx) =>
      repository.insertRole(tx, { name: `${TEST_ROLE_PREFIX}-holders`, template: {} }),
    );
    created.push(roleId);
    expect(await repository.countMembersOfRole(roleId)).toBe(0);
    expect(await repository.listRoleMembers(roleId)).toEqual([]);
    expect(await repository.countMembersByRole([roleId])).toEqual(new Map());
    const holderId = await repository.transaction((tx) =>
      repository.insertMember(tx, {
        email: `${TEST_ROLE_PREFIX}-holder@example.invalid`,
        firstname: 'IntSpec',
        lastname: 'Holder',
        password: 'not-a-real-hash',
        datecreated: new Date(),
        admin: 0,
        active: 1,
        is_not_staff: 0,
        role: roleId,
      }),
    );
    try {
      expect(await repository.countMembersOfRole(roleId)).toBe(1);
      expect((await repository.listRoleMembers(roleId)).map((row) => row.staffId)).toEqual([
        holderId,
      ]);
      expect(await repository.listRoleHolders(roleId)).toEqual([
        { staffId: holderId, isAdmin: false, isNotStaff: false },
      ]);
      expect(await repository.countMembersByRole([roleId])).toEqual(new Map([[roleId, 1]]));
      expect(await repository.countAdministrators()).toBeGreaterThan(0);
    } finally {
      await service.client.tblstaff.deleteMany({ where: { staffid: holderId } });
    }
  });

  /**
   * The staff list's Role column against the real tables. Two facts, both of them the point of the
   * field: the name is on the row for every member who holds a role (so no client-side join against
   * the administrator-only roles list is needed), and the names for a whole page cost ONE
   * `tblroles` read however many rows the page carries — the shape `countMembersByRole` uses.
   */
  it('resolves the page role names in one tblroles read and answers null for an id it no longer holds', async () => {
    const roleId = await repository.transaction((tx) =>
      repository.insertRole(tx, { name: `${TEST_ROLE_PREFIX}-listname`, template: {} }),
    );
    created.push(roleId);
    const insert = (suffix: string, role: number | null): Promise<number> =>
      repository.transaction((tx) =>
        repository.insertMember(tx, {
          email: `${TEST_ROLE_PREFIX}-listname-${suffix}@example.invalid`,
          firstname: 'IntSpec',
          lastname: 'ListName',
          password: 'not-a-real-hash',
          datecreated: new Date(),
          admin: 0,
          active: 1,
          is_not_staff: 0,
          role,
        }),
      );
    // Two members holding the role, one holding none, one holding an id `tblroles` never had.
    const first = await insert('a', roleId);
    const second = await insert('b', roleId);
    const roleless = await insert('c', null);
    const dangling = await insert('d', DANGLING_ROLE_ID);
    const holders = [first, second, roleless, dangling];
    const findMany = vi.spyOn(service.client.tblroles, 'findMany');
    try {
      const page = await repository.listMembers(
        memberRequest({ q: `${TEST_ROLE_PREFIX}-listname` }),
      );
      expect(page.items.map((row) => row.staffId)).toEqual(holders);
      const nameOf = (staffId: number): string | null | undefined =>
        page.items.find((row) => row.staffId === staffId)?.roleName;
      expect(nameOf(first)).toBe(`${TEST_ROLE_PREFIX}-listname`);
      expect(nameOf(second)).toBe(`${TEST_ROLE_PREFIX}-listname`);
      expect(nameOf(roleless)).toBeNull();
      expect(nameOf(dangling)).toBeNull();
      // Four rows, two of them sharing a role and one dangling: ONE read, never one per row.
      expect(findMany).toHaveBeenCalledTimes(1);
    } finally {
      findMany.mockRestore();
      await service.client.tblstaff.deleteMany({ where: { staffid: { in: holders } } });
    }
  });

  it('answers a name per id for the ids it knows and skips the ids it does not', async () => {
    const first = await repository.transaction((tx) =>
      repository.insertRole(tx, { name: `${TEST_ROLE_PREFIX}-names-1`, template: {} }),
    );
    const second = await repository.transaction((tx) =>
      repository.insertRole(tx, { name: `${TEST_ROLE_PREFIX}-names-2`, template: {} }),
    );
    created.push(first, second);
    expect(await repository.findRoleNamesByIds([])).toEqual(new Map());
    expect(await repository.findRoleNamesByIds([first, second, DANGLING_ROLE_ID])).toEqual(
      new Map([
        [first, `${TEST_ROLE_PREFIX}-names-1`],
        [second, `${TEST_ROLE_PREFIX}-names-2`],
      ]),
    );
  });

  it('deletes the role row it created', async () => {
    const roleId = await repository.transaction((tx) =>
      repository.insertRole(tx, { name: `${TEST_ROLE_PREFIX}-delete`, template: {} }),
    );
    await repository.transaction((tx) => repository.deleteRole(tx, roleId));
    expect(await repository.findRole(roleId)).toBeNull();
  });
});
