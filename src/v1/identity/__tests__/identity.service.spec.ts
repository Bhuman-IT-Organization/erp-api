/**
 * IdentityService over the fakes: the two reads, the member add and edit of brief §3, the
 * administrator-only granting gate of ADR-0034 decision 2, the audit rows of decision 3, and the
 * administrator-only rules of brief §5 that are not grants.
 *
 * The transaction and the "nothing landed" proof are the int spec's — a fake cannot roll back. What
 * this spec proves is the ORDER and the CONTENT: the gate refuses before any write happens, and the
 * audit entries are exactly the granting changes the gate saw, sharing one `x-request-id`.
 */
import { describe, expect, it, vi } from 'vitest';
import { PERMISSION_CODES, PERMISSIONS } from '@erp/contracts';
import { AppError } from '../../../shared/errors/app-error.js';
import { CSV_BOM, EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportFile } from '../../../shared/http/export.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { PasswordHasherPort } from '../../../shared/crypto/password-hasher.port.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
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
import {
  FakeIdentityAuditRepository,
  FakeIdentityRepository,
  SEED_MEMBERS,
  SEED_PICKER_DEPARTMENTS,
  member,
} from './fakes.js';

const REQUEST_ID = 'req-03.1-12';
const FAR_FUTURE_EXPIRY_S = 4_102_444_800;
const NOW_MS = 1_790_000_000_000;

const VIEW = PERMISSIONS.staff.members.view;
const EDIT = PERMISSIONS.staff.members.edit;
const ROLES_VIEW = PERMISSIONS.staff.roles.view;
const CONTRACTS_VIEW = PERMISSIONS.sales.contracts.view;
const LEADS_VIEW = PERMISSIONS.crm.leads.view;

function actorOf(staffId: number, isAdmin: boolean): AuthenticatedUser {
  return {
    staffId,
    sessionId: `sid-${String(staffId)}`,
    jti: `jti-${String(staffId)}`,
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: FAR_FUTURE_EXPIRY_S,
  };
}

const ADMIN = actorOf(1, true);
const EDITOR = actorOf(3, false);

class FakeHasher implements PasswordHasherPort {
  readonly calls: string[] = [];
  hash(password: string): Promise<string> {
    this.calls.push(password);
    return Promise.resolve(`hashed:${password}`);
  }
}

interface Harness {
  readonly service: IdentityService;
  readonly repo: FakeIdentityRepository;
  readonly audit: FakeIdentityAuditRepository;
  readonly publisher: RecordingDomainEventPublisher;
  readonly hasher: FakeHasher;
  /** The departments facade the transport reads (D-55): ids 1, 2 and 3 known. */
  readonly departments: FakeDepartmentsFacade;
}

function build(): Harness {
  return buildWith(new FakeIdentityRepository());
}

/** `build()` over a repository a spec seeded itself (the export's batch case needs 1,200 rows). */
function buildWith(repo: FakeIdentityRepository): Harness {
  const audit = new FakeIdentityAuditRepository();
  const publisher = new RecordingDomainEventPublisher();
  const hasher = new FakeHasher();
  const departments = new FakeDepartmentsFacade(SEED_PICKER_DEPARTMENTS);
  const logger = new LoggerService();
  vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
  const service = new IdentityService(
    new IdentityValidator(),
    repo as unknown as IdentityRepository,
    audit as unknown as IdentityAuditRepository,
    new IdentityEnricher(logger),
    new IdentityTransformer(),
    new IdentityTransport(publisher, departments as unknown as DepartmentsFacade),
    hasher,
  );
  service.now = () => NOW_MS;
  return { service, repo, audit, publisher, hasher, departments };
}

/** Every granting save runs inside a request scope: the audit row carries the request's lineage. */
function inRequest<T>(run: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ requestId: REQUEST_ID }, run);
}

const NEW_MEMBER = {
  email: 'new-member@example.invalid',
  firstName: 'New',
  lastName: 'Member',
  password: 'a-long-enough-password',
};

