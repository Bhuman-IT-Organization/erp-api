import { describe, expect, it } from 'vitest';
import { loadEnv } from '../../config/env.schema.js';
import { PrismaClient } from '../generated/client.js';
import {
  OwnershipViolationError,
  READ_ONLY_SQL,
  type RelationLookup,
  type RelationTarget,
  WRITE_OPERATIONS,
  createOwnershipExtension,
  decide,
  extractSql,
  isReadOnlySql,
  rawVerbOf,
  relationLookupFromClient,
  relationLookupFromDataModel,
  tablesWrittenBy,
} from '../ownership-guard.js';
import type { CoWriteMap, CoWriteRecord } from '../ownership-cowrites.js';
import { loadModelTableMap, loadOwnership } from '../ownership.js';

const ownership = new Map([
  ['tblstaff', 'perfex-core'],
  ['tblwh_stock', 'warehouse'],
  ['tblnode_thing', 'node'],
  ['tbl-mapped', 'node'],
]);
const modelToTable = new Map([['tbl_mapped', 'tbl-mapped']]);

/** No relations: the fixture models above have none. */
const noRelations: RelationLookup = () => undefined;
const base = { args: {}, ownership, modelToTable, relations: noRelations };

describe('ownership guard: writes', () => {
  it('lists exactly the nine Prisma write operations', () => {
    expect(WRITE_OPERATIONS.size).toBe(9);
  });

  it.each([...WRITE_OPERATIONS])('%s on tblstaff (perfex-core) is rejected', (operation) => {
    const d = decide({ ...base, model: 'tblstaff', operation });
    expect(d.allowed).toBe(false);
    if (!d.allowed) {
      expect(d.table).toBe('tblstaff');
      expect(d.owner).toBe('perfex-core');
    }
  });

  it.each([...WRITE_OPERATIONS])('%s on tblwh_stock (warehouse) is rejected', (operation) => {
    const d = decide({ ...base, model: 'tblwh_stock', operation });
    expect(d).toEqual({ allowed: false, table: 'tblwh_stock', owner: 'warehouse' });
  });

  it.each([...WRITE_OPERATIONS])('%s on tblnode_thing (node) is allowed', (operation) => {
    expect(decide({ ...base, model: 'tblnode_thing', operation }).allowed).toBe(true);
  });

  it.each([...WRITE_OPERATIONS])('%s on an unregistered table is rejected', (operation) => {
    const d = decide({ ...base, model: 'tblunknown', operation });
    expect(d).toEqual({ allowed: false, table: 'tblunknown', owner: undefined });
  });

  it('resolves a mapped model to its table before looking up the owner', () => {
    expect(decide({ ...base, model: 'tbl_mapped', operation: 'create' }).allowed).toBe(true);
  });

  it('names the table, operation and owner in the error', () => {
    const err = new OwnershipViolationError('tblstaff', 'update', 'perfex-core');
    expect(err.message).toContain('"update"');
    expect(err.message).toContain('"tblstaff"');
    expect(err.message).toContain('"perfex-core"');
    expect(err.message).toContain('ADR-0029');
    expect(new OwnershipViolationError('x', 'create', undefined).message).toContain(
      'not in prisma/ownership.json',
    );
  });
});

describe('ownership guard: reads', () => {
  it.each([
    'findMany',
    'findFirst',
    'findUnique',
    'findFirstOrThrow',
    'findUniqueOrThrow',
    'count',
    'aggregate',
    'groupBy',
  ])('%s on tblstaff is allowed', (operation) => {
    expect(decide({ ...base, model: 'tblstaff', operation }).allowed).toBe(true);
  });
});

