/**
 * The member save against the real database — the two properties ADR-0034 exists for, proven rather
 * than reviewed (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * **1. The save is ONE transaction.** Profile columns, department rows, permission rows *and the
 * audit row* commit together or not at all. The proof forces a failure **after** the audit append
 * has run inside the transaction and then asserts that NOTHING landed — no profile change, no
 * department row, no permission row and **no audit row** (threat T-3.1-43). Failing after the
 * append is the case that matters: a failure before it would prove only that the audit row was
 * never attempted.
 *
 * **2. Exactly one audit row per granting change**, counted by `request_id`, with a case per change
 * type this plan can produce and the four-row case for a replacement that adds three codes and
 * removes one (ADR-0034 decision 3, threat T-3.1-44).
 *
 * Everything this spec writes it creates itself and deletes again: one staff row on an
 * `@example.invalid` e-mail, its department and permission rows, and the audit rows carrying its
 * own request ids. No seeded row is touched.
 */
import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERMISSIONS } from '@erp/contracts';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { HealthService } from '../../../shared/health/health.service.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { PasswordHasherPort } from '../../../shared/crypto/password-hasher.port.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { runWithRequestContext } from '../../../shared/logger/request-context.js';
import type { DepartmentsFacade } from '../../departments/index.js';
import { FakeDepartmentsFacade } from '../../departments/__tests__/fakes.js';
import { IDENTITY_CHANGE_TYPES } from '../identity.routes.js';
import { IdentityAuditRepository } from '../repository/identity-audit.repository.js';
import { IdentityRepository } from '../repository/identity.repository.js';
import { IdentityEnricher } from '../service/identity.enricher.js';
import { IdentityService } from '../service/identity.service.js';
import { IdentityTransformer } from '../service/identity.transformer.js';
import { IdentityTransport } from '../service/identity.transport.js';
import { IdentityValidator } from '../service/identity.validator.js';

const TEST_EMAIL = 'int-spec-03.1-12-service@example.invalid';
const PASSWORD = 'a-long-enough-password';
const DEPARTMENT_ID = 1;
const SECOND_DEPARTMENT_ID = 2;
const FAR_FUTURE_EXPIRY_S = 4_102_444_800;

/**
 * The departments facade the transport asks about a member's NEW department ids (D-55): it knows
 * the two this spec saves. The save's transaction and its audit row are what this spec proves.
 */
function knownDepartments(): DepartmentsFacade {
  return new FakeDepartmentsFacade([
    { departmentId: DEPARTMENT_ID, name: 'int-spec department one' },
    { departmentId: SECOND_DEPARTMENT_ID, name: 'int-spec department two' },
  ]) as unknown as DepartmentsFacade;
}

const VIEW = PERMISSIONS.staff.members.view;
const EDIT = PERMISSIONS.staff.members.edit;
const ROLES_VIEW = PERMISSIONS.staff.roles.view;
const CONTRACTS_VIEW = PERMISSIONS.sales.contracts.view;

const ADMIN: AuthenticatedUser = {
  staffId: 1,
  sessionId: 'sid-int',
  jti: 'jti-int',
  isAdmin: true,
  roleId: null,
  tokenVersion: 0,
  expiresAt: FAR_FUTURE_EXPIRY_S,
};

class NoopHasher implements PasswordHasherPort {
  hash(password: string): Promise<string> {
    return Promise.resolve(`int-spec-not-a-real-hash:${String(password.length)}`);
  }
}

let requestSeq = 0;
function nextRequestId(): string {
  requestSeq += 1;
  return `int-03.1-12-service-${String(requestSeq)}`;
}