describe('IdentityService.listMembers', () => {
  it('answers the BE-19 envelope with every seeded member', async () => {
    const { service } = build();
    const response = await service.listMembers({});
    expect(response.data.map((row) => row.staffId)).toEqual(SEED_MEMBERS.map((m) => m.staffId));
    expect(response.meta).toEqual({
      nextCursor: null,
      prevCursor: null,
      total: SEED_MEMBERS.length,
      rangeStart: 1,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });

  it('pages by keyset and answers the last row as the next cursor, and the first as the previous', async () => {
    const { service } = build();
    const first = await service.listMembers({ limit: '2' });
    expect(first.data.map((row) => row.staffId)).toEqual([1, 2]);
    expect(decodeCursor(first.meta.nextCursor, 'staffId')).toEqual({
      sort: 'staffId',
      key: [2, 2],
      direction: 'after',
    });
    const second = await service.listMembers({ limit: '2', cursor: first.meta.nextCursor });
    expect(second.data.map((row) => row.staffId)).toEqual([3, 4]);
    expect(second.meta.nextCursor).toBeNull();
    expect(second.meta.rangeStart).toBe(3);
    expect(decodeCursor(second.meta.prevCursor, 'staffId')).toEqual({
      sort: 'staffId',
      key: [3, 3],
      direction: 'before',
    });
  });

  it('sorts on email, firstName and active, and pages each by (value, staffId)', async () => {
    const { service } = build();
    const byName = await service.listMembers({ sort: '-firstName', limit: '2' });
    expect(byName.data.map((row) => row.staffId)).toEqual([4, 3]);
    expect(decodeCursor(byName.meta.nextCursor, 'firstName')?.key).toEqual(['Seed3', 3]);
    // active: the inactive member (0) first ascending, then the three active ones by id.
    const byActive = await service.listMembers({ sort: 'active', limit: '2' });
    expect(byActive.data.map((row) => row.staffId)).toEqual([3, 1]);
    const next = await service.listMembers({
      sort: 'active',
      limit: '2',
      cursor: byActive.meta.nextCursor,
    });
    expect(next.data.map((row) => row.staffId)).toEqual([2, 4]);
    expect(next.meta.rangeStart).toBe(3);
  });

  it('applies filter[active] and the ?q= search box', async () => {
    const { service } = build();
    const inactive = await service.listMembers({ 'filter[active]': '0' });
    expect(inactive.data.map((row) => row.staffId)).toEqual([3]);
    const searched = await service.listMembers({ q: 'Seed4' });
    expect(searched.data.map((row) => row.staffId)).toEqual([4]);
  });

  it('refuses an offset paging key rather than ignoring it', async () => {
    const { service } = build();
    await expect(service.listMembers({ page: '2' })).rejects.toBeInstanceOf(AppError);
  });

  /**
   * The Role column of `tables/staff.php` travels on the row. It used to be a client-side join
   * against `GET roles`, which is administrator-only — so for a non-administrator the column was an
   * em dash. The name is the list's own field now, and `null` only ever means
   * "no role" or "an id `tblroles` no longer holds", never "you may not read the roles list".
   */
  it('carries the role name on every listed member that holds a role, and null for none', async () => {
    const { service } = build();
    const rows = (await service.listMembers({})).data;
    expect(rows.find((row) => row.staffId === 2)?.roleName).toBe('Seed role A');
    expect(rows.find((row) => row.staffId === 4)?.roleName).toBe('Seed role B');
    const roleless = rows.find((row) => row.staffId === 3);
    expect(roleless?.roleId).toBeNull();
    expect(roleless?.roleName).toBeNull();
  });

  it('answers null rather than an error for a role id tblroles no longer holds', async () => {
    const { service, repo } = build();
    const index = repo.members.findIndex((row) => row.staffId === 2);
    const member = repo.members[index];
    if (member === undefined) throw new Error('seed member missing');
    // `tblstaff.role` has no foreign key (SF-7), so a dangling id is a state the list must survive.
    repo.members[index] = { ...member, roleId: 4242 };
    const row = (await service.listMembers({})).data.find((entry) => entry.staffId === 2);
    expect(row?.roleId).toBe(4242);
    expect(row?.roleName).toBeNull();
  });
});

describe('IdentityService.getMember', () => {
  it('answers the member with its departments, role name and clean permission names', async () => {
    const { service } = build();
    const member = await service.getMember({ id: '2' });
    expect(member.staffId).toBe(2);
    expect(member.departmentIds).toEqual([2]);
    expect(member.roleName).toBe('Seed role A');
    // The seeded rows include one Perfex pair the mapping does not know; it is dropped, not shown.
    expect(member.permissions).toEqual(['sales.invoices.view', 'staff.members.view']);
  });

  it('answers 404 ERP-IDENTITY-0005 for an id that is not a member', async () => {
    const { service } = build();
    await expect(service.getMember({ id: '9999' })).rejects.toMatchObject({
      code: 'ERP-IDENTITY-0005',
      status: 404,
    });
  });
});

describe('IdentityService.createMember — the granting gate (ADR-0034 d.2)', () => {
  it('lets a non-administrator create a member with no role, no permissions and no admin flag', async () => {
    const { service, audit, hasher } = build();
    const created = await inRequest(() => service.createMember(EDITOR, { ...NEW_MEMBER }));
    expect(created.email).toBe(NEW_MEMBER.email);
    expect(created.isAdmin).toBe(false);
    expect(hasher.calls).toEqual([NEW_MEMBER.password]);
    // Nothing was granted, so nothing is audited.
    expect(audit.appended).toEqual([]);
  });

  it.each([
    ['roleId', { roleId: 10 }],
    ['permissions', { permissions: [VIEW] }],
    ['admin', { admin: true }],
  ])(
    'refuses a non-administrator carrying %s with 403 ERP-IDENTITY-0001, before any write',
    async (_field, granting) => {
      const { service, repo, audit } = build();
      const membersBefore = repo.members.length;
      await expect(
        inRequest(() => service.createMember(EDITOR, { ...NEW_MEMBER, ...granting })),
      ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0001', status: 403 });
      expect(repo.members).toHaveLength(membersBefore);
      expect(audit.appended).toEqual([]);
    },
  );

  it('lets an administrator create a member with a role and permissions, and audits each change', async () => {
    const { service, audit, repo } = build();
    await inRequest(() =>
      service.createMember(ADMIN, { ...NEW_MEMBER, roleId: 10, permissions: [VIEW, EDIT] }),
    );
    expect(audit.appended.map((entry) => entry.changeType)).toEqual([
      IDENTITY_CHANGE_TYPES.memberRoleChanged,
      IDENTITY_CHANGE_TYPES.memberPermissionAdded,
      IDENTITY_CHANGE_TYPES.memberPermissionAdded,
    ]);
    expect(audit.appended.every((entry) => entry.requestId === REQUEST_ID)).toBe(true);
    expect(audit.appended.every((entry) => entry.actorStaffId === ADMIN.staffId)).toBe(true);
    expect(
      repo.permissionWrites.at(-1)?.rows.map((row) => `${row.feature}.${row.capability}`),
    ).toEqual(['staff.view', 'staff.edit']);
  });

  it('refuses a duplicate e-mail with 409 ERP-IDENTITY-0002', async () => {
    const { service } = build();
    const existing = SEED_MEMBERS[1];
    if (existing === undefined) throw new Error('seed member missing');
    await expect(
      inRequest(() => service.createMember(ADMIN, { ...NEW_MEMBER, email: existing.email })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0002', status: 409 });
  });

  it('refuses an unknown clean permission name with 422 ERP-IDENTITY-0003 rather than inventing a row', async () => {
    const { service, repo } = build();
    const writesBefore = repo.permissionWrites.length;
    await expect(
      inRequest(() => service.createMember(ADMIN, { ...NEW_MEMBER, permissions: ['not.a.code'] })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0003', status: 422 });
    expect(repo.permissionWrites).toHaveLength(writesBefore);
  });

  /**
   * SF-7 (CR review). `tblroles` has no foreign key and the DTO allows any positive integer, so an
   * unchecked `roleId` wrote the dangling `tblstaff.role` that `DELETE /roles/:id` answers 409 to
   * prevent. `ERP-IDENTITY-0008` is the code the route already declares for "no such role".
   */
  it('refuses a roleId that is not a role with 404 ERP-IDENTITY-0008, before any write (SF-7)', async () => {
    const { service, repo, audit } = build();
    const membersBefore = repo.members.length;
    await expect(
      inRequest(() => service.createMember(ADMIN, { ...NEW_MEMBER, roleId: 9999 })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0008', status: 404 });
    expect(repo.members).toHaveLength(membersBefore);
    expect(audit.appended).toEqual([]);
  });

  /**
   * The other side of SF-7: the check refuses only ids that are not roles. A seeded role id and an
   * explicit `null` (the "no role" value, which needs no lookup) both still create the member.
   * `roleId` is not asserted on the response because the fake repository's `insertMember` records
   * only the three name columns — the written `role` column is covered by the repository int spec.
   */
  it.each([
    ['a seeded role id', 10],
    ['an explicit null', null],
  ])('creates the member for %s (SF-7 refuses only ids that are not roles)', async (_case, id) => {
    const { service } = build();
    await expect(
      inRequest(() => service.createMember(ADMIN, { ...NEW_MEMBER, roleId: id })),
    ).resolves.toMatchObject({ email: NEW_MEMBER.email });
  });

  it('stores NO permission rows for an administrator (Perfex: the flag implies everything)', async () => {
    const { service, repo } = build();
    await inRequest(() =>
      service.createMember(ADMIN, { ...NEW_MEMBER, admin: true, permissions: [VIEW, EDIT] }),
    );
    expect(repo.permissionWrites).toEqual([]);
  });

  /**
   * Quick task 260925-rvw (review WR-04), the create half. The audit is the record of what was
   * written (ADR-0034 d.3), so a code that is sent but not stored — every code for an
   * administrator, the `leads` feature for an is_not_staff member — is never audited as added.
   */
  it('audits only what was stored: no permission.added row for an administrator or for leads on is_not_staff (WR-04)', async () => {
    const { service, audit } = build();
    await inRequest(() =>
      service.createMember(ADMIN, { ...NEW_MEMBER, admin: true, permissions: [VIEW, EDIT] }),
    );
    expect(audit.appended.map((entry) => entry.changeType)).toEqual([
      IDENTITY_CHANGE_TYPES.memberAdminChanged,
    ]);

    audit.appended.length = 0;
    await inRequest(() =>
      service.createMember(ADMIN, {
        ...NEW_MEMBER,
        email: 'rvw-not-staff@example.invalid',
        isNotStaff: true,
        permissions: [VIEW, LEADS_VIEW],
      }),
    );
    expect(audit.appended.map((entry) => entry.permissionCode)).toEqual([VIEW]);
  });

  it('skips the leads feature for an is_not_staff member, and keeps it for a staff member', async () => {
    const { service, repo } = build();
    await inRequest(() =>
      service.createMember(ADMIN, {
        ...NEW_MEMBER,
        isNotStaff: true,
        permissions: [VIEW, LEADS_VIEW],
      }),
    );
    expect(repo.permissionWrites.at(-1)?.rows.map((row) => row.feature)).toEqual(['staff']);

    await inRequest(() =>
      service.createMember(ADMIN, {
        ...NEW_MEMBER,
        email: 'second-new@example.invalid',
        permissions: [VIEW, LEADS_VIEW],
      }),
    );
    expect(
      repo.permissionWrites
        .at(-1)
        ?.rows.map((row) => row.feature)
        .sort(),
    ).toEqual(['leads', 'staff']);
  });

  it('publishes identity.member.created, and permissions.replaced only when permissions were sent', async () => {
    const { service, publisher } = build();
    await inRequest(() => service.createMember(EDITOR, { ...NEW_MEMBER }));
    expect(publisher.drain().map((event) => event.name)).toEqual(['identity.member.created']);
    await inRequest(() =>
      service.createMember(ADMIN, {
        ...NEW_MEMBER,
        email: 'third-new@example.invalid',
        permissions: [VIEW],
      }),
    );
    expect(publisher.drain().map((event) => event.name)).toEqual([
      'identity.member.created',
      'identity.permissions.replaced',
    ]);
  });
});

describe('IdentityService.updateMember — the granting gate and the audit rows', () => {
  it('lets a non-administrator save a profile with no granting field', async () => {
    const { service, audit } = build();
    const updated = await inRequest(() =>
      service.updateMember(EDITOR, { id: '2' }, { firstName: 'Renamed' }),
    );
    expect(updated.firstName).toBe('Renamed');
    expect(audit.appended).toEqual([]);
  });

  it.each([
    ['roleId', { roleId: 11 }],
    ['permissions', { permissions: [VIEW] }],
    ['admin', { admin: true }],
  ])(
    'refuses a non-administrator carrying %s with 403, before any write',
    async (_field, granting) => {
      const { service, repo, audit } = build();
      await expect(
        inRequest(() => service.updateMember(EDITOR, { id: '2' }, granting)),
      ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0001', status: 403 });
      expect(repo.permissionWrites).toEqual([]);
      expect(audit.appended).toEqual([]);
    },
  );

  /** SF-7, the edit half: same dangling reference, same declared code. */
  it('refuses a roleId that is not a role with 404 ERP-IDENTITY-0008, before any write (SF-7)', async () => {
    const { service, repo, audit } = build();
    const before = repo.members.find((row) => row.staffId === 2)?.roleId;
    await expect(
      inRequest(() => service.updateMember(ADMIN, { id: '2' }, { roleId: 9999 })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0008', status: 404 });
    expect(repo.members.find((row) => row.staffId === 2)?.roleId).toBe(before);
    expect(audit.appended).toEqual([]);
  });

  it('still refuses a non-administrator with 403 before it looks the role up (SF-7 leaks nothing)', async () => {
    const { service } = build();
    await expect(
      inRequest(() => service.updateMember(EDITOR, { id: '2' }, { roleId: 9999 })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0001', status: 403 });
  });

  it('clears the role on an explicit null without a lookup (SF-7)', async () => {
    const { service } = build();
    const updated = await inRequest(() =>
      service.updateMember(ADMIN, { id: '2' }, { roleId: null }),
    );
    expect(updated.roleId).toBeNull();
  });

  it('writes exactly ONE audit row for a role change, naming actor, subject, before and after', async () => {
    const { service, audit } = build();
    await inRequest(() => service.updateMember(ADMIN, { id: '2' }, { roleId: 11 }));
    expect(audit.appended).toEqual([
      {
        actorStaffId: ADMIN.staffId,
        subjectStaffId: 2,
        subjectRoleId: null,
        changeType: IDENTITY_CHANGE_TYPES.memberRoleChanged,
        permissionCode: null,
        beforeValue: '10',
        afterValue: '11',
        requestId: REQUEST_ID,
        createdAt: new Date(NOW_MS),
      },
    ]);
  });

  it('writes exactly ONE audit row for an admin-flag change', async () => {
    const { service, audit } = build();
    await inRequest(() => service.updateMember(ADMIN, { id: '3' }, { admin: true }));
    expect(audit.appended).toHaveLength(1);
    expect(audit.appended[0]).toMatchObject({
      changeType: IDENTITY_CHANGE_TYPES.memberAdminChanged,
      beforeValue: '0',
      afterValue: '1',
      permissionCode: null,
    });
  });

  it('writes FOUR audit rows sharing one request id for a replacement that adds three and removes one', async () => {
    const { service, audit } = build();
    await inRequest(() =>
      service.updateMember(
        ADMIN,
        { id: '2' },
        { permissions: [VIEW, EDIT, ROLES_VIEW, CONTRACTS_VIEW] },
      ),
    );
    expect(audit.appended).toHaveLength(4);
    expect(new Set(audit.appended.map((entry) => entry.requestId))).toEqual(new Set([REQUEST_ID]));
    const added = audit.appended.filter(
      (entry) => entry.changeType === IDENTITY_CHANGE_TYPES.memberPermissionAdded,
    );
    const removed = audit.appended.filter(
      (entry) => entry.changeType === IDENTITY_CHANGE_TYPES.memberPermissionRemoved,
    );
    expect(added.map((entry) => entry.permissionCode).sort()).toEqual(
      [CONTRACTS_VIEW, EDIT, ROLES_VIEW].sort(),
    );
    expect(removed.map((entry) => entry.permissionCode)).toEqual(['sales.invoices.view']);
  });

  it('leaves the password unchanged when the body carries an empty one (brief §3)', async () => {
    const { service, hasher, publisher } = build();
    await inRequest(() => service.updateMember(ADMIN, { id: '2' }, { password: '' }));
    expect(hasher.calls).toEqual([]);
    expect(publisher.drain().map((event) => event.name)).toEqual(['identity.member.updated']);
  });

  it('hashes a new password and publishes identity.member.passwordChanged', async () => {
    const { service, hasher, publisher } = build();
    await inRequest(() =>
      service.updateMember(ADMIN, { id: '2' }, { password: 'a-long-enough-password' }),
    );
    expect(hasher.calls).toEqual(['a-long-enough-password']);
    expect(publisher.drain().map((event) => event.name)).toEqual([
      'identity.member.updated',
      'identity.member.passwordChanged',
    ]);
  });

  // CR-02(a) of the 03.1 review: `admin` and the role are baked into the access token and the
  // `auth:perm` snapshot, so a change to either must reach `auth`. Asserted by the literal name.
  it('publishes identity.member.accessChanged when the admin flag changes (CR-02 a)', async () => {
    const { service, publisher } = build();
    await inRequest(() => service.updateMember(ADMIN, { id: '3' }, { admin: true }));
    expect(publisher.drain().map((event) => event.name)).toEqual([
      'identity.member.updated',
      'identity.member.accessChanged',
    ]);
  });

  it('publishes identity.member.accessChanged when the role changes (CR-02 a)', async () => {
    const { service, publisher } = build();
    await inRequest(() => service.updateMember(ADMIN, { id: '2' }, { roleId: 11 }));
    expect(publisher.drain().map((event) => event.name)).toEqual([
      'identity.member.updated',
      'identity.member.accessChanged',
    ]);
  });

  it('does not publish identity.member.accessChanged for an unchanged role, an unchanged flag or a profile-only save', async () => {
    const { service, publisher } = build();
    await inRequest(() => service.updateMember(ADMIN, { id: '2' }, { roleId: 10 }));
    expect(publisher.drain().map((event) => event.name)).toEqual(['identity.member.updated']);
    await inRequest(() => service.updateMember(ADMIN, { id: '2' }, { admin: false }));
    expect(publisher.drain().map((event) => event.name)).toEqual(['identity.member.updated']);
    await inRequest(() => service.updateMember(EDITOR, { id: '2' }, { firstName: 'Renamed' }));
    expect(publisher.drain().map((event) => event.name)).toEqual(['identity.member.updated']);
  });

  it('publishes accessChanged after member.updated and before passwordChanged and permissions.replaced', async () => {
    const { service, publisher } = build();
    await inRequest(() =>
      service.updateMember(
        ADMIN,
        { id: '2' },
        { roleId: 11, password: 'a-long-enough-password', permissions: [VIEW] },
      ),
    );
    expect(publisher.drain().map((event) => event.name)).toEqual([
      'identity.member.updated',
      'identity.member.accessChanged',
      'identity.member.passwordChanged',
      'identity.permissions.replaced',
    ]);
  });

  it('refuses a duplicate e-mail held by another member with 409', async () => {
    const { service } = build();
    const other = SEED_MEMBERS[0];
    if (other === undefined) throw new Error('seed member missing');
    await expect(
      inRequest(() => service.updateMember(ADMIN, { id: '2' }, { email: other.email })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0002', status: 409 });
  });

  it('answers 404 for a member that does not exist', async () => {
    const { service } = build();
    await expect(
      inRequest(() => service.updateMember(ADMIN, { id: '9999' }, { firstName: 'X' })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0005' });
  });
});

describe('IdentityService — the administrator-only rules of brief §5 that are not grants', () => {
  it('refuses to take the administrator flag off staff id 1', async () => {
    const { service } = build();
    await expect(
      inRequest(() => service.updateMember(ADMIN, { id: '1' }, { admin: false })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0004', status: 403 });
  });

  it('refuses to let an administrator remove their own administrator flag', async () => {
    const { service } = build();
    const selfAdmin = actorOf(1, true);
    await expect(
      inRequest(() => service.updateMember(selfAdmin, { id: '1' }, { admin: false })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0004' });
  });

  it("refuses a non-administrator changing an administrator's password", async () => {
    const { service, hasher } = build();
    await expect(
      inRequest(() =>
        service.updateMember(EDITOR, { id: '1' }, { password: 'a-long-enough-password' }),
      ),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0004', status: 403 });
    expect(hasher.calls).toEqual([]);
  });

  it("refuses a non-administrator changing an administrator's status", async () => {
    const { service } = build();
    await expect(
      service.setMemberStatus(EDITOR, { id: '1' }, { active: false }),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0004', status: 403 });
  });

  it('refuses anybody deactivating themselves', async () => {
    const { service } = build();
    await expect(
      service.setMemberStatus(ADMIN, { id: '1' }, { active: false }),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0004', status: 403 });
  });

  // CR-03 of the 03.1 review: the e-mail is the login identifier and the Perfex forgot-password
  // destination, so changing an administrator's e-mail is the same takeover as setting their password.
  it("refuses a non-administrator changing an administrator's e-mail, writing nothing (CR-03)", async () => {
    const { service, repo, audit, publisher } = build();
    await expect(
      inRequest(() =>
        service.updateMember(EDITOR, { id: '1' }, { email: 'taken-over@example.invalid' }),
      ),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0004', status: 403 });
    expect((await repo.findMemberById(1))?.email).toBe('seed-1@example.invalid');
    expect(audit.appended).toEqual([]);
    expect(publisher.drain()).toEqual([]);
  });

  it("lets an administrator change another administrator's e-mail (CR-03)", async () => {
    const { service } = build();
    await inRequest(() => service.updateMember(ADMIN, { id: '2' }, { admin: true }));
    const updated = await inRequest(() =>
      service.updateMember(ADMIN, { id: '2' }, { email: 'second-admin@example.invalid' }),
    );
    expect(updated.isAdmin).toBe(true);
    expect(updated.email).toBe('second-admin@example.invalid');
  });

  it("lets a non-administrator change a non-administrator's e-mail (CR-03)", async () => {
    const { service } = build();
    const updated = await inRequest(() =>
      service.updateMember(EDITOR, { id: '2' }, { email: 'renamed-member@example.invalid' }),
    );
    expect(updated.email).toBe('renamed-member@example.invalid');
  });

  it("lets a non-administrator send an administrator's CURRENT e-mail unchanged (CR-03)", async () => {
    const { service } = build();
    const updated = await inRequest(() =>
      service.updateMember(
        EDITOR,
        { id: '1' },
        { email: 'seed-1@example.invalid', firstName: 'Same' },
      ),
    );
    expect(updated.email).toBe('seed-1@example.invalid');
    expect(updated.firstName).toBe('Same');
  });

  // CR-02(b) of the 03.1 review: the actor's `isAdmin` is a JWT claim up to one access-token
  // lifetime old; the subject's is the tblstaff row. A demoted administrator whose token still says
  // admin must not be able to set the flag back on themselves.
  it('refuses a stale-claim administrator setting their own administrator flag, writing nothing (CR-02 b)', async () => {
    const { service, repo, audit, publisher } = build();
    const staleAdmin = actorOf(2, true);
    await expect(
      inRequest(() => service.updateMember(staleAdmin, { id: '2' }, { admin: true })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0004', status: 403 });
    expect((await repo.findMemberById(2))?.isAdmin).toBe(false);
    expect(audit.appended).toEqual([]);
    expect(publisher.drain()).toEqual([]);
  });

  it('lets a real administrator save admin: true on themselves, a no-op (CR-02 b)', async () => {
    const { service } = build();
    const updated = await inRequest(() =>
      service.updateMember(ADMIN, { id: '1' }, { admin: true, firstName: 'Still' }),
    );
    expect(updated.isAdmin).toBe(true);
    expect(updated.firstName).toBe('Still');
  });
});

describe('IdentityService.setMemberStatus', () => {
  it('deactivates another member and publishes identity.member.deactivated; it is not a grant', async () => {
    const { service, publisher, audit } = build();
    await service.setMemberStatus(EDITOR, { id: '2' }, { active: false });
    expect(publisher.drain().map((event) => event.name)).toEqual(['identity.member.deactivated']);
    expect(audit.appended).toEqual([]);
  });

  it('activates a member and publishes identity.member.activated', async () => {
    const { service, publisher } = build();
    await service.setMemberStatus(EDITOR, { id: '3' }, { active: true });
    expect(publisher.drain().map((event) => event.name)).toEqual(['identity.member.activated']);
  });
});

describe('IdentityService.listAudit', () => {
  it('answers the BE-19 envelope to an administrator', async () => {
    const { service } = build();
    await inRequest(() => service.updateMember(ADMIN, { id: '2' }, { roleId: 11 }));
    const response = await service.listAudit(ADMIN, {});
    expect(response.data).toHaveLength(1);
    expect(response.data[0]?.changeType).toBe(IDENTITY_CHANGE_TYPES.memberRoleChanged);
    expect(response.meta).toEqual({ nextCursor: null });
  });

  it('refuses a non-administrator with 403 ERP-IDENTITY-0004', async () => {
    const { service } = build();
    await expect(service.listAudit(EDITOR, {})).rejects.toMatchObject({
      code: 'ERP-IDENTITY-0004',
      status: 403,
    });
  });
});

describe('IdentityService.listRoles / getRole', () => {
  it('answers the BE-19 envelope with a member count per row and the table total', async () => {
    const { service } = build();
    const response = await service.listRoles(ADMIN, {});
    expect(response.data).toEqual([
      { roleId: 10, name: 'Seed role A', memberCount: 2 },
      { roleId: 11, name: 'Seed role B', memberCount: 1 },
    ]);
    expect(response.meta).toEqual({
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });

  it('pages by keyset on roleId and filters by name', async () => {
    const { service } = build();
    const first = await service.listRoles(ADMIN, { limit: '1' });
    expect(first.data.map((row) => row.roleId)).toEqual([10]);
    expect(decodeCursor(first.meta.nextCursor, 'roleId')?.key).toEqual([10, 10]);
    const second = await service.listRoles(ADMIN, { limit: '1', cursor: first.meta.nextCursor });
    expect(second.data.map((row) => row.roleId)).toEqual([11]);
    expect(second.meta).toMatchObject({ nextCursor: null, total: 2, rangeStart: 2 });
    const filtered = await service.listRoles(ADMIN, { 'filter[name]': 'Seed role B' });
    expect(filtered.data.map((row) => row.roleId)).toEqual([11]);
    expect(filtered.meta.total).toBe(1);
  });

  it('sorts roles by name and searches the name with ?q=', async () => {
    const { service } = build();
    const byName = await service.listRoles(ADMIN, { sort: '-name' });
    expect(byName.data.map((row) => row.roleId)).toEqual([11, 10]);
    const searched = await service.listRoles(ADMIN, { q: 'role b' });
    expect(searched.data.map((row) => row.roleId)).toEqual([11]);
    expect(searched.meta.total).toBe(1);
  });

  it('refuses a sort the keyset cannot express and a malformed cursor', async () => {
    const { service } = build();
    await expect(service.listRoles(ADMIN, { sort: 'memberCount' })).rejects.toBeInstanceOf(
      AppError,
    );
    await expect(service.listRoles(ADMIN, { cursor: 'abc' })).rejects.toBeInstanceOf(AppError);
  });

  it('answers the role template as clean ADR-0033 names plus its members', async () => {
    const { service } = build();
    const role = await service.getRole(ADMIN, { id: '10' });
    expect(role.permissions).toEqual([VIEW]);
    expect(role.members.map((member) => member.staffId)).toEqual([1, 2]);
    expect(role.memberCount).toBe(2);
    expect(Object.keys(role.members[0] ?? {}).sort()).toEqual([
      'active',
      'email',
      'firstName',
      'lastName',
      'staffId',
    ]);
  });

  it('answers 404 ERP-IDENTITY-0008 for an id that is not a role', async () => {
    const { service } = build();
    await expect(service.getRole(ADMIN, { id: '9999' })).rejects.toMatchObject({
      code: 'ERP-IDENTITY-0008',
    });
  });

  /**
   * The migration lead's 2026-09-24 decision: both reads are administrator-only and neither declares
   * a permission code. `EDITOR` holds `staff.members.view/create/edit` and no flag; the guard would
   * have admitted it before, so this pair is the regression test for the drift the decision closed.
   */
  it('refuses a non-administrator BOTH reads with 403 ERP-IDENTITY-0004, before any query', async () => {
    const { service, repo } = build();
    const reads = vi.spyOn(repo, 'listRoles');
    await expect(service.listRoles(EDITOR, {})).rejects.toMatchObject({
      code: 'ERP-IDENTITY-0004',
      status: 403,
    });
    await expect(service.getRole(EDITOR, { id: '10' })).rejects.toMatchObject({
      code: 'ERP-IDENTITY-0004',
      status: 403,
    });
    expect(reads).not.toHaveBeenCalled();
  });
});

describe('IdentityService.getPermissionCatalogue / listDepartments', () => {
  it('groups the @erp/contracts catalogue module -> resource -> action and counts the codes', () => {
    const { service } = build();
    const response = service.getPermissionCatalogue();
    expect(response.meta.total).toBe(PERMISSION_CODES.length);
    const staff = response.data.find((entry) => entry.module === 'staff');
    const members = staff?.resources.find((entry) => entry.resource === 'members');
    expect(members?.actions.map((action) => action.code)).toContain(VIEW);
  });

  it('answers the departments picker from DepartmentsFacade, by name, two keys per row (D-55)', async () => {
    const { service, departments } = build();
    const response = await service.listDepartments();
    expect(response).toEqual({ data: SEED_PICKER_DEPARTMENTS, meta: { total: 3 } });
    expect(Object.keys(response.data[0] ?? {}).sort()).toEqual(['departmentId', 'name']);
    expect(departments.pickerCalls).toBe(1);
  });
});

describe('IdentityService member saves validate NEW department ids (D-55, answer 4)', () => {
  it('refuses a create naming an unknown department with 422 ERP-IDENTITY-0009, writing nothing', async () => {
    const { service, repo, audit, publisher, departments } = build();
    const membersBefore = repo.members.length;
    await expect(
      inRequest(() => service.createMember(ADMIN, { ...NEW_MEMBER, departmentIds: [3, 99] })),
    ).rejects.toMatchObject({
      code: 'ERP-IDENTITY-0009',
      status: 422,
      message: 'unknown department id(s): 99',
    });
    expect(repo.members).toHaveLength(membersBefore);
    expect(repo.departmentWrites).toEqual([]);
    expect(audit.appended).toEqual([]);
    expect(publisher.count).toBe(0);
    expect(departments.asked).toEqual([[3, 99]]);
  });

  it('names every unknown id once, ascending', async () => {
    const { service } = build();
    await expect(
      inRequest(() => service.createMember(ADMIN, { ...NEW_MEMBER, departmentIds: [99, 5, 99] })),
    ).rejects.toMatchObject({ message: 'unknown department id(s): 5, 99' });
  });

  it('refuses an update ADDING an unknown department, changing nothing', async () => {
    const { service, repo, audit, publisher, departments } = build();
    repo.departmentIds[2] = [3];
    await expect(
      inRequest(() => service.updateMember(ADMIN, { id: '2' }, { departmentIds: [3, 99] })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0009', message: 'unknown department id(s): 99' });
    expect(repo.departmentIds[2]).toEqual([3]);
    expect(repo.departmentWrites).toEqual([]);
    expect(audit.appended).toEqual([]);
    expect(publisher.count).toBe(0);
    expect(departments.asked).toEqual([[99]]);
  });

  it('D-55: an update keeping a stored unknown id saves', async () => {
    const { service, repo, departments } = build();
    repo.departmentIds[2] = [3, 77];
    const updated = await inRequest(() =>
      service.updateMember(ADMIN, { id: '2' }, { departmentIds: [3, 77] }),
    );
    expect(updated.departmentIds).toEqual([3, 77]);
    expect(departments.asked).toEqual([]);
  });

  it('saves known departments as before, asking only about the new ones', async () => {
    const { service, repo, departments } = build();
    repo.departmentIds[2] = [3];
    await inRequest(() => service.updateMember(ADMIN, { id: '2' }, { departmentIds: [3, 1] }));
    expect(repo.departmentIds[2]).toEqual([3, 1]);
    expect(departments.asked).toEqual([[1]]);
    const created = await inRequest(() =>
      service.createMember(ADMIN, { ...NEW_MEMBER, departmentIds: [1, 2] }),
    );
    expect(created.departmentIds).toEqual([1, 2]);
    expect(departments.asked).toEqual([[1], [1, 2]]);
  });

  it('an update or a create without departmentIds asks the facade nothing', async () => {
    const { service, departments } = build();
    await inRequest(() => service.updateMember(ADMIN, { id: '2' }, { firstName: 'Renamed' }));
    await inRequest(() => service.createMember(ADMIN, NEW_MEMBER));
    expect(departments.asked).toEqual([]);
  });
});

describe('IdentityService role writes (ADR-0034 d.2: every one is a grant)', () => {
  it('refuses a non-admin create, update and delete, writing nothing and no audit row', async () => {
    const runs: ((h: Harness) => Promise<unknown>)[] = [
      (h) => h.service.createRole(EDITOR, { name: 'Helpdesk', permissions: [VIEW] }),
      (h) => h.service.updateRole(EDITOR, { id: '10' }, { name: 'Helpdesk' }),
      (h) => h.service.deleteRole(EDITOR, { id: '11' }),
    ];
    for (const run of runs) {
      const harness = build();
      await expect(inRequest(() => run(harness))).rejects.toMatchObject({
        code: 'ERP-IDENTITY-0001',
      });
      expect(harness.repo.roleWrites).toEqual([]);
      expect(harness.audit.appended).toEqual([]);
      expect(harness.publisher.count).toBe(0);
    }
  });

  it('creates the role, writes exactly one role.created audit row and publishes identity.role.created', async () => {
    const { service, repo, audit, publisher } = build();
    const created = await inRequest(() =>
      service.createRole(ADMIN, { name: 'Helpdesk', permissions: [VIEW, CONTRACTS_VIEW] }),
    );
    expect(created.name).toBe('Helpdesk');
    expect(created.permissions).toEqual([CONTRACTS_VIEW, VIEW].sort());
    expect(created.members).toEqual([]);
    expect(audit.appended).toHaveLength(1);
    expect(audit.appended[0]).toMatchObject({
      actorStaffId: ADMIN.staffId,
      subjectStaffId: null,
      subjectRoleId: created.roleId,
      changeType: IDENTITY_CHANGE_TYPES.roleCreated,
      permissionCode: null,
      beforeValue: null,
      requestId: REQUEST_ID,
    });
    expect(publisher.drain().map((event) => event.name)).toEqual(['identity.role.created']);
    // The stored column is Perfex's own serialize() text, round-tripped by the codec.
    const stored = repo.roles.find((row) => row.roleId === created.roleId);
    expect(stored?.serializedPermissions).toContain('a:2:{');
  });

  it('refuses a duplicate role name with 409 ERP-IDENTITY-0007, on create and on rename', async () => {
    const { service } = build();
    await expect(
      inRequest(() => service.createRole(ADMIN, { name: 'Seed role A', permissions: [] })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0007' });
    await expect(
      inRequest(() => service.updateRole(ADMIN, { id: '11' }, { name: 'Seed role A' })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0007' });
  });

  it('refuses an unknown clean permission name with ERP-IDENTITY-0003 rather than inventing a feature', async () => {
    const { service, repo } = build();
    await expect(
      inRequest(() => service.createRole(ADMIN, { name: 'Helpdesk', permissions: ['not.a.code'] })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0003' });
    expect(repo.roleWrites).toEqual([]);
  });

  it('updates the role and writes exactly one role.updated row when applyToMembers is absent', async () => {
    const { service, repo, audit, publisher } = build();
    const saved = await inRequest(() =>
      service.updateRole(ADMIN, { id: '10' }, { name: 'Seed role A2', permissions: [EDIT] }),
    );
    expect(saved.name).toBe('Seed role A2');
    expect(saved.permissions).toEqual([EDIT]);
    expect(audit.appended).toHaveLength(1);
    expect(audit.appended[0]?.changeType).toBe(IDENTITY_CHANGE_TYPES.roleUpdated);
    expect(audit.appended[0]?.subjectRoleId).toBe(10);
    expect(publisher.drain().map((event) => event.name)).toEqual(['identity.role.updated']);
    expect(repo.permissionWrites).toEqual([]);
  });

  it('applyToMembers replaces every non-admin holder’s rows, one audit row per code moved and one event per member', async () => {
    const { service, repo, audit, publisher } = build();
    await inRequest(() =>
      service.updateRole(ADMIN, { id: '10' }, { permissions: [EDIT], applyToMembers: true }),
    );
    // Role 10 is held by staff 1 (an administrator) and staff 2; only staff 2 is written to.
    expect(repo.permissionWrites.map((write) => write.staffId)).toEqual([2]);
    // 260925-rvw: the unmapped `edit.tasks` row is carried through, no longer silently deleted.
    expect(repo.permissionRows[2]).toEqual([
      { feature: 'staff', capability: 'edit' },
      { feature: 'edit', capability: 'tasks' },
    ]);
    const byType = audit.appended.map((entry) => entry.changeType);
    expect(byType.filter((type) => type === IDENTITY_CHANGE_TYPES.roleUpdated)).toHaveLength(1);
    // staff 2 held staff.members.view and sales.invoices.view (and one unmapped row, kept):
    // one code added, two removed.
    expect(byType.filter((type) => type === IDENTITY_CHANGE_TYPES.memberPermissionAdded)).toEqual([
      IDENTITY_CHANGE_TYPES.memberPermissionAdded,
    ]);
    expect(
      byType.filter((type) => type === IDENTITY_CHANGE_TYPES.memberPermissionRemoved),
    ).toHaveLength(2);
    expect(new Set(audit.appended.map((entry) => entry.requestId))).toEqual(new Set([REQUEST_ID]));
    expect(publisher.drain().map((event) => event.name)).toEqual([
      'identity.role.updated',
      'identity.permissions.replaced',
    ]);
  });

  it('applyToMembers never gives an is_not_staff member the leads feature', async () => {
    const { service, repo } = build();
    await inRequest(() =>
      service.updateRole(
        ADMIN,
        { id: '11' },
        { permissions: [LEADS_VIEW, VIEW], applyToMembers: true },
      ),
    );
    // Staff 4 holds role 11 and is `is_not_staff`.
    expect(repo.permissionWrites.map((write) => write.staffId)).toEqual([4]);
    expect(repo.permissionRows[4]?.map((row) => row.feature)).toEqual(['staff']);
  });

  /**
   * Quick task 260925-rvw: the role fan-out shares the member save's root cause (WR-03, WR-04). A
   * holder's unmapped row is carried through, not silently deleted, and a code the holder does not
   * receive (leads, for an is_not_staff member) is not audited as added.
   */
  it('applyToMembers keeps a holder’s unmapped row and audits only the codes it stored (260925-rvw)', async () => {
    const { service, repo, audit } = build();
    await inRequest(() =>
      service.updateRole(ADMIN, { id: '10' }, { permissions: [EDIT], applyToMembers: true }),
    );
    expect(repo.permissionRows[2]).toEqual([
      { feature: 'staff', capability: 'edit' },
      { feature: 'edit', capability: 'tasks' },
    ]);

    audit.appended.length = 0;
    await inRequest(() =>
      service.updateRole(
        ADMIN,
        { id: '11' },
        { permissions: [LEADS_VIEW, VIEW], applyToMembers: true },
      ),
    );
    expect(
      audit.appended
        .filter((entry) => entry.subjectStaffId === 4)
        .map((entry) => entry.permissionCode),
    ).toEqual([VIEW]);
  });

  it('deletes an unreferenced role: one role.deleted row, one event, 204 (void)', async () => {
    const { service, repo, audit, publisher } = build();
    const created = await inRequest(() =>
      service.createRole(ADMIN, { name: 'Nobody holds this', permissions: [] }),
    );
    audit.appended.length = 0;
    publisher.drain();
    await expect(
      inRequest(() => service.deleteRole(ADMIN, { id: String(created.roleId) })),
    ).resolves.toBeUndefined();
    expect(repo.roles.some((row) => row.roleId === created.roleId)).toBe(false);
    expect(audit.appended).toHaveLength(1);
    expect(audit.appended[0]).toMatchObject({
      changeType: IDENTITY_CHANGE_TYPES.roleDeleted,
      subjectRoleId: created.roleId,
      afterValue: null,
    });
    expect(publisher.drain().map((event) => event.name)).toEqual(['identity.role.deleted']);
  });

  it('refuses to delete a referenced role with 409 ERP-IDENTITY-0006 and writes nothing', async () => {
    const { service, repo, audit } = build();
    await expect(inRequest(() => service.deleteRole(ADMIN, { id: '10' }))).rejects.toMatchObject({
      code: 'ERP-IDENTITY-0006',
    });
    expect(repo.roles.some((row) => row.roleId === 10)).toBe(true);
    expect(audit.appended).toEqual([]);
  });

  it('answers 404 ERP-IDENTITY-0008 before the gate for a role that does not exist', async () => {
    const { service } = build();
    await expect(
      inRequest(() => service.updateRole(ADMIN, { id: '9999' }, { name: 'x' })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0008' });
    await expect(inRequest(() => service.deleteRole(ADMIN, { id: '9999' }))).rejects.toMatchObject({
      code: 'ERP-IDENTITY-0008',
    });
  });
});

/** Flips one seeded member's administrator flag in place, without a non-null assertion (TS-02). */
function setAdminFlag(repo: FakeIdentityRepository, staffId: number, isAdmin: boolean): void {
  const index = repo.members.findIndex((row) => row.staffId === staffId);
  const current = repo.members[index];
  if (current === undefined) throw new Error(`no seeded member ${String(staffId)}`);
  repo.members[index] = { ...current, isAdmin };
}

describe('the last administrator keeps the flag', () => {
  it('refuses clearing the only remaining administrator flag', async () => {
    const { service, repo } = build();
    // Staff 1 is the one seeded administrator, and brief §5 already protects staff id 1; make
    // staff 2 the only administrator so the count rule is the one that has to fire.
    setAdminFlag(repo, 1, false);
    setAdminFlag(repo, 2, true);
    await expect(
      inRequest(() => service.updateMember(ADMIN, { id: '2' }, { admin: false })),
    ).rejects.toMatchObject({ code: 'ERP-IDENTITY-0004' });
  });

  it('allows clearing a flag while another administrator remains', async () => {
    const { service, repo } = build();
    setAdminFlag(repo, 2, true);
    await expect(
      inRequest(() => service.updateMember(ADMIN, { id: '2' }, { admin: false })),
    ).resolves.toMatchObject({ staffId: 2, isAdmin: false });
  });
});

/** The body's records, BOM and trailing CRLF removed; every record must have ended in CRLF. */
/** A CSV export's body: the text the core wrote (Excel and PDF bytes or print rows are not CSV). */
function csvText(body: ExportFile['body']): string {
  if (typeof body !== 'string') throw new Error('the export answered no CSV text');
  return body;
}

function csvRecords(body: ExportFile['body']): string[] {
  const text = csvText(body);
  expect(text.startsWith(CSV_BOM)).toBe(true);
  const lines = text.slice(CSV_BOM.length).split('\r\n');
  expect(lines.at(-1)).toBe('');
  return lines.slice(0, -1);
}

async function refusal(run: () => Promise<unknown>): Promise<AppError> {
  const error = await run().then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(AppError);
  return error as AppError;
}

describe('IdentityService.exportMembers (D-26, D-42)', () => {
  it('answers the file name from the clock in UTC and a body of the BOM, the wire names and every row', async () => {
    const { service } = build();
    const file = await service.exportMembers({});
    expect(file.filename).toBe('staff-members-2026-09-21.csv');
    expect(csvText(file.body).startsWith(CSV_BOM)).toBe(true);
    expect(csvRecords(file.body)).toEqual([
      'staffId,firstName,lastName,email,roleName,active,lastLogin',
      '1,Seed1,Member,seed-1@example.invalid,Seed role A,1,',
      '2,Seed2,Member,seed-2@example.invalid,Seed role A,1,2026-02-03T09:15:00.000Z',
      '3,Seed3,Member,seed-3@example.invalid,,0,',
      '4,Seed4,Member,seed-4@example.invalid,Seed role B,1,',
    ]);
  });

  it('counts before it reads, and refuses more than EXPORT_MAX_ROWS on the export path with no row read', async () => {
    const { service, repo } = build();
    repo.memberCountOverride = EXPORT_MAX_ROWS + 1;
    const read = vi.spyOn(repo, 'listMembers');
    const error = await refusal(() => service.exportMembers({}));
    expect(error.code).toBe('ERP-VALIDATION-0001');
    expect(error.extras?.issues).toEqual([
      {
        path: ['export'],
        message: 'too many rows to export',
        params: { limit: EXPORT_MAX_ROWS, total: EXPORT_MAX_ROWS + 1 },
      },
    ]);
    expect(read).toHaveBeenCalledTimes(0);
  });

  it('exports exactly EXPORT_MAX_ROWS matching rows (the cap is inclusive)', async () => {
    const { service, repo } = build();
    repo.memberCountOverride = EXPORT_MAX_ROWS;
    await expect(service.exportMembers({})).resolves.toMatchObject({
      filename: 'staff-members-2026-09-21.csv',
    });
  });

  it('counts with the same filters and q as the rows it reads', async () => {
    const { service, repo } = build();
    const count = vi.spyOn(repo, 'countMembers');
    const file = await service.exportMembers({ 'filter[active]': '1', q: 'Seed' });
    expect(count).toHaveBeenCalledTimes(1);
    expect(count.mock.calls[0]?.[0]).toMatchObject({ search: 'Seed', cursor: null });
    expect(count.mock.calls[0]?.[0].query.filters).toEqual([
      { field: 'active', op: 'eq', value: '1' },
    ]);
    expect(csvRecords(file.body)).toHaveLength(1 + 3);
  });

  it('reads in keyset batches of LIST_QUERY_LIMITS.max, following nextCursor to the end', async () => {
    const extra = Array.from({ length: 1196 }, (_, index) => member({ staffId: 1000 + index }));
    const repo = new FakeIdentityRepository([...SEED_MEMBERS, ...extra]);
    const { service } = buildWith(repo);
    const read = vi.spyOn(repo, 'listMembers');
    const file = await service.exportMembers({});
    expect(read).toHaveBeenCalledTimes(3);
    const requests = read.mock.calls.map(([request]) => request);
    expect(requests.map((request) => request.query.limit)).toEqual([
      LIST_QUERY_LIMITS.max,
      LIST_QUERY_LIMITS.max,
      LIST_QUERY_LIMITS.max,
    ]);
    expect(requests[0]?.cursor).toBeNull();
    expect(requests[1]?.cursor).toMatchObject({ sort: 'staffId', direction: 'after' });
    expect(requests[2]?.cursor?.key).toEqual([1995, 1995]);
    const ids = csvRecords(file.body)
      .slice(1)
      .map((line) => Number(line.split(',')[0]));
    expect(ids).toHaveLength(1200);
    expect(new Set(ids).size).toBe(1200);
  });

  it('refuses a header whose count differs from the seven columns, before it counts', async () => {
    const { service, repo } = build();
    const count = vi.spyOn(repo, 'countMembers');
    const error = await refusal(() => service.exportMembers({ header: ['only one'] }));
    expect(error.code).toBe('ERP-VALIDATION-0001');
    expect(error.extras?.issues).toEqual([expect.objectContaining({ path: ['header'] })]);
    expect(count).toHaveBeenCalledTimes(0);
  });

  it('writes the translated labels, escaped like any cell (D-42)', async () => {
    const { service } = build();
    const header = ['Id', '@First', 'Last', 'E-mail, work', 'Role', 'Active', 'Last login'];
    const file = await service.exportMembers({ header });
    expect(csvRecords(file.body)[0]).toBe('Id,\'@First,Last,"E-mail, work",Role,Active,Last login');
  });
});

describe('IdentityService.exportMembers formats (04.1.1: one core, four formats)', () => {
  it('answers print rows with no file name, the api clock as exportedAt and the sent labels (D-28)', async () => {
    const { service } = build();
    const file = await service.exportMembers({
      format: 'print',
      column: ['staffId', 'active'],
      yes: 'Yes',
      no: 'No',
    });
    expect(file.filename).toBeNull();
    expect(file.contentType).toBe('application/json; charset=utf-8');
    expect(file.body).toEqual({
      exportedAt: new Date(NOW_MS).toISOString(),
      headers: ['staffId', 'active'],
      rows: [
        ['1', 'Yes'],
        ['2', 'Yes'],
        ['3', 'No'],
        ['4', 'Yes'],
      ],
    });
  });

  it('names the Excel file staff-members-<date>.xlsx', async () => {
    const { service } = build();
    const file = await service.exportMembers({ format: 'xlsx' });
    expect(file.filename).toBe('staff-members-2026-09-21.xlsx');
    expect(Buffer.isBuffer(file.body)).toBe(true);
  });

  it('refuses a key before it counts: the members list has no row selection (D-27)', async () => {
    const { service, repo } = build();
    const count = vi.spyOn(repo, 'countMembers');
    const error = await refusal(() => service.exportMembers({ key: '1' }));
    expect(error.extras?.issues).toEqual([expect.objectContaining({ path: ['key'] })]);
    expect(count).toHaveBeenCalledTimes(0);
  });

  it('refuses a limit or a cursor on its own path before it counts', async () => {
    const { service, repo } = build();
    const count = vi.spyOn(repo, 'countMembers');
    for (const key of ['limit', 'cursor'] as const) {
      const error = await refusal(() => service.exportMembers({ [key]: '10' }));
      expect(error.extras?.issues, key).toEqual([expect.objectContaining({ path: [key] })]);
    }
    expect(count).toHaveBeenCalledTimes(0);
  });

  it('refuses more than PRINT_MAX_ROWS members as pdf with the PDF cap, and reads no row (D-06)', async () => {
    const { service, repo } = build();
    repo.memberCountOverride = PRINT_MAX_ROWS + 1;
    const read = vi.spyOn(repo, 'listMembers');
    const error = await refusal(() => service.exportMembers({ format: 'pdf' }));
    expect(error.extras?.issues).toEqual([
      expect.objectContaining({ params: { limit: PRINT_MAX_ROWS, total: PRINT_MAX_ROWS + 1 } }),
    ]);
    expect(read).toHaveBeenCalledTimes(0);
  });
});

describe('IdentityService.exportRoles (administrators only, like the list)', () => {
  it('refuses a non-administrator with 403 ERP-IDENTITY-0004 before it counts or reads', async () => {
    const { service, repo } = build();
    const count = vi.spyOn(repo, 'countRoles');
    const read = vi.spyOn(repo, 'listRoles');
    const error = await refusal(() => service.exportRoles(EDITOR, {}));
    expect(error.code).toBe('ERP-IDENTITY-0004');
    expect(count).toHaveBeenCalledTimes(0);
    expect(read).toHaveBeenCalledTimes(0);
  });

  it('refuses a non-administrator every format before it parses or counts (D-02)', async () => {
    const { service, repo } = build();
    const count = vi.spyOn(repo, 'countRoles');
    for (const format of ['csv', 'xlsx', 'pdf', 'print', 'docx']) {
      const error = await refusal(() => service.exportRoles(EDITOR, { format }));
      expect(error.code, format).toBe('ERP-IDENTITY-0004');
    }
    expect(count).toHaveBeenCalledTimes(0);
  });

  it('names the PDF file roles-<date>.pdf for an administrator', async () => {
    const { service } = build();
    const file = await service.exportRoles(ADMIN, { format: 'pdf' });
    expect(file.filename).toBe('roles-2026-09-21.pdf');
  });

  it('answers an administrator roles-<date>.csv with roleId, name and memberCount', async () => {
    const { service } = build();
    const file = await service.exportRoles(ADMIN, { sort: '-name' });
    expect(file.filename).toBe('roles-2026-09-21.csv');
    expect(csvRecords(file.body)).toEqual([
      'roleId,name,memberCount',
      '11,Seed role B,1',
      '10,Seed role A,2',
    ]);
  });

  it('refuses more than EXPORT_MAX_ROWS roles on the export path with no row read', async () => {
    const { service, repo } = build();
    repo.roleCountOverride = EXPORT_MAX_ROWS + 1;
    const read = vi.spyOn(repo, 'listRoles');
    const error = await refusal(() => service.exportRoles(ADMIN, {}));
    expect(error.extras?.issues).toEqual([
      {
        path: ['export'],
        message: 'too many rows to export',
        params: { limit: EXPORT_MAX_ROWS, total: EXPORT_MAX_ROWS + 1 },
      },
    ]);
    expect(read).toHaveBeenCalledTimes(0);
  });
});

describe('IdentityService.contactOf (PATTERNS M1: the address and language another module mails)', () => {
  it('answers the address, the locale through toLocale and the active flag', async () => {
    const { service } = buildWith(
      new FakeIdentityRepository([
        member({
          staffId: 41,
          email: 'user@example.test',
          defaultLanguage: 'arabic',
          active: true,
        }),
      ]),
    );
    expect(await service.contactOf(41)).toEqual({
      email: 'user@example.test',
      locale: 'ar',
      active: true,
    });
  });

  it('an empty default language gives locale null', async () => {
    const { service } = buildWith(
      new FakeIdentityRepository([member({ staffId: 42, defaultLanguage: '', active: false })]),
    );
    expect(await service.contactOf(42)).toEqual({
      email: 'seed-42@example.invalid',
      locale: null,
      active: false,
    });
  });

  it('an unknown id gives null', async () => {
    const { service } = build();
    expect(await service.contactOf(9999)).toBeNull();
  });
});
