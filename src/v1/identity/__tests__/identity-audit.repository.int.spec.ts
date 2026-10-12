/**
 * IdentityAuditRepository against the real `tblidentity_audit` (DATABASE_URL from
 * ../erp-infra/env/local/api.host.env).
 *
 * Three properties, proven rather than reviewed (ADR-0034 decision 3):
 *   1. `append` writes through the typed delegate inside the CALLER's transaction — no raw SQL, and
 *      a transaction that rolls back leaves no row behind;
 *   2. `list` is the BE-19 grammar, keyset-paged on `id`, newest first;
 *   3. the class has exactly two methods, so the log cannot be edited or pruned by the module that
 *      writes it (threat T-3.1-4G).
 *
 * Every row this spec writes carries its own `request_id` and is deleted again; no other row is
 * read into an assertion.
 */
import 'reflect-metadata';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { LIST_QUERY_LIMITS, type ListQuery } from '../../../shared/http/pagination.js';
import { IDENTITY_CHANGE_TYPES } from '../identity.routes.js';
import type { AuditListField, IdentityAuditEntry } from '../model/identity.model.js';
import { IdentityAuditRepository } from '../repository/identity-audit.repository.js';
import { IdentityRepository } from '../repository/identity.repository.js';

const REQUEST_ID = 'int-03.1-12-audit';
const ROLLBACK_REQUEST_ID = 'int-03.1-12-audit-rollback';
const ACTOR_STAFF_ID = -1;
const SUBJECT_STAFF_ID = -2;

function entry(overrides: Partial<IdentityAuditEntry> = {}): IdentityAuditEntry {
  return {
    actorStaffId: ACTOR_STAFF_ID,
    subjectStaffId: SUBJECT_STAFF_ID,
    subjectRoleId: null,
    changeType: IDENTITY_CHANGE_TYPES.memberPermissionAdded,
    permissionCode: 'staff.members.view',
    beforeValue: null,
    afterValue: 'granted',
    requestId: REQUEST_ID,
    createdAt: new Date(),
    ...overrides,
  };
}

function query(overrides: Partial<ListQuery<AuditListField>> = {}): ListQuery<AuditListField> {
  return {
    limit: LIST_QUERY_LIMITS.default,
    cursor: null,
    filters: [],
    sort: [],
    ...overrides,
  };
}

describe.skipIf(!process.env.DATABASE_URL)(
  'IdentityAuditRepository against the local mirror',
  () => {
    const service = new PrismaService(new AppConfig(), new HealthService());
    const repository = new IdentityRepository(service, new LoggerService());
    const audit = new IdentityAuditRepository(service);

    const countFor = (requestId: string): Promise<number> =>
      service.client.tblidentity_audit.count({ where: { request_id: requestId } });

    afterEach(async () => {
      await service.client.tblidentity_audit.deleteMany({
        where: { request_id: { in: [REQUEST_ID, ROLLBACK_REQUEST_ID] } },
      });
    });

    afterAll(async () => {
      await service.client.$disconnect();
    });

    it('appends inside the caller transaction and reads the row back', async () => {
      await repository.transaction((tx) => audit.append(tx, [entry()]));
      expect(await countFor(REQUEST_ID)).toBe(1);
      const page = await audit.list(
        query({ filters: [{ field: 'actorStaffId', op: 'eq', value: String(ACTOR_STAFF_ID) }] }),
      );
      const row = page.rows.find((candidate) => candidate.requestId === REQUEST_ID);
      expect(row).toMatchObject({
        actorStaffId: ACTOR_STAFF_ID,
        subjectStaffId: SUBJECT_STAFF_ID,
        changeType: IDENTITY_CHANGE_TYPES.memberPermissionAdded,
        permissionCode: 'staff.members.view',
        beforeValue: null,
        afterValue: 'granted',
      });
      expect(typeof row?.id).toBe('string');
    });

    it('appends nothing for an empty list', async () => {
      await repository.transaction((tx) => audit.append(tx, []));
      expect(await countFor(REQUEST_ID)).toBe(0);
    });

    it('leaves NO row behind when the caller transaction rolls back', async () => {
      const failure = new Error('forced rollback');
      await expect(
        repository.transaction(async (tx) => {
          await audit.append(tx, [entry({ requestId: ROLLBACK_REQUEST_ID })]);
          throw failure;
        }),
      ).rejects.toBe(failure);
      expect(await countFor(ROLLBACK_REQUEST_ID)).toBe(0);
    });

    it('writes one row per entry and shares the request id across them', async () => {
      await repository.transaction((tx) =>
        audit.append(tx, [
          entry({ permissionCode: 'staff.members.view' }),
          entry({ permissionCode: 'staff.members.edit' }),
          entry({
            changeType: IDENTITY_CHANGE_TYPES.memberAdminChanged,
            permissionCode: null,
            beforeValue: '0',
            afterValue: '1',
          }),
        ]),
      );
      expect(await countFor(REQUEST_ID)).toBe(3);
    });

    it('pages newest first by keyset on id', async () => {
      await repository.transaction((tx) =>
        audit.append(tx, [entry({ afterValue: 'first' }), entry({ afterValue: 'second' })]),
      );
      const first = await audit.list(
        query({
          limit: 1,
          filters: [{ field: 'actorStaffId', op: 'eq', value: String(ACTOR_STAFF_ID) }],
        }),
      );
      expect(first.rows).toHaveLength(1);
      expect(first.rows[0]?.afterValue).toBe('second');
      expect(first.nextCursor).toBe(first.rows[0]?.id);
      const second = await audit.list(
        query({
          limit: 1,
          cursor: first.nextCursor,
          filters: [{ field: 'actorStaffId', op: 'eq', value: String(ACTOR_STAFF_ID) }],
        }),
      );
      expect(second.rows[0]?.afterValue).toBe('first');
    });

    it('filters by subject staff id and by change type', async () => {
      await repository.transaction((tx) =>
        audit.append(tx, [
          entry(),
          entry({
            changeType: IDENTITY_CHANGE_TYPES.memberRoleChanged,
            permissionCode: null,
            beforeValue: '1',
            afterValue: '2',
          }),
        ]),
      );
      const byType = await audit.list(
        query({
          filters: [
            { field: 'subjectStaffId', op: 'eq', value: String(SUBJECT_STAFF_ID) },
            { field: 'changeType', op: 'eq', value: IDENTITY_CHANGE_TYPES.memberRoleChanged },
          ],
        }),
      );
      expect(
        byType.rows.every((row) => row.changeType === IDENTITY_CHANGE_TYPES.memberRoleChanged),
      ).toBe(true);
      expect(byType.rows.filter((row) => row.requestId === REQUEST_ID)).toHaveLength(1);
    });

    it('exposes append and list and nothing else — the log is append-only', () => {
      const methods = Object.getOwnPropertyNames(IdentityAuditRepository.prototype).filter(
        (name) => name !== 'constructor',
      );
      expect(methods.sort()).toEqual(['append', 'list']);
    });
  },
);