describe('ownership guard: raw writes are table-aware (plan 03.1-05)', () => {
  const raw = (operation: string, sql: unknown) =>
    decide({ ...base, model: undefined, operation, args: sql });

  it.each(['$executeRaw', '$executeRawUnsafe'])(
    '%s to a node-owned table is allowed',
    (operation) => {
      expect(raw(operation, 'INSERT INTO tblnode_thing (a) VALUES (1)').allowed).toBe(true);
      expect(raw(operation, 'UPDATE tblnode_thing SET a = 1 WHERE id = 1').allowed).toBe(true);
      expect(raw(operation, 'DELETE FROM tblnode_thing WHERE id = 1').allowed).toBe(true);
      expect(raw(operation, 'REPLACE INTO tblnode_thing (a) VALUES (1)').allowed).toBe(true);
      expect(raw(operation, 'insert ignore into `tblnode_thing` (a) values (1)').allowed).toBe(
        true,
      );
    },
  );

  it.each(['$executeRaw', '$executeRawUnsafe'])(
    '%s to a perfex-core table names the table, the operation and the owner',
    (operation) => {
      const d = raw(operation, 'UPDATE tblstaff SET active = 0');
      expect(d).toEqual({ allowed: false, table: 'tblstaff', owner: 'perfex-core' });
      const err = new OwnershipViolationError('tblstaff', operation, 'perfex-core');
      expect(err.message).toContain('tblstaff');
      expect(err.message).toContain(operation);
      expect(err.message).toContain('perfex-core');
    },
  );

  it('rejects a table owned by another module and a table with no record at all', () => {
    expect(raw('$executeRaw', 'DELETE FROM tblwh_stock WHERE id = 1')).toEqual({
      allowed: false,
      table: 'tblwh_stock',
      owner: 'warehouse',
    });
    expect(raw('$executeRaw', 'DELETE FROM tblunknown WHERE id = 1')).toEqual({
      allowed: false,
      table: 'tblunknown',
      owner: undefined,
    });
  });

  it('refuses a multi-table statement when any one table is not node-owned', () => {
    expect(raw('$executeRaw', 'UPDATE tblnode_thing, tblstaff SET a = 1')).toEqual({
      allowed: false,
      table: 'tblstaff',
      owner: 'perfex-core',
    });
    expect(raw('$executeRaw', 'DELETE FROM `tblnode_thing`, `tblstaff` WHERE 1 = 0')).toEqual({
      allowed: false,
      table: 'tblstaff',
      owner: 'perfex-core',
    });
    // Every table node-owned: allowed.
    expect(raw('$executeRaw', 'UPDATE tblnode_thing, `tbl-mapped` SET a = 1').allowed).toBe(true);
  });

  it.each([
    // not a statement the parser understands -> fail closed
    'SELECT 1',
    '',
    'TRUNCATE TABLE tblnode_thing',
    'DROP TABLE tblnode_thing',
    'ALTER TABLE tblnode_thing ADD COLUMN a INT',
    'CREATE TABLE tblnode_thing (a INT)',
    'CALL do_something()',
    // the two shapes the file docblock already raises for $queryRaw*
    'WITH x AS (SELECT 1) DELETE FROM tblnode_thing',
    'EXPLAIN ANALYZE UPDATE tblnode_thing SET a = 1',
    // a leading comment hides the verb from an anchored parser
    '-- harmless\nUPDATE tblnode_thing SET a = 1',
    '/* c */ UPDATE tblnode_thing SET a = 1',
    // a second statement the parser would never see
    'UPDATE tblnode_thing SET a = 1; DELETE FROM tblstaff',
    // a qualified or computed target
    'UPDATE legacy.tblnode_thing SET a = 1',
    'DELETE FROM tblnode_thing_extra_suffix.x WHERE 1 = 0',
  ])('$executeRawUnsafe(%j) is refused as unparseable', (sql) => {
    expect(tablesWrittenBy(sql)).toEqual([]);
    expect(raw('$executeRawUnsafe', sql)).toEqual({
      allowed: false,
      table: '<raw>',
      owner: undefined,
    });
  });

  it.each(['$executeRaw', '$executeRawUnsafe'])(
    '%s with no readable SQL at all is refused',
    (operation) => {
      expect(raw(operation, {}).allowed).toBe(false);
      expect(raw(operation, undefined).allowed).toBe(false);
    },
  );

  it('reads a tagged template through extractSql before parsing it', () => {
    expect(
      raw('$executeRaw', { strings: ['INSERT INTO tblnode_thing (a) VALUES (', ')'] }).allowed,
    ).toBe(true);
    expect(raw('$executeRaw', { strings: ['UPDATE tblstaff SET active = ', ''] })).toEqual({
      allowed: false,
      table: 'tblstaff',
      owner: 'perfex-core',
    });
  });

  it('is not fooled by a write keyword or a semicolon inside a string literal', () => {
    expect(
      raw('$executeRaw', "INSERT INTO tblnode_thing (a) VALUES ('x; DELETE FROM tblstaff')")
        .allowed,
    ).toBe(true);
    expect(tablesWrittenBy("UPDATE tblnode_thing SET a = 'DROP TABLE tblstaff'")).toEqual([
      'tblnode_thing',
    ]);
  });

  // WR-01 of the 03.1 review: the target list must be followed immediately by the verb's own
  // keyword. An alias, AS, a JOIN, USING, PARTITION, LIMIT or a comma after an alias means the
  // statement writes (or may write) a table the parser never listed, so it fails closed.
  it.each([
    'UPDATE tblstaff_permissions p JOIN tblclients c ON c.userid = p.staff_id SET c.active = 0',
    'UPDATE tblstaff_permissions p, tblinvoices i SET i.status = 1',
    'UPDATE tblnode_thing AS t SET t.a = 1',
    'UPDATE tblnode_thing JOIN tblstaff ON 1 = 1 SET tblstaff.active = 0',
    'UPDATE tblnode_thing, tblstaff s SET s.active = 0',
    'DELETE FROM tblnode_thing USING tblnode_thing JOIN tblstaff',
    'DELETE FROM tblnode_thing t WHERE 1 = 0',
    'DELETE FROM tblnode_thing LIMIT 1',
    'INSERT INTO tblnode_thing PARTITION (p0) VALUES (1)',
    'INSERT INTO tblnode_thing t (a) VALUES (1)',
    'UPDATE IGNORE tblnode_thing SET a = 1',
  ])('$executeRawUnsafe(%j) fails closed after the target list (WR-01)', (sql) => {
    expect(tablesWrittenBy(sql)).toEqual([]);
    expect(raw('$executeRawUnsafe', sql)).toEqual({
      allowed: false,
      table: '<raw>',
      owner: undefined,
    });
  });
});

