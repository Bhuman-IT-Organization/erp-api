/**
 * DepartmentsRepository against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * Read only: `tbldepartments` is Perfex's table (the legacy owner) and nothing in erp-api may write
 * it, so this spec creates, changes and deletes nothing, in that table or any other. It runs on the
 * rows the local database already holds. The real probe is compared with a direct read of
 * `information_schema.COLUMNS` for every register line (computed here, never hard-coded), and the
 * lines it lacks are exactly those whose table is absent from the database; every present usage
 * statement runs against the real schema and equals an independent count (an integer line through
 * its typed delegate's `count`, the child line excluding a department naming itself, a list or JSON
 * line through a typed `findMany` of that one column matched in memory by the exact rule); a row
 * reads back through exactly the six columns; the facade's picker equals a direct read.
 *
 * No mailbox column is selected, and no value from the local data is read into an assertion
 * message: ids and counts are compared, never printed.
 */
import 'reflect-metadata';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import {
  DEPARTMENT_REFERENCES,
  DepartmentsRepository,
  referenceKey,
  type DepartmentReference,
} from '../repository/departments.repository.js';
import { DepartmentLinksRegistry } from '../service/department-links.registry.js';
import { DepartmentsService } from '../service/departments.service.js';
import { DepartmentsTransformer, NO_DEPARTMENT_USAGE } from '../service/departments.transformer.js';
import { DepartmentsValidator } from '../service/departments.validator.js';

const numberSchema = z.union([z.bigint(), z.number()]).transform(Number);
const typeSchema = z.array(z.object({ d: z.string() }));
const tableSchema = z.array(z.object({ n: numberSchema }));
const valuesSchema = z.array(z.record(z.string(), z.union([z.string(), z.number()]).nullable()));

/** The six keys a row reads back with (D-47: never a mailbox column). */
const ROW_KEYS = ['calendarId', 'hideFromClient', 'id', 'managerId', 'name', 'parentId'];

/** The two delegate methods the independent counts use, for a table named at run time. */
interface CountingDelegate {
  count(args: { where: Record<string, unknown> }): Promise<number>;
  findMany(args: {
    where: Record<string, unknown>;
    select: Record<string, true>;
  }): Promise<unknown[]>;
}

/** Whether one stored list value names `id`: each comma element compared exactly with its text. */
function listNames(value: string, id: number): boolean {
  return value.split(',').includes(String(id));
}

/** Whether one stored JSON value names `id`: a top-level array holding the number or its text. */
function jsonNames(value: string, id: number): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return false;
  }
  return (
    Array.isArray(parsed) && parsed.some((element) => element === id || element === String(id))
  );
}

describe.skipIf(!process.env.DATABASE_URL)('DepartmentsRepository against the local mirror', () => {
  const service = new PrismaService(new AppConfig(), new HealthService());
  const repository = new DepartmentsRepository(service);
  const client = service.client;
  const delegates = client as unknown as Readonly<Record<string, CountingDelegate>>;

  /** A line's typed delegate. */
  function delegateOf(reference: DepartmentReference): CountingDelegate {
    const delegate = delegates[reference.table];
    if (delegate === undefined) throw new Error(`no delegate for ${reference.table}`);
    return delegate;
  }

  /** The independent count of one present line for one id. */
  async function independentCount(reference: DepartmentReference, id: number): Promise<number> {
    const delegate = delegateOf(reference);
    if (reference.group === 'childDepartments') {
      return delegate.count({ where: { parent_id: id, departmentid: { not: id } } });
    }
    if (reference.match === 'integerId') {
      return delegate.count({ where: { [reference.column]: id } });
    }
    const values = valuesSchema.parse(
      await delegate.findMany({
        where: {},
        select: { [reference.column]: true },
      }),
    );
    const names = reference.match === 'idList' ? listNames : jsonNames;
    return values.filter((value) => {
      const stored = value[reference.column];
      return stored !== null && stored !== undefined && names(String(stored), id);
    }).length;
  }

  afterAll(async () => {
    await service.client.$disconnect();
  });

  it('presentReferences holds every present line with the DATA_TYPE information_schema gives, and lacks exactly the absent ones', async () => {
    const present = await repository.presentReferences();
    const direct = await Promise.all(
      DEPARTMENT_REFERENCES.map(async (reference) => {
        const rows = typeSchema.parse(
          await client.$queryRaw`SELECT DATA_TYPE AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${reference.table} AND COLUMN_NAME = ${reference.column}`,
        );
        return [referenceKey(reference), rows[0]?.d.toLowerCase()] as const;
      }),
    );
    const expected = direct.filter(
      (entry): entry is readonly [string, string] => entry[1] !== undefined,
    );
    expect([...present]).toEqual(expected);

    const absentTables = await Promise.all(
      DEPARTMENT_REFERENCES.map(async (reference) => {
        const [row] = tableSchema.parse(
          await client.$queryRaw`SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ${reference.table}`,
        );
        return row?.n === 0 ? referenceKey(reference) : null;
      }),
    );
    const lacking = DEPARTMENT_REFERENCES.map(referenceKey).filter((key) => !present.has(key));
    expect(lacking).toEqual(absentTables.filter((key): key is string => key !== null));
  });

  it('usageByDepartment over every department equals the independent count of every present line', async () => {
    const ids = (await client.tbldepartments.findMany({ select: { departmentid: true } })).map(
      (row) => row.departmentid,
    );
    const present = await repository.presentReferences();
    const answer = await repository.usageByDepartment(ids);
    const lines = DEPARTMENT_REFERENCES.filter((reference) => present.has(referenceKey(reference)));
    const expected = await Promise.all(
      ids.map(async (id) => {
        const counts = await Promise.all(lines.map((reference) => independentCount(reference, id)));
        const usage: Record<string, number> = { ...NO_DEPARTMENT_USAGE };
        lines.forEach((reference, index) => {
          usage[reference.group] = (usage[reference.group] ?? 0) + (counts[index] ?? 0);
        });
        return [id, usage] as const;
      }),
    );
    expect([...answer.keys()].sort((x, y) => x - y)).toEqual([...ids].sort((x, y) => x - y));
    expect(new Map(answer)).toEqual(new Map(expected));
  });

  it('every row reads back through exactly the six columns, by id and in the full list', async () => {
    const all = await repository.findAll();
    for (const row of all) expect(Object.keys(row).sort()).toEqual(ROW_KEYS);
    const first = all[0];
    if (first === undefined) return;
    const one = await repository.findById(first.id);
    expect(one).toEqual(first);
    expect(Object.keys(one ?? {}).sort()).toEqual(ROW_KEYS);
  });

  it("listForPicker equals a direct read of the ids by name then id, each { departmentId, name } (D-55, moved from identity's int spec)", async () => {
    const departments = new DepartmentsService(
      new DepartmentsValidator(),
      repository,
      new DepartmentsTransformer(),
      new DepartmentLinksRegistry(),
    );
    const picker = await departments.listForPicker();
    const direct = await client.tbldepartments.findMany({
      orderBy: [{ name: 'asc' }, { departmentid: 'asc' }],
      select: { departmentid: true },
    });
    expect(picker.map((entry) => entry.departmentId)).toEqual(
      direct.map((row) => row.departmentid),
    );
    for (const entry of picker) expect(Object.keys(entry).sort()).toEqual(['departmentId', 'name']);
  });
});