describe.skipIf(!process.env.DATABASE_URL)('IdentityService against the local mirror', () => {
  const prisma = new PrismaService(new AppConfig(), new HealthService());
  const logger = new LoggerService();
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  const repository = new IdentityRepository(prisma, logger);
  const audit = new IdentityAuditRepository(prisma);
  const publisher = new RecordingDomainEventPublisher();
  const service = new IdentityService(
    new IdentityValidator(),
    repository,
    audit,
    new IdentityEnricher(logger),
    new IdentityTransformer(),
    new IdentityTransport(publisher, knownDepartments()),
    new NoopHasher(),
  );

  let staffId = 0;
  let roleId = 0;
  let otherRoleId = 0;

  const countAudit = (requestId: string): Promise<number> =>
    prisma.client.tblidentity_audit.count({ where: { request_id: requestId } });

  const auditRowsFor = (requestId: string) =>
    prisma.client.tblidentity_audit.findMany({
      where: { request_id: requestId },
      orderBy: { id: 'asc' },
    });

  const inRequest = async <T>(requestId: string, run: () => Promise<T>): Promise<T> =>
    runWithRequestContext({ requestId }, run);

  async function removeTestMember(): Promise<void> {
    const rows = await prisma.client.tblstaff.findMany({
      where: { email: TEST_EMAIL },
      select: { staffid: true },
    });
    for (const row of rows) {
      await prisma.client
        .$executeRaw`DELETE FROM tblstaff_permissions WHERE staff_id = ${row.staffid}`;
      await prisma.client.tblstaff_departments.deleteMany({ where: { staffid: row.staffid } });
    }
    await prisma.client.tblstaff.deleteMany({ where: { email: TEST_EMAIL } });
  }

  beforeAll(async () => {
    const roles = await prisma.client.tblroles.findMany({
      select: { roleid: true },
      orderBy: { roleid: 'asc' },
      take: 2,
    });
    roleId = roles[0]?.roleid ?? 1;
    otherRoleId = roles[1]?.roleid ?? roleId + 1;
    await removeTestMember();
  });

  beforeEach(async () => {
    await removeTestMember();
    publisher.drain();
    const requestId = nextRequestId();
    const created = await inRequest(requestId, () =>
      service.createMember(ADMIN, {
        email: TEST_EMAIL,
        firstName: 'IntSpec',
        lastName: 'Service',
        password: PASSWORD,
      }),
    );
    staffId = created.staffId;
    await prisma.client.tblidentity_audit.deleteMany({ where: { request_id: requestId } });
  });

  afterAll(async () => {
    await removeTestMember();
    await prisma.client.tblidentity_audit.deleteMany({
      where: { request_id: { startsWith: 'int-03.1-12-service-' } },
    });
    await prisma.client.$disconnect();
  });

  it('creates the member with no granting field and writes no audit row', async () => {
    expect(staffId).toBeGreaterThan(0);
    const member = await repository.findMemberById(staffId);
    expect(member?.email).toBe(TEST_EMAIL);
    expect(member?.roleId).toBeNull();
    expect(await repository.listPermissionRows(staffId)).toEqual([]);
  });

  it('commits profile, departments, permissions AND the audit row together', async () => {
    const requestId = nextRequestId();
    await inRequest(requestId, () =>
      service.updateMember(
        ADMIN,
        { id: String(staffId) },
        {
          firstName: 'Committed',
          departmentIds: [DEPARTMENT_ID, SECOND_DEPARTMENT_ID],
          roleId,
          permissions: [VIEW],
        },
      ),
    );
    const member = await repository.findMemberById(staffId);
    expect(member?.firstName).toBe('Committed');
    expect(member?.roleId).toBe(roleId);
    expect(await repository.listDepartmentIds(staffId)).toEqual([
      DEPARTMENT_ID,
      SECOND_DEPARTMENT_ID,
    ]);
    expect(await repository.listPermissionRows(staffId)).toEqual([
      { feature: 'staff', capability: 'view' },
    ]);
    // one role change + one permission add
    expect(await countAudit(requestId)).toBe(2);
  });

  it('rolls EVERYTHING back when the save fails after the audit append — no audit row either', async () => {
    const before = await repository.findMemberById(staffId);
    const failure = new Error('forced mid-save failure (int spec)');
    const requestId = nextRequestId();
    const original = audit.append.bind(audit);
    const spy = vi.spyOn(audit, 'append').mockImplementation(async (tx, entries) => {
      // Append for real first, so the rollback has an audit row to undo.
      await original(tx, entries);
      throw failure;
    });

    await expect(
      inRequest(requestId, () =>
        service.updateMember(
          ADMIN,
          { id: String(staffId) },
          {
            firstName: 'NeverLands',
            departmentIds: [DEPARTMENT_ID],
            roleId,
            permissions: [VIEW, EDIT],
          },
        ),
      ),
    ).rejects.toBe(failure);
    spy.mockRestore();

    const after = await repository.findMemberById(staffId);
    expect(after?.firstName).toBe(before?.firstName);
    expect(after?.roleId).toBe(before?.roleId ?? null);
    expect(await repository.listDepartmentIds(staffId)).toEqual([]);
    expect(await repository.listPermissionRows(staffId)).toEqual([]);
    expect(await countAudit(requestId)).toBe(0);
  });

  it('writes exactly ONE row for a role change, naming actor, subject, before and after', async () => {
    const first = nextRequestId();
    await inRequest(first, () => service.updateMember(ADMIN, { id: String(staffId) }, { roleId }));
    expect(await countAudit(first)).toBe(1);

    const second = nextRequestId();
    await inRequest(second, () =>
      service.updateMember(ADMIN, { id: String(staffId) }, { roleId: otherRoleId }),
    );
    expect(await countAudit(second)).toBe(1);
    const [row] = await auditRowsFor(second);
    expect(row).toMatchObject({
      actor_staff_id: ADMIN.staffId,
      subject_staff_id: staffId,
      subject_role_id: null,
      change_type: IDENTITY_CHANGE_TYPES.memberRoleChanged,
      permission_code: null,
      before_value: String(roleId),
      after_value: String(otherRoleId),
      request_id: second,
    });
  });

  it('writes exactly ONE row for an admin-flag change', async () => {
    const requestId = nextRequestId();
    await inRequest(requestId, () =>
      service.updateMember(ADMIN, { id: String(staffId) }, { admin: true }),
    );
    expect(await countAudit(requestId)).toBe(1);
    const [row] = await auditRowsFor(requestId);
    expect(row).toMatchObject({
      change_type: IDENTITY_CHANGE_TYPES.memberAdminChanged,
      permission_code: null,
      before_value: '0',
      after_value: '1',
    });
  });

  it('writes exactly ONE row for a permission add and ONE for a permission remove', async () => {
    const added = nextRequestId();
    await inRequest(added, () =>
      service.updateMember(ADMIN, { id: String(staffId) }, { permissions: [VIEW] }),
    );
    expect(await countAudit(added)).toBe(1);
    const [addedRow] = await auditRowsFor(added);
    expect(addedRow).toMatchObject({
      change_type: IDENTITY_CHANGE_TYPES.memberPermissionAdded,
      permission_code: VIEW,
      before_value: null,
      after_value: VIEW,
    });

    const removed = nextRequestId();
    await inRequest(removed, () =>
      service.updateMember(ADMIN, { id: String(staffId) }, { permissions: [] }),
    );
    expect(await countAudit(removed)).toBe(1);
    const [removedRow] = await auditRowsFor(removed);
    expect(removedRow).toMatchObject({
      change_type: IDENTITY_CHANGE_TYPES.memberPermissionRemoved,
      permission_code: VIEW,
      before_value: VIEW,
      after_value: null,
    });
    expect(await repository.listPermissionRows(staffId)).toEqual([]);
  });

  it('writes FOUR rows sharing one request id for a replacement that adds three and removes one', async () => {
    const seed = nextRequestId();
    await inRequest(seed, () =>
      service.updateMember(ADMIN, { id: String(staffId) }, { permissions: [VIEW] }),
    );
    const requestId = nextRequestId();
    await inRequest(requestId, () =>
      service.updateMember(
        ADMIN,
        { id: String(staffId) },
        { permissions: [EDIT, ROLES_VIEW, CONTRACTS_VIEW] },
      ),
    );
    expect(await countAudit(requestId)).toBe(4);
    const rows = await auditRowsFor(requestId);
    expect(
      rows.filter((row) => row.change_type === IDENTITY_CHANGE_TYPES.memberPermissionAdded),
    ).toHaveLength(3);
    expect(
      rows.filter((row) => row.change_type === IDENTITY_CHANGE_TYPES.memberPermissionRemoved),
    ).toHaveLength(1);
    expect(new Set(rows.map((row) => row.request_id))).toEqual(new Set([requestId]));
  });

  it('refuses a non-administrator on every granting field, and writes nothing', async () => {
    const nonAdmin: AuthenticatedUser = { ...ADMIN, staffId: 2, isAdmin: false };
    const requestId = nextRequestId();
    for (const granting of [{ roleId }, { permissions: [VIEW] }, { admin: true }]) {
      await expect(
        inRequest(requestId, () =>
          service.updateMember(nonAdmin, { id: String(staffId) }, granting),
        ),
      ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0001', status: 403 });
    }
    expect(await countAudit(requestId)).toBe(0);
    expect(await repository.listPermissionRows(staffId)).toEqual([]);
    expect((await repository.findMemberById(staffId))?.roleId).toBeNull();
  });

  it('refuses an unknown clean permission name and writes no row of any kind', async () => {
    const requestId = nextRequestId();
    await expect(
      inRequest(requestId, () =>
        service.updateMember(ADMIN, { id: String(staffId) }, { permissions: ['not.a.code'] }),
      ),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0003', status: 422 });
    expect(await countAudit(requestId)).toBe(0);
    expect(await repository.listPermissionRows(staffId)).toEqual([]);
  });

  /**
   * Quick task 260925-rvw (review WR-03, WR-04, WR-12). The audit entries and the gate are derived
   * from the rows that are PERSISTED, compared with the rows that are STORED — never from the
   * request body. Every case reads `tblstaff_permissions` and `tblidentity_audit` back from the
   * real database, because the claim is about what landed.
   */
  describe('the audit records what was persisted (260925-rvw)', () => {
    const NON_ADMIN: AuthenticatedUser = { ...ADMIN, staffId: 2, isAdmin: false };
    const LEADS_VIEW = PERMISSIONS.crm.leads.view;
    /** A Perfex row no clean name maps: a retired module's feature, as Perfex leaves them behind. */
    const UNMAPPED = { feature: 'rvw_retired_module', capability: 'view' } as const;
    const STAFF_VIEW_ROW = { feature: 'staff', capability: 'view' } as const;

    const seedRows = (rows: readonly { feature: string; capability: string }[]): Promise<void> =>
      repository.transaction((tx) => repository.replacePermissionRows(tx, staffId, rows));

    const storedKeys = async (): Promise<string[]> =>
      (await repository.listPermissionRows(staffId))
        .map((row) => `${row.feature}.${row.capability}`)
        .sort();

    it('WR-04: promoting with permissions writes the admin row and NO permission.added row', async () => {
      const requestId = nextRequestId();
      await inRequest(requestId, () =>
        service.updateMember(
          ADMIN,
          { id: String(staffId) },
          { admin: true, permissions: [VIEW, EDIT, ROLES_VIEW] },
        ),
      );
      expect(await storedKeys()).toEqual([]);
      const rows = await auditRowsFor(requestId);
      expect(rows.map((row) => row.change_type)).toEqual([
        IDENTITY_CHANGE_TYPES.memberAdminChanged,
      ]);
    });

    it('WR-04: a leads code sent for an is_not_staff member writes no permission row and no audit row', async () => {
      await inRequest(nextRequestId(), () =>
        service.updateMember(ADMIN, { id: String(staffId) }, { isNotStaff: true }),
      );
      for (let save = 0; save < 2; save += 1) {
        const requestId = nextRequestId();
        await inRequest(requestId, () =>
          service.updateMember(ADMIN, { id: String(staffId) }, { permissions: [LEADS_VIEW] }),
        );
        expect(await storedKeys()).toEqual([]);
        expect(await countAudit(requestId)).toBe(0);
      }
    });

    it('WR-03: a non-administrator sending the current set back deletes nothing, unmapped rows included', async () => {
      await seedRows([STAFF_VIEW_ROW, UNMAPPED]);
      const requestId = nextRequestId();
      await inRequest(requestId, () =>
        service.updateMember(
          NON_ADMIN,
          { id: String(staffId) },
          { firstName: 'ProfileOnly', permissions: [VIEW] },
        ),
      );
      expect(await storedKeys()).toEqual(['rvw_retired_module.view', 'staff.view']);
      expect(await countAudit(requestId)).toBe(0);
    });

    it('WR-03: an administrator changing the clean set carries the unmapped row through untouched', async () => {
      await seedRows([STAFF_VIEW_ROW, UNMAPPED]);
      const requestId = nextRequestId();
      await inRequest(requestId, () =>
        service.updateMember(ADMIN, { id: String(staffId) }, { permissions: [EDIT] }),
      );
      expect(await storedKeys()).toEqual(['rvw_retired_module.view', 'staff.edit']);
      const rows = await auditRowsFor(requestId);
      expect(rows.map((row) => [row.change_type, row.permission_code])).toEqual([
        [IDENTITY_CHANGE_TYPES.memberPermissionAdded, EDIT],
        [IDENTITY_CHANGE_TYPES.memberPermissionRemoved, VIEW],
      ]);
    });

    it('WR-03: a save that would remove a stored leads row passes the gate — a non-administrator is refused and nothing lands', async () => {
      await seedRows([STAFF_VIEW_ROW, { feature: 'leads', capability: 'view' }]);
      const requestId = nextRequestId();
      await expect(
        inRequest(requestId, () =>
          service.updateMember(
            NON_ADMIN,
            { id: String(staffId) },
            { isNotStaff: true, permissions: [VIEW, LEADS_VIEW] },
          ),
        ),
      ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0001', status: 403 });
      expect(await storedKeys()).toEqual(['leads.view', 'staff.view']);
      expect(await countAudit(requestId)).toBe(0);
    });

    it('WR-12: promotion clears every stored row in the same save and audits each removal, the unmapped one included', async () => {
      await seedRows([STAFF_VIEW_ROW, UNMAPPED]);
      const promoted = nextRequestId();
      await inRequest(promoted, () =>
        service.updateMember(ADMIN, { id: String(staffId) }, { admin: true }),
      );
      expect(await storedKeys()).toEqual([]);
      const rows = await auditRowsFor(promoted);
      expect(rows.map((row) => [row.change_type, row.permission_code, row.before_value])).toEqual([
        [IDENTITY_CHANGE_TYPES.memberAdminChanged, null, '0'],
        [
          IDENTITY_CHANGE_TYPES.memberPermissionRemoved,
          'rvw_retired_module:view',
          'rvw_retired_module:view',
        ],
        [IDENTITY_CHANGE_TYPES.memberPermissionRemoved, VIEW, VIEW],
      ]);

      const demoted = nextRequestId();
      await inRequest(demoted, () =>
        service.updateMember(ADMIN, { id: String(staffId) }, { admin: false }),
      );
      expect(await storedKeys()).toEqual([]);
      expect((await auditRowsFor(demoted)).map((row) => row.change_type)).toEqual([
        IDENTITY_CHANGE_TYPES.memberAdminChanged,
      ]);
    });
  });
});

/**
 * The role half against the real database (plan 03.1-11) — the same two properties, on the writes
 * that hand access to every holder at once.
 *
 * **1. `applyToMembers` is ONE transaction** with the role row, every holder's permission rows and
 * every audit row. The proof forces a failure after the audit append has run inside the transaction
 * and asserts that nothing landed: not the role's new name, not the holder's rows, not one audit row.
 *
 * **2. The audit fan-out is exact:** a create, an update and a delete write one row each; an
 * `applyToMembers` over N members changing M codes writes 1 + N×M rows, all sharing one
 * `x-request-id`.
 *
 * Every row this block writes it creates and deletes: roles named with `ROLE_PREFIX`, two staff rows
 * on `@example.invalid` e-mails, their permission rows, and the audit rows carrying its request ids.
 */
const ROLE_PREFIX = 'int-spec-03.1-11-svc-role';
const HOLDER_PREFIX = 'int-spec-03.1-11-holder';

describe.skipIf(!process.env.DATABASE_URL)(
  'IdentityService role writes against the local mirror',
  () => {
    const prisma = new PrismaService(new AppConfig(), new HealthService());
    const logger = new LoggerService();
    vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
    const repository = new IdentityRepository(prisma, logger);
    const audit = new IdentityAuditRepository(prisma);
    const publisher = new RecordingDomainEventPublisher();
    const service = new IdentityService(
      new IdentityValidator(),
      repository,
      audit,
      new IdentityEnricher(logger),
      new IdentityTransformer(),
      new IdentityTransport(publisher, knownDepartments()),
      new NoopHasher(),
    );

    let roleId = 0;
    const holderIds: number[] = [];

    const countAudit = (requestId: string): Promise<number> =>
      prisma.client.tblidentity_audit.count({ where: { request_id: requestId } });

    const auditRows = (requestId: string) =>
      prisma.client.tblidentity_audit.findMany({
        where: { request_id: requestId },
        orderBy: { id: 'asc' },
      });

    async function cleanUp(): Promise<void> {
      const staff = await prisma.client.tblstaff.findMany({
        where: { email: { startsWith: HOLDER_PREFIX } },
        select: { staffid: true },
      });
      for (const row of staff) {
        await prisma.client
          .$executeRaw`DELETE FROM tblstaff_permissions WHERE staff_id = ${row.staffid}`;
      }
      await prisma.client.tblstaff.deleteMany({ where: { email: { startsWith: HOLDER_PREFIX } } });
      await prisma.client.tblroles.deleteMany({ where: { name: { startsWith: ROLE_PREFIX } } });
      await prisma.client.tblidentity_audit.deleteMany({
        where: { request_id: { startsWith: 'int-03.1-11-role-' } },
      });
    }

    /** Two non-admin holders of the role, each already carrying `staff.members.view`. */
    async function seedHolders(count: number): Promise<void> {
      for (let index = 0; index < count; index += 1) {
        const staffId = await repository.transaction((tx) =>
          repository.insertMember(tx, {
            email: `${HOLDER_PREFIX}-${String(index)}@example.invalid`,
            firstname: 'IntSpec',
            lastname: `Holder${String(index)}`,
            password: 'not-a-real-hash',
            datecreated: new Date(),
            admin: 0,
            active: 1,
            is_not_staff: 0,
            role: roleId,
          }),
        );
        await repository.transaction((tx) =>
          repository.replacePermissionRows(tx, staffId, [{ feature: 'staff', capability: 'view' }]),
        );
        holderIds.push(staffId);
      }
    }

    let roleSeq = 0;
    const nextRoleRequestId = (): string => {
      roleSeq += 1;
      return `int-03.1-11-role-${String(roleSeq)}`;
    };

    beforeEach(async () => {
      holderIds.length = 0;
      await cleanUp();
      publisher.drain();
      const requestId = nextRoleRequestId();
      const created = await runWithRequestContext({ requestId }, () =>
        service.createRole(ADMIN, { name: `${ROLE_PREFIX}-base`, permissions: [VIEW] }),
      );
      roleId = created.roleId;
      await prisma.client.tblidentity_audit.deleteMany({ where: { request_id: requestId } });
      publisher.drain();
    });

    afterAll(async () => {
      await cleanUp();
      await prisma.client.$disconnect();
    });

    it('a create writes exactly ONE role.created row naming the role, not a member', async () => {
      const requestId = nextRoleRequestId();
      const created = await runWithRequestContext({ requestId }, () =>
        service.createRole(ADMIN, {
          name: `${ROLE_PREFIX}-created`,
          permissions: [VIEW, ROLES_VIEW],
        }),
      );
      expect(await countAudit(requestId)).toBe(1);
      const [row] = await auditRows(requestId);
      expect(row?.change_type).toBe(IDENTITY_CHANGE_TYPES.roleCreated);
      expect(row?.subject_role_id).toBe(created.roleId);
      expect(row?.subject_staff_id).toBeNull();
      expect(row?.before_value).toBeNull();
      expect(row?.permission_code).toBeNull();
      expect(publisher.drain().map((event) => event.name)).toEqual(['identity.role.created']);
    });

    it('an update without applyToMembers writes exactly ONE role.updated row', async () => {
      const requestId = nextRoleRequestId();
      await runWithRequestContext({ requestId }, () =>
        service.updateRole(ADMIN, { id: String(roleId) }, { permissions: [CONTRACTS_VIEW] }),
      );
      expect(await countAudit(requestId)).toBe(1);
      const [row] = await auditRows(requestId);
      expect(row?.change_type).toBe(IDENTITY_CHANGE_TYPES.roleUpdated);
      expect(row?.subject_role_id).toBe(roleId);
      // The template round-trips: what Perfex reads is what the request sent.
      expect(await repository.findRoleTemplate(roleId)).toEqual({ contracts: ['view'] });
    });

    it('a delete of an unreferenced role writes exactly ONE role.deleted row', async () => {
      const requestId = nextRoleRequestId();
      await runWithRequestContext({ requestId }, () =>
        service.deleteRole(ADMIN, { id: String(roleId) }),
      );
      expect(await countAudit(requestId)).toBe(1);
      const [row] = await auditRows(requestId);
      expect(row?.change_type).toBe(IDENTITY_CHANGE_TYPES.roleDeleted);
      expect(row?.after_value).toBeNull();
      expect(await repository.findRole(roleId)).toBeNull();
    });

    it('refuses to delete a referenced role and writes nothing', async () => {
      await seedHolders(1);
      const requestId = nextRoleRequestId();
      await expect(
        runWithRequestContext({ requestId }, () =>
          service.deleteRole(ADMIN, { id: String(roleId) }),
        ),
      ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0006' });
      expect(await repository.findRole(roleId)).not.toBeNull();
      expect(await countAudit(requestId)).toBe(0);
    });

    it('applyToMembers over N members changing M codes writes 1 + N×M rows on one request id', async () => {
      const members = 2;
      await seedHolders(members);
      const requestId = nextRoleRequestId();
      // Each holder currently has staff.members.view; the new template adds two and removes that one.
      await runWithRequestContext({ requestId }, () =>
        service.updateRole(
          ADMIN,
          { id: String(roleId) },
          { permissions: [EDIT, ROLES_VIEW], applyToMembers: true },
        ),
      );
      const codesMoved = 3;
      expect(await countAudit(requestId)).toBe(1 + members * codesMoved);
      const rows = await auditRows(requestId);
      expect(rows.filter((row) => row.subject_role_id !== null)).toHaveLength(1);
      for (const holderId of holderIds) {
        expect(rows.filter((row) => row.subject_staff_id === holderId)).toHaveLength(codesMoved);
        expect(await repository.listPermissionRows(holderId)).toEqual([
          { feature: 'staff', capability: 'edit' },
          { feature: 'roles', capability: 'view' },
        ]);
      }
      expect(new Set(rows.map((row) => row.request_id))).toEqual(new Set([requestId]));
      expect(publisher.drain().map((event) => event.name)).toEqual([
        'identity.role.updated',
        'identity.permissions.replaced',
        'identity.permissions.replaced',
      ]);
    });

    it('rolls EVERYTHING back when the apply fails after the audit append — no audit row either', async () => {
      await seedHolders(2);
      const failure = new Error('forced mid-apply failure (int spec)');
      const requestId = nextRoleRequestId();
      const original = audit.append.bind(audit);
      const spy = vi.spyOn(audit, 'append').mockImplementation(async (tx, entries) => {
        // Append for real first, so the rollback has audit rows to undo.
        await original(tx, entries);
        throw failure;
      });
      try {
        await expect(
          runWithRequestContext({ requestId }, () =>
            service.updateRole(
              ADMIN,
              { id: String(roleId) },
              { name: `${ROLE_PREFIX}-never`, permissions: [EDIT], applyToMembers: true },
            ),
          ),
        ).rejects.toBe(failure);
      } finally {
        spy.mockRestore();
      }
      expect((await repository.findRole(roleId))?.name).toBe(`${ROLE_PREFIX}-base`);
      expect(await repository.findRoleTemplate(roleId)).toEqual({ staff: ['view'] });
      for (const holderId of holderIds) {
        expect(await repository.listPermissionRows(holderId)).toEqual([
          { feature: 'staff', capability: 'view' },
        ]);
      }
      expect(await countAudit(requestId)).toBe(0);
    });

    it('a non-admin is refused every role write and leaves no row of any kind', async () => {
      const nonAdmin: AuthenticatedUser = { ...ADMIN, staffId: 2, isAdmin: false };
      const runs: (() => Promise<unknown>)[] = [
        () => service.createRole(nonAdmin, { name: `${ROLE_PREFIX}-nope`, permissions: [] }),
        () => service.updateRole(nonAdmin, { id: String(roleId) }, { name: `${ROLE_PREFIX}-nope` }),
        () => service.deleteRole(nonAdmin, { id: String(roleId) }),
      ];
      for (const run of runs) {
        const requestId = nextRoleRequestId();
        await expect(runWithRequestContext({ requestId }, run)).rejects.toMatchObject({
          code: 'ERP-IDENTITY-0001',
        });
        expect(await countAudit(requestId)).toBe(0);
      }
      expect((await repository.findRole(roleId))?.name).toBe(`${ROLE_PREFIX}-base`);
      expect(await prisma.client.tblroles.count({ where: { name: `${ROLE_PREFIX}-nope` } })).toBe(
        0,
      );
    });
  },
);