describe('ownership guard: raw reads (unchanged)', () => {
  it.each([
    'SELECT 1',
    '  with x as (select 1) select * from x',
    'SHOW TABLES',
    'EXPLAIN SELECT 1',
  ])('$queryRawUnsafe(%j) is allowed', (sql) => {
    expect(READ_ONLY_SQL.test(sql)).toBe(true);
    expect(
      decide({ ...base, model: undefined, operation: '$queryRawUnsafe', args: [sql] }).allowed,
    ).toBe(true);
  });

  it.each([
    'DELETE FROM tblstaff',
    'UPDATE tblstaff SET x=1',
    'INSERT INTO tblstaff VALUES (1)',
    '',
    // WR-01: read keywords that prefix an executing write on MySQL 8
    'EXPLAIN ANALYZE DELETE t FROM tblstaff t',
    'explain   analyze update tblstaff set active = 0',
    'WITH x AS (SELECT 1) DELETE FROM tblstaff',
    'SELECT 1; DROP TABLE tblstaff',
    '-- note\nDELETE FROM tblstaff',
  ])('$queryRawUnsafe(%j) is rejected', (sql) => {
    const d = decide({ ...base, model: undefined, operation: '$queryRawUnsafe', args: [sql] });
    expect(d).toEqual({ allowed: false, table: '<raw>', owner: undefined });
  });

  it.each([
    "SELECT 'delete me' AS note FROM tblstaff",
    'SELECT "update" FROM tblstaff',
    'SELECT `update` FROM tblstaff',
    "SELECT 'it''s' AS quoted",
    'SELECT updated_at, created_by, settings FROM tblstaff',
    'EXPLAIN FORMAT=TREE SELECT 1',
  ])(
    '$queryRawUnsafe(%j) with a write word only inside a literal or identifier is allowed',
    (sql) => {
      expect(isReadOnlySql(sql)).toBe(true);
      expect(
        decide({ ...base, model: undefined, operation: '$queryRawUnsafe', args: [sql] }).allowed,
      ).toBe(true);
    },
  );

  it('$queryRaw with a Sql object is judged by its sql text', () => {
    expect(
      decide({
        ...base,
        model: undefined,
        operation: '$queryRaw',
        args: { sql: 'SELECT 1', values: [] },
      }).allowed,
    ).toBe(true);
  });

  it('$queryRaw with a template (strings[]) is judged by its joined text', () => {
    expect(
      decide({
        ...base,
        model: undefined,
        operation: '$queryRaw',
        args: { strings: ['DELETE FROM tblstaff WHERE id = ', ''] },
      }).allowed,
    ).toBe(false);
  });
});

