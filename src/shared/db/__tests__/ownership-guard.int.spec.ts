import 'reflect-metadata';
import { afterAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../config/app-config.js';
import { HealthService } from '../../health/health.service.js';
import { OwnershipViolationError } from '../ownership-guard.js';
import { loadOwnership } from '../ownership.js';
import { PrismaService } from '../prisma.service.js';

// tblstaff became node-owned in Phase 1.3 (ADR-0030), so the rejection fixtures live on another
// table. Plan 03.1-05 (P5) moved them again: that plan flips the three RBAC tables to `node`, and a
// write verb aimed at a table that is about to become writable would execute. Plan 04.1-32 moved them
// a third time: it flips tbldepartments to `node` (W2A-06, column-scoped), so the fixture table is
// now tblknowledge_base_groups (perfex-core, write-single, read only by Perfex core, named by no
// planned phase; D-10).
// Never put a write verb against a node-owned table in this spec: it would execute. The check below
// refuses to load this file once the register stops giving the fixture table to perfex-core, so no
// write case is ever registered against a table that has become writable.
// Measured by plan 01.2-03 against the local legacy stack (SELECT COUNT(*) FROM tblstaff).
const EXPECTED_STAFF_ROWS = 33;

const FIXTURE_TABLE = 'tblknowledge_base_groups';
const FIXTURE_OWNER = loadOwnership().get(FIXTURE_TABLE);
if (FIXTURE_OWNER !== 'perfex-core') {
  throw new Error(
    `fixture table ${FIXTURE_TABLE} is no longer perfex-core in prisma/ownership.json; move the fixtures (plan 03.1-05 P5, 04.1-32)`,
  );
}

describe.skipIf(!process.env.DATABASE_URL)('ownership guard against the local mirror', () => {
  const health = new HealthService();
  const service = new PrismaService(new AppConfig(), health);
  service.onModuleInit();
  const { client } = service;

  afterAll(async () => {
    await service.onModuleDestroy();
  });

  it('the register still gives the fixture table to perfex-core, so every write below is refused', () => {
    expect(loadOwnership().get(FIXTURE_TABLE)).toBe('perfex-core');
  });

  it('enforces the guard (OWNERSHIP_GUARD=enforce outside production)', () => {
    expect(service.guardEnabled).toBe(true);
  });

  it(`reads tblstaff through the model: ${String(EXPECTED_STAFF_ROWS)} rows`, async () => {
    expect(await client.tblstaff.count()).toBe(EXPECTED_STAFF_ROWS);
  });

  it('reads tblstaff through $queryRaw', async () => {
    const rows = await client.$queryRaw<
      { n: bigint | number }[]
    >`SELECT COUNT(*) AS n FROM tblstaff`;
    expect(Number(rows[0]?.n)).toBe(EXPECTED_STAFF_ROWS);
  });

  const writes: Record<string, () => Promise<unknown>> = {
    create: () => client.tblknowledge_base_groups.create({ data: {} as never }),
    createMany: () => client.tblknowledge_base_groups.createMany({ data: [] as never }),
    update: () => client.tblknowledge_base_groups.update({ where: { groupid: 1 }, data: {} }),
    updateMany: () =>
      client.tblknowledge_base_groups.updateMany({ where: { groupid: 1 }, data: {} }),
    upsert: () =>
      client.tblknowledge_base_groups.upsert({
        where: { groupid: 1 },
        create: {} as never,
        update: {},
      }),
    delete: () => client.tblknowledge_base_groups.delete({ where: { groupid: 1 } }),
    deleteMany: () => client.tblknowledge_base_groups.deleteMany({ where: { groupid: 1 } }),
  };

  it.each(Object.keys(writes))(
    '%s on tblknowledge_base_groups rejects with OwnershipViolationError',
    async (op) => {
      await expect(writes[op]?.()).rejects.toBeInstanceOf(OwnershipViolationError);
    },
  );

  // Plan 03.1-05: the raw branch is table-aware. `tblstaff` is node-owned and has a primary key,
  // so it is the positive case here; the case that only raw SQL can reach — `tblstaff_permissions`,
  // which Prisma `@@ignore`s for having none — is at the bottom of this file.
  it('$executeRawUnsafe to a node-owned table is admitted and executes (no-op WHERE)', async () => {
    await expect(
      client.$executeRawUnsafe('UPDATE tblstaff SET last_ip = last_ip WHERE staffid = -1'),
    ).resolves.toBe(0);
  });

  it('$executeRaw (tagged template) to a node-owned table is admitted', async () => {
    const absent = -1;
    await expect(
      client.$executeRaw`UPDATE tblstaff SET last_ip = last_ip WHERE staffid = ${absent}`,
    ).resolves.toBe(0);
  });

  it('$executeRawUnsafe to a perfex-core table rejects and leaves the table unchanged', async () => {
    const before = await client.tblknowledge_base_groups.count();
    await expect(
      client.$executeRawUnsafe('UPDATE tblknowledge_base_groups SET name = name'),
    ).rejects.toBeInstanceOf(OwnershipViolationError);
    await expect(
      client.$executeRawUnsafe('DELETE FROM tblknowledge_base_groups WHERE groupid = -1'),
    ).rejects.toBeInstanceOf(OwnershipViolationError);
    expect(await client.tblknowledge_base_groups.count()).toBe(before);
  });

  it('$executeRawUnsafe with a statement the parser cannot read stays refused', async () => {
    await expect(
      client.$executeRawUnsafe(
        'UPDATE tblstaff SET last_ip = last_ip; DELETE FROM tblknowledge_base_groups',
      ),
    ).rejects.toBeInstanceOf(OwnershipViolationError);
    await expect(client.$executeRawUnsafe('TRUNCATE TABLE tblstaff')).rejects.toBeInstanceOf(
      OwnershipViolationError,
    );
  });

  it('$queryRawUnsafe with a non-SELECT rejects', async () => {
    await expect(
      client.$queryRawUnsafe('DELETE FROM tblknowledge_base_groups WHERE 1 = 0'),
    ).rejects.toBeInstanceOf(OwnershipViolationError);
  });

  it.each([
    'EXPLAIN ANALYZE DELETE t FROM tblknowledge_base_groups t WHERE 1 = 0',
    'WITH x AS (SELECT 1) DELETE FROM tblknowledge_base_groups WHERE 1 = 0',
  ])(
    '$queryRawUnsafe(%j) rejects (WR-01: read-prefixed writes execute on MySQL 8)',
    async (sql) => {
      await expect(client.$queryRawUnsafe(sql)).rejects.toBeInstanceOf(OwnershipViolationError);
    },
  );

  it('$queryRawUnsafe with a SELECT resolves', async () => {
    await expect(
      client.$queryRawUnsafe('SELECT staffid FROM tblstaff LIMIT 1'),
    ).resolves.toBeDefined();
  });

  it('updateMany on tblstaff with a no-op WHERE is allowed by the guard (owner node)', async () => {
    // Proves the guard lets the write through without touching a row.
    await expect(
      client.tblstaff.updateMany({ where: { staffid: -1 }, data: { last_ip: null } }),
    ).resolves.toEqual({ count: 0 });
  });

  it('leaves tblstaff untouched after every rejected write and the no-op update', async () => {
    expect(await client.tblstaff.count()).toBe(EXPECTED_STAFF_ROWS);
  });

  // Plan 03.1-05: tblidentity_audit is Node-created (ADR-0034 d.3) and owned in the *node*
  // register (ADR-0035), so this also proves the guard reads the union of the two files. It has a
  // real primary key, so Prisma addresses it with a typed delegate and no raw SQL is needed.
  it('allows a typed write to tblidentity_audit and cleans the row up', async () => {
    const REQUEST_ID = 'int-spec-03.1-05';
    const ACTOR = -1;
    const created = await client.tblidentity_audit.create({
      data: {
        actor_staff_id: ACTOR,
        subject_staff_id: ACTOR,
        change_type: 'member.permission.added',
        permission_code: 'staff.members.view',
        before_value: null,
        after_value: 'granted',
        request_id: REQUEST_ID,
        created_at: new Date(),
      },
    });
    try {
      expect(created.id).toBeGreaterThan(0n);
      expect(await client.tblidentity_audit.count({ where: { request_id: REQUEST_ID } })).toBe(1);
    } finally {
      await client.tblidentity_audit.deleteMany({ where: { request_id: REQUEST_ID } });
    }
    expect(await client.tblidentity_audit.count({ where: { request_id: REQUEST_ID } })).toBe(0);
  });

  it('allows a raw write to tblidentity_audit, proving the node register feeds the raw path', async () => {
    const REQUEST_ID = 'int-spec-03.1-05-raw';
    try {
      await expect(
        client.$executeRaw`DELETE FROM tblidentity_audit WHERE request_id = ${REQUEST_ID}`,
      ).resolves.toBe(0);
    } finally {
      await client.tblidentity_audit.deleteMany({ where: { request_id: REQUEST_ID } });
    }
  });

  // Plan 03.1-05 flipped `tblstaff_permissions` to `node` in the legacy register (ratchet 79 -> 77),
  // because `v1/identity` writes the Perfex-format permission rows Perfex itself reads. The table
  // has no primary key, so Prisma carries it as `@@ignore` and offers no typed delegate: raw SQL is
  // the only way in, and the guard's statement parser is therefore the only thing standing between
  // the module and the table (BE-04). A `staff_id` of -1 matches nothing, so this proves the guard
  // admits the statement without depending on — or changing — a single real row.
  it('allows a raw write to tblstaff_permissions, the PK-less table only raw SQL can reach', async () => {
    const NO_SUCH_STAFF = -1;
    await expect(
      client.$executeRaw`DELETE FROM tblstaff_permissions WHERE staff_id = ${NO_SUCH_STAFF}`,
    ).resolves.toBe(0);
  });

  it('reports checks.db = ok through the registered probe', async () => {
    const report = await health.report();
    expect(report.checks.db).toBe('ok');
    expect(report.status).toBe('ok');
  });
});