describe('ownership guard: nested relation writes (WR-02)', () => {
  // A node-owned parent with three relations: `staff` (FK on the parent), `children` (FK on the
  // child, node-owned) and `audit` (FK on the child, perfex-owned). `meta` is a Json scalar.
  const nestedOwnership = new Map([
    ['tblnode_thing', 'node'],
    ['tblnode_child', 'node'],
    ['tblstaff', 'perfex-core'],
    ['tblaudit', 'perfex-core'],
  ]);
  const relations: RelationLookup = (model, field) => {
    const table: Record<string, Record<string, RelationTarget>> = {
      tblnode_thing: {
        staff: { model: 'tblstaff', foreignKeyOnThisSide: true },
        children: { model: 'tblnode_child', foreignKeyOnThisSide: false },
        audit: { model: 'tblaudit', foreignKeyOnThisSide: false },
      },
      tblnode_child: {
        staff: { model: 'tblstaff', foreignKeyOnThisSide: true },
      },
    };
    return table[model]?.[field];
  };
  const nested = { ownership: nestedOwnership, modelToTable, relations, model: 'tblnode_thing' };
  const rejectedStaff = { allowed: false, table: 'tblstaff', owner: 'perfex-core' };

  it.each(['create', 'connectOrCreate', 'update', 'upsert', 'delete', 'deleteMany', 'updateMany'])(
    'update with data.staff.%s (perfex-core) is rejected naming tblstaff',
    (verb) => {
      const d = decide({
        ...nested,
        operation: 'update',
        args: { data: { staff: { [verb]: {} } } },
      });
      expect(d).toEqual(rejectedStaff);
    },
  );

  it('create with data.staff.create is rejected', () => {
    expect(
      decide({ ...nested, operation: 'create', args: { data: { staff: { create: {} } } } }),
    ).toEqual(rejectedStaff);
  });

  it('upsert checks both the create and the update branch', () => {
    expect(
      decide({
        ...nested,
        operation: 'upsert',
        args: { where: {}, create: {}, update: { staff: { update: {} } } },
      }),
    ).toEqual(rejectedStaff);
    expect(
      decide({
        ...nested,
        operation: 'upsert',
        args: { where: {}, create: { staff: { create: {} } }, update: {} },
      }),
    ).toEqual(rejectedStaff);
  });

  it('walks two levels deep (children.create[].staff.connectOrCreate)', () => {
    const d = decide({
      ...nested,
      operation: 'update',
      args: {
        data: {
          children: {
            create: [{ name: 'a' }, { staff: { connectOrCreate: { where: {}, create: {} } } }],
          },
        },
      },
    });
    expect(d).toEqual(rejectedStaff);
  });

  it('walks nested update wrappers ({ where, data }) and upsert branches', () => {
    expect(
      decide({
        ...nested,
        operation: 'update',
        args: { data: { children: { update: { where: {}, data: { staff: { delete: true } } } } } },
      }),
    ).toEqual(rejectedStaff);
    expect(
      decide({
        ...nested,
        operation: 'update',
        args: {
          data: {
            children: { upsert: [{ where: {}, create: { staff: { create: {} } }, update: {} }] },
          },
        },
      }),
    ).toEqual(rejectedStaff);
  });

  it('connect/disconnect/set write the side that holds the foreign key', () => {
    // FK on tblnode_thing: linking to staff writes only tblnode_thing (node) -> allowed.
    expect(
      decide({ ...nested, operation: 'update', args: { data: { staff: { connect: { id: 1 } } } } })
        .allowed,
    ).toBe(true);
    // FK on tblaudit (perfex-core): `set`/`connect` update tblaudit rows -> rejected.
    expect(
      decide({ ...nested, operation: 'update', args: { data: { audit: { set: [] } } } }),
    ).toEqual({ allowed: false, table: 'tblaudit', owner: 'perfex-core' });
    expect(
      decide({ ...nested, operation: 'update', args: { data: { audit: { connect: { id: 1 } } } } }),
    ).toEqual({ allowed: false, table: 'tblaudit', owner: 'perfex-core' });
  });

  it('allows nested writes whose every target is node-owned', () => {
    expect(
      decide({
        ...nested,
        operation: 'create',
        args: { data: { children: { create: [{ staff: { connect: { id: 1 } } }] } } },
      }).allowed,
    ).toBe(true);
  });

  it('ignores write-shaped values in scalar (Json) columns and reads (where/select/include)', () => {
    expect(
      decide({
        ...nested,
        operation: 'update',
        args: {
          where: { staff: { update: 1 } },
          include: { staff: { create: true } },
          data: { meta: { create: 'not a relation', delete: [1] } },
        },
      }).allowed,
    ).toBe(true);
  });

  it('builds the lookup from a runtime data model, using relationFromFields for the FK side', () => {
    const lookup = relationLookupFromDataModel({
      models: {
        a: {
          fields: [
            { name: 'id', kind: 'scalar', type: 'Int' },
            { name: 'b', kind: 'object', type: 'b', relationFromFields: ['b_id'] },
            { name: 'cs', kind: 'object', type: 'c', relationFromFields: [] },
          ],
        },
        b: { fields: [] },
        c: { fields: [] },
      },
    });
    expect(lookup('a', 'b')).toEqual({ model: 'b', foreignKeyOnThisSide: true });
    expect(lookup('a', 'cs')).toEqual({ model: 'c', foreignKeyOnThisSide: false });
    expect(lookup('a', 'id')).toBeUndefined();
    expect(lookup('zzz', 'b')).toBeUndefined();
  });

  it('refuses to build the extension on a client without a runtime data model', () => {
    expect(() => relationLookupFromClient({})).toThrow(/_runtimeDataModel/);
  });
});

describe('the committed register, today', () => {
  const map = loadOwnership();

  it('holds the whole register', () => {
    expect(map.size).toBeGreaterThanOrEqual(402);
  });

  it('names exactly the node-owned tables; every other model write is rejected', () => {
    // Step 1.2: Services card — tblservices is now owned by Node.
    // The whole node-owned set, from both registers, listed rather than counted so a change to
    // either one has to be made here too. Wave 0 (Phase 1.3, ADR-0030) claimed `tblstaff`;
    // `tblidentity_audit` is Node-created (ADR-0034 d.3) and lives in the node register (ADR-0035).
    // Wave 1 (plan 03.1-05) claimed the three RBAC tables `tblroles`, `tblstaff_departments` and
    // `tblstaff_permissions` in the legacy register, so `v1/identity` may write the rows Perfex
    // reads; the ratchet went 79 -> 77 in the same commit. Wave 2a (plan 04.1-02)
    // claimed `tblexpenses_categories` for `v1/expense-categories`; the ratchet did not move (one
    // writer, not an open violation).
    // Wave 2c (plan 04.3-04) created `tblmail_templates`, `tblmail_template_versions` and
    // `tblmail_sent_emails` for `v1/mail` in the node register (ADR-0049); the ratchet did not move.
    // Wave 2a slice 2 (plan 04.1-10) claimed `tbltaxes` for `v1/taxes`; the ratchet moved 77 to 76
    // (an UNATTRIBUTED record closed, D-20).
    // Wave 2a slice 3 (plan 04.1-17) claimed `tblcost_centers` for `v1/cost-centers`; a write-single
    // record, so the ratchet did not move.
    // Wave 2a slice 4 (plan 04.1-22) claimed `tblpayment_modes` for `v1/payment-modes`; a write-single
    // record, so the ratchet did not move.
    // Wave 2a slice 5 (plan 04.1-27) claimed `tblcurrencies` for `v1/currencies`; a write-single
    // record, so the ratchet did not move.
    // The Services card claimed `tblservices` for `v1/services`; Perfex's quick add stays a co-writer.
    // `tbldepartments`, `tblcustomfields` and `tblcustomfieldsvalues` are Perfex's again: this copy
    // removed the Departments and Custom Fields write routes, so v1/departments and v1/custom-fields
    // only read them.
    // Ticket Statuses claimed tbltickets_status for v1/ticket-statuses.
    // Update this expectation in the same PR that changes either register.
    const nodeOwned = [...map.entries()]
      .filter(([, o]) => o === 'node')
      .map(([t]) => t)
      .sort();
    expect(nodeOwned).toEqual([
      'tblcost_centers',
      'tblcurrencies',
      'tblexpenses_categories',
      'tblidentity_audit',
      'tblmail_sent_emails',
      'tblmail_template_versions',
      'tblmail_templates',
      'tblpayment_modes',
      'tblroles',
      'tblservices',
      'tblstaff',
      'tblstaff_departments',
      'tblstaff_permissions',
      'tbltaxes',
      'tbltickets_status',
    ]);
    const tables = loadModelTableMap();
    for (const table of map.keys()) {
      if (nodeOwned.includes(table)) continue;
      expect(
        decide({
          model: table,
          operation: 'create',
          args: {},
          ownership: map,
          modelToTable: tables,
          relations: noRelations,
        }).allowed,
      ).toBe(false);
    }
  });

  it('allows a tblstaff updateMany (node) and rejects a tblknowledge_base_groups update (perfex-core)', () => {
    const tables = loadModelTableMap();
    expect(
      decide({
        model: 'tblstaff',
        operation: 'updateMany',
        args: { where: { staffid: 1 }, data: { password: 'x' } },
        ownership: map,
        modelToTable: tables,
        relations: noRelations,
      }),
    ).toEqual({ allowed: true });
    expect(
      decide({
        model: 'tblknowledge_base_groups',
        operation: 'update',
        args: { where: { groupid: 1 }, data: { name: 'x' } },
        ownership: map,
        modelToTable: tables,
        relations: noRelations,
      }),
    ).toEqual({ allowed: false, table: 'tblknowledge_base_groups', owner: 'perfex-core' });
  });

  const rawOnRegister = (args: unknown) =>
    decide({
      model: undefined,
      operation: '$executeRaw',
      args,
      ownership: map,
      modelToTable: loadModelTableMap(),
      relations: noRelations,
    });

  it('refuses a raw UPDATE whose alias or JOIN hides a non-node table (the live WR-01 hole)', () => {
    // tblstaff_permissions is node-owned; tblclients and tblinvoices are not. Before WR-01's fix
    // the parser listed only the first name and both statements were admitted.
    expect(
      rawOnRegister(
        'UPDATE tblstaff_permissions p JOIN tblclients c ON c.userid = p.staff_id SET c.active = 0',
      ).allowed,
    ).toBe(false);
    expect(
      rawOnRegister('UPDATE tblstaff_permissions p, tblinvoices i SET i.status = 1').allowed,
    ).toBe(false);
  });

  // Every raw write erp-api issues today, as extractSql reads it (tagged templates are passed as
  // `{ strings }`, exactly what Prisma hands the extension). Each must stay admitted.
  it.each([
    {
      site: 'identity.repository.ts replacePermissionRows (delete; also the int-spec cleanups by staff_id)',
      args: { strings: ['DELETE FROM tblstaff_permissions WHERE staff_id = ', ''] },
      tables: ['tblstaff_permissions'],
    },
    {
      site: 'identity.repository.ts replacePermissionRows (insert)',
      args: {
        strings: [
          'INSERT INTO tblstaff_permissions (staff_id, feature, capability) VALUES (',
          ', ',
          ', ',
          ')',
        ],
      },
      tables: ['tblstaff_permissions'],
    },
    {
      site: 'identity.repository.int.spec.ts cleanup by e-mail',
      args: {
        strings: [
          'DELETE FROM tblstaff_permissions WHERE staff_id IN (SELECT staffid FROM tblstaff WHERE email = ',
          ')',
        ],
      },
      tables: ['tblstaff_permissions'],
    },
    {
      site: 'ownership-guard.int.spec.ts no-op UPDATE (unsafe)',
      args: 'UPDATE tblstaff SET last_ip = last_ip WHERE staffid = -1',
      tables: ['tblstaff'],
    },
    {
      site: 'ownership-guard.int.spec.ts no-op UPDATE (tagged)',
      args: { strings: ['UPDATE tblstaff SET last_ip = last_ip WHERE staffid = ', ''] },
      tables: ['tblstaff'],
    },
    {
      site: 'ownership-guard.int.spec.ts audit cleanup',
      args: { strings: ['DELETE FROM tblidentity_audit WHERE request_id = ', ''] },
      tables: ['tblidentity_audit'],
    },
  ])('admits $site', ({ args, tables }) => {
    expect(tablesWrittenBy(extractSql(args))).toEqual(tables);
    expect(rawOnRegister(args)).toEqual({ allowed: true });
  });
});

describe('co-write exceptions (ADR-0050, plan 04.6-03)', () => {
  const COUNTER_SQL =
    "UPDATE tbloptions SET value = CAST(value AS UNSIGNED) + ? WHERE name = ? AND value REGEXP '^[0-9]+$'";

  describe('rawVerbOf', () => {
    it.each([
      ['INSERT INTO t (a) VALUES (1)', 'insert'],
      ['insert ignore into `t` (a) values (1)', 'insert'],
      ['REPLACE INTO t (a) VALUES (1)', 'insert'],
      ['UPDATE t SET a = 1', 'update'],
      ['DELETE FROM t WHERE id = 1', 'delete'],
    ])('%s is %s', (sql, verb) => {
      expect(rawVerbOf(sql)).toBe(verb);
    });

    it.each([
      'SELECT 1',
      'UPDATE t SET a = 1; DELETE FROM t',
      'UPDATE t x JOIN u y ON y.id = x.id SET y.a = 1',
      '/* c */ UPDATE t SET a = 1',
    ])('%s has no verb (fails closed like tablesWrittenBy)', (sql) => {
      expect(rawVerbOf(sql)).toBeUndefined();
    });
  });

  describe('over the committed ownership registers and a fixture co-write register', () => {
    const map = loadOwnership();
    // The committed co-write register is empty today; these fixture records exercise each rule.
    const fixture = (
      table: string,
      operation: CoWriteRecord['operation'],
      columns: CoWriteRecord['columns'],
      raw = false,
    ): CoWriteRecord => ({
      table,
      operation,
      columns,
      raw,
      module: 'v1/example-item',
      files: ['src/v1/example-item/repository/example-item.repository.ts'],
      decision: 'test',
      until: 'test',
      note: 'test',
    });
    const coWrites: CoWriteMap = new Map([
      ['tblpur_order_detail', [fixture('tblpur_order_detail', 'update', ['wh_quantity_received'])]],
      [
        'tblpur_orders',
        [fixture('tblpur_orders', 'update', ['status_goods', 'delivery_status', 'order_status'])],
      ],
      ['tblquality_checks', [fixture('tblquality_checks', 'insert', '*')]],
      ['tblquality_check_details', [fixture('tblquality_check_details', 'insert', '*')]],
      [
        'tblquality_control_points',
        [fixture('tblquality_control_points', 'update', ['last_recurring_date'])],
      ],
      ['tbloptions', [fixture('tbloptions', 'update', ['value'], true)]],
    ]);
    const tables = loadModelTableMap();
    const on = (model: string | undefined, operation: string, args: unknown, withMap = true) =>
      decide({
        model,
        operation,
        args,
        ownership: map,
        modelToTable: tables,
        relations: noRelations,
        ...(withMap ? { coWrites } : {}),
      });

    const day = new Date('2026-10-05T00:00:00Z');
    const cases: {
      name: string;
      model?: string;
      operation: string;
      args: unknown;
      allowed: boolean;
    }[] = [
      {
        name: 'order line received quantity',
        model: 'tblpur_order_detail',
        operation: 'update',
        args: { where: { id: 1 }, data: { wh_quantity_received: '3' } },
        allowed: true,
      },
      {
        name: 'order line received quantity plus quantity (extra column)',
        model: 'tblpur_order_detail',
        operation: 'update',
        args: { where: { id: 1 }, data: { wh_quantity_received: '3', quantity: '9' } },
        allowed: false,
      },
      {
        name: 'order line updateMany',
        model: 'tblpur_order_detail',
        operation: 'updateMany',
        args: { where: { pur_order: 1 }, data: { wh_quantity_received: '3' } },
        allowed: true,
      },
      {
        name: 'order line create',
        model: 'tblpur_order_detail',
        operation: 'create',
        args: { data: { wh_quantity_received: '3' } },
        allowed: false,
      },
      {
        name: 'order line upsert',
        model: 'tblpur_order_detail',
        operation: 'upsert',
        args: {
          where: { id: 1 },
          create: { wh_quantity_received: '3' },
          update: { wh_quantity_received: '3' },
        },
        allowed: false,
      },
      {
        name: 'order line delete',
        model: 'tblpur_order_detail',
        operation: 'delete',
        args: { where: { id: 1 } },
        allowed: false,
      },
      {
        name: 'order line deleteMany',
        model: 'tblpur_order_detail',
        operation: 'deleteMany',
        args: { where: { id: 1 } },
        allowed: false,
      },
      {
        name: 'order statuses',
        model: 'tblpur_orders',
        operation: 'update',
        args: {
          where: { id: 1 },
          data: { status_goods: 1, delivery_status: 2, order_status: 'confirmed' },
        },
        allowed: true,
      },
      {
        name: 'order vendor (extra column)',
        model: 'tblpur_orders',
        operation: 'update',
        args: { where: { id: 1 }, data: { vendor: 1 } },
        allowed: false,
      },
      {
        name: 'quality check create, any keys',
        model: 'tblquality_checks',
        operation: 'create',
        args: { data: { code: 'x', status: 'to_do' } },
        allowed: true,
      },
      {
        name: 'quality check createMany with an array',
        model: 'tblquality_checks',
        operation: 'createMany',
        args: { data: [{ code: 'x' }, { code: 'y' }] },
        allowed: true,
      },
      {
        name: 'quality check update (no update record)',
        model: 'tblquality_checks',
        operation: 'update',
        args: { where: { id: 1 }, data: { status: 'pass' } },
        allowed: false,
      },
      {
        name: 'quality check detail create',
        model: 'tblquality_check_details',
        operation: 'create',
        args: { data: { check_id: 1 } },
        allowed: true,
      },
      {
        name: 'control point last recurring date',
        model: 'tblquality_control_points',
        operation: 'update',
        args: { where: { id: 1 }, data: { last_recurring_date: day } },
        allowed: true,
      },
      {
        name: 'control point status (extra column)',
        model: 'tblquality_control_points',
        operation: 'update',
        args: { where: { id: 1 }, data: { status: 0 } },
        allowed: false,
      },
      {
        name: 'typed tbloptions update (the record is raw only)',
        model: 'tbloptions',
        operation: 'update',
        args: { where: { id: 1 }, data: { value: '1' } },
        allowed: false,
      },
      {
        name: 'an unlisted Perfex table',
        model: 'tblclients',
        operation: 'update',
        args: { where: { userid: 1 }, data: { active: 0 } },
        allowed: false,
      },
      {
        name: 'raw counter UPDATE (string)',
        operation: '$executeRawUnsafe',
        args: COUNTER_SQL,
        allowed: true,
      },
      {
        name: 'raw counter UPDATE (tagged template)',
        operation: '$executeRaw',
        args: {
          strings: [
            'UPDATE tbloptions SET value = CAST(value AS UNSIGNED) + ',
            ' WHERE name = ',
            " AND value REGEXP '^[0-9]+$'",
          ],
        },
        allowed: true,
      },
      {
        name: 'raw DELETE FROM tbloptions',
        operation: '$executeRawUnsafe',
        args: 'DELETE FROM tbloptions WHERE name = ?',
        allowed: false,
      },
      {
        name: 'raw INSERT INTO tbloptions',
        operation: '$executeRawUnsafe',
        args: 'INSERT INTO tbloptions (name, value) VALUES (?, ?)',
        allowed: false,
      },
      {
        name: 'raw REPLACE INTO tbloptions',
        operation: '$executeRawUnsafe',
        args: 'REPLACE INTO tbloptions (name, value) VALUES (?, ?)',
        allowed: false,
      },
      {
        name: 'raw UPDATE of a non-raw record',
        operation: '$executeRawUnsafe',
        args: 'UPDATE tblpur_orders SET status_goods = 1 WHERE id = ?',
        allowed: false,
      },
      {
        name: 'raw two statements',
        operation: '$executeRawUnsafe',
        args: `${COUNTER_SQL}; DELETE FROM tbloptions`,
        allowed: false,
      },
      {
        name: 'raw counter UPDATE beside a second table',
        operation: '$executeRawUnsafe',
        args: 'UPDATE tbloptions, tblclients SET value = 1',
        allowed: false,
      },
    ];

    it.each(cases)('$name: allowed $allowed', ({ model, operation, args, allowed }) => {
      expect(on(model, operation, args).allowed).toBe(allowed);
    });

    it.each(cases)(
      '$name: refused without a co-write map, exactly as before',
      ({ model, operation, args }) => {
        expect(on(model, operation, args, false).allowed).toBe(false);
      },
    );

    it('names the refused table and its owner for an extra column', () => {
      expect(on('tblpur_orders', 'update', { where: { id: 1 }, data: { vendor: 1 } })).toEqual({
        allowed: false,
        table: 'tblpur_orders',
        owner: 'purchase',
      });
    });
  });

  describe('nested writes are never admitted by a co-write', () => {
    const rec = (over: Partial<CoWriteRecord>): CoWriteRecord => ({
      table: 'tblpur_orders',
      operation: 'update',
      columns: ['status_goods'],
      raw: false,
      module: 'v1/example-item',
      files: ['src/v1/example-item/repository/example-item.repository.ts'],
      decision: 'test',
      until: 'test',
      note: 'test',
      ...over,
    });
    const coWrites: CoWriteMap = new Map([
      ['tblpur_orders', [rec({})]],
      [
        'tblquality_checks',
        [rec({ table: 'tblquality_checks', operation: 'insert', columns: '*' })],
      ],
      [
        'tblquality_check_details',
        [rec({ table: 'tblquality_check_details', operation: 'insert', columns: '*' })],
      ],
    ]);
    const nestedOwnership = new Map([
      ['tblnode_thing', 'node'],
      ['tblpur_orders', 'purchase'],
      ['tblquality_checks', 'quality'],
      ['tblquality_check_details', 'quality'],
    ]);
    const relations: RelationLookup = (model, field) => {
      if (model === 'tblnode_thing' && field === 'order') {
        return { model: 'tblpur_orders', foreignKeyOnThisSide: true };
      }
      if (model === 'tblquality_checks' && field === 'details') {
        return { model: 'tblquality_check_details', foreignKeyOnThisSide: false };
      }
      return undefined;
    };
    const nested = (model: string, operation: string, args: unknown) =>
      decide({
        model,
        operation,
        args,
        ownership: nestedOwnership,
        modelToTable,
        relations,
        coWrites,
      });

    it('refuses a node-owned model writing a co-write table through a relation', () => {
      expect(
        nested('tblnode_thing', 'update', {
          where: { id: 1 },
          data: { order: { update: { status_goods: 1 } } },
        }),
      ).toEqual({ allowed: false, table: 'tblpur_orders', owner: 'purchase' });
    });

    it("refuses a '*' insert that carries a nested create into another co-write table", () => {
      expect(
        nested('tblquality_checks', 'create', {
          data: { code: 'x', details: { create: [{ point: 1 }] } },
        }),
      ).toEqual({ allowed: false, table: 'tblquality_check_details', owner: 'quality' });
    });

    it('admits the same top-level write without the nested part', () => {
      expect(nested('tblquality_checks', 'create', { data: { code: 'x' } })).toEqual({
        allowed: true,
      });
    });
  });
});

describe('extension on a real client, no connection', () => {
  const client = new PrismaClient({
    datasourceUrl: 'mysql://nobody:nobody@127.0.0.1:1/none',
  }).$extends(createOwnershipExtension(ownership, new Map()));

  it('rejects a model write before any connection is attempted', async () => {
    await expect(client.tblstaff.create({ data: {} as never })).rejects.toBeInstanceOf(
      OwnershipViolationError,
    );
  });

  it('rejects $executeRawUnsafe before any connection is attempted', async () => {
    await expect(
      client.$executeRawUnsafe('UPDATE tblstaff SET staffid = staffid'),
    ).rejects.toBeInstanceOf(OwnershipViolationError);
  });

  it('rejects a nested write to a perfex-owned relation of a node-owned model (WR-02)', async () => {
    // tblinvoices -> tbltwocheckout_log is the one live relation in the mirror. Pretend
    // tblinvoices were node-owned: the nested create still must not reach tbltwocheckout_log.
    const pretend = new PrismaClient({
      datasourceUrl: 'mysql://nobody:nobody@127.0.0.1:1/none',
    }).$extends(
      createOwnershipExtension(
        new Map([
          ['tblinvoices', 'node'],
          ['tbltwocheckout_log', 'perfex-core'],
        ]),
        new Map(),
      ),
    );
    const err = await pretend.tblinvoices
      .update({
        where: { id: 1 },
        data: {
          tbltwocheckout_log: {
            create: { reference: 'x', amount: '1', created_at: new Date() },
          },
        },
      })
      .then(
        () => undefined,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(OwnershipViolationError);
    expect((err as OwnershipViolationError).table).toBe('tbltwocheckout_log');
  });
});

describe('env', () => {
  // The other mandatory variables (plan 01.3-02) are supplied so only the guard rule is under test.
  const base = {
    DATABASE_URL: 'mysql://u:p@h:1/d',
    REDIS_URL: 'redis://h:1/0',
    LEGACY_BASE_URL: 'http://h:2',
    AUTH_JWT_PRIVATE_KEY_PEM: 'x',
    FILE_STORAGE_DIR: '/tmp/files',
    PUBLIC_BASE_URL: 'http://h:3',
  };

  it('refuses OWNERSHIP_GUARD=off outside production', () => {
    expect(() => loadEnv({ ...base, OWNERSHIP_GUARD: 'off', NODE_ENV: 'development' })).toThrow(
      /OWNERSHIP_GUARD=off/,
    );
    expect(() => loadEnv({ ...base, OWNERSHIP_GUARD: 'off', NODE_ENV: 'test' })).toThrow();
  });

  it('accepts OWNERSHIP_GUARD=off in production', () => {
    expect(
      loadEnv({ ...base, OWNERSHIP_GUARD: 'off', NODE_ENV: 'production' }).OWNERSHIP_GUARD,
    ).toBe('off');
  });

  it('defaults OWNERSHIP_GUARD to enforce and requires DATABASE_URL', () => {
    expect(loadEnv(base).OWNERSHIP_GUARD).toBe('enforce');
    expect(() => loadEnv({})).toThrow();
    expect(() => loadEnv({ ...base, DATABASE_URL: 'not a url' })).toThrow();
  });
});
