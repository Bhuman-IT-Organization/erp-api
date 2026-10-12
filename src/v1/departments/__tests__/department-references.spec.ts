/**
 * The ONE reference register (`DEPARTMENT_REFERENCES`, D-51) against the schema mirror: every line's
 * table and column exist in `prisma/schema.prisma` except the tables plan 04.1-32 found absent from
 * the mirror (each listed below with what is known of its DDL; the runtime probe counts it 0 with
 * no error, D-28, and the int spec proves the same on the local database); every line has one of the
 * three kinds and the statements its kind runs; the groups are exactly the interfaces' eighteen, in
 * the order of the reads' `usage` record; and neither identity's `tblstaff_departments` (its registered counter)
 * nor a name snapshot (D-52) is in it. Then the module boundary: departments imports no other v1
 * module, so identity can import it with no cycle (D-51, D-55), proven red on a planted import.
 */
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEPARTMENT_REFERENCES, referenceKey } from '../repository/departments.repository.js';
import { NO_DEPARTMENT_USAGE } from '../service/departments.transformer.js';

const SCHEMA = readFileSync(new URL('../../../../prisma/schema.prisma', import.meta.url), 'utf8');

/**
 * The register's tables the Prisma mirror lacks, with their DDL source:
 * `tblacc_approval_setting` has no `install.php`, migration or `CREATE TABLE` anywhere in
 * `modules/accounting`; only its writer names the `departments` column (`Accounting_model.php:34689`).
 */
const ABSENT_TABLES: Readonly<Record<string, string>> = {
  tblacc_approval_setting: 'no DDL in modules/accounting; column from Accounting_model.php:34689',
};

/** The name snapshots plan 32 confirmed and the device label: never counted (D-51, D-52). */
const NOT_COUNTED = [
  'tblhr_list_staff_quitting_work.department_name',
  'tblhrp_payslip_details.dept_name',
  'tblfe_asset_creation.department',
  'tbltimesheets_kteco_attendance_logs.department',
];

/** The field names of one model of the mirror, or `null` when the model is absent. */
function fieldsOf(table: string): readonly string[] | null {
  const start = SCHEMA.indexOf(`\nmodel ${table} {`);
  if (start === -1) return null;
  const end = SCHEMA.indexOf('\n}', start);
  return SCHEMA.slice(start, end)
    .split('\n')
    .slice(2)
    .map((line) => line.trim().split(/\s+/)[0] ?? '')
    .filter((name) => /^[a-z_][a-z0-9_]*$/.test(name));
}

describe('DEPARTMENT_REFERENCES, the one register (D-51)', () => {
  it('D-51: every register column exists', () => {
    const missing = DEPARTMENT_REFERENCES.filter((reference) => {
      if (Object.hasOwn(ABSENT_TABLES, reference.table)) return false;
      return !(fieldsOf(reference.table) ?? []).includes(reference.column);
    }).map(referenceKey);
    expect(missing, 'a register line names a column prisma/schema.prisma lacks').toEqual([]);
  });

  it('the absent tables are exactly the ones plan 32 named, and truly absent from the mirror', () => {
    const absent = [
      ...new Set(
        DEPARTMENT_REFERENCES.filter((reference) => fieldsOf(reference.table) === null).map(
          (reference) => reference.table,
        ),
      ),
    ];
    expect(absent).toEqual(Object.keys(ABSENT_TABLES));
  });

  it('lists each table and column once, frozen', () => {
    const keys = DEPARTMENT_REFERENCES.map(referenceKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toHaveLength(18);
    expect(Object.isFrozen(DEPARTMENT_REFERENCES)).toBe(true);
  });

  it('the groups are exactly the eighteen of the interfaces, in the usage record order', () => {
    expect(DEPARTMENT_REFERENCES.map((reference) => reference.group)).toEqual(
      Object.keys(NO_DEPARTMENT_USAGE),
    );
  });

  it('every line has one of the three kinds and the statements its kind runs', () => {
    for (const reference of DEPARTMENT_REFERENCES) {
      const key = referenceKey(reference);
      expect(['integerId', 'idList', 'idJson'], key).toContain(reference.match);
      const integer = reference.match === 'integerId';
      expect(typeof reference.byValue === 'function', key).toBe(integer);
      expect(typeof reference.byBytes === 'function', key).toBe(integer);
      expect(typeof reference.values === 'function', key).toBe(!integer);
    }
  });

  it("the kinds are plan 32's: list and JSON lines as confirmed from their writers", () => {
    const of = (match: string) =>
      DEPARTMENT_REFERENCES.filter((reference) => reference.match === match).map(referenceKey);
    expect(of('idList')).toEqual([
      'tblfe_approval_setting.departments',
      'tbltimesheets_approval_setting.departments',
      'tblacc_approval_setting.departments',
      'tblhrp_payslip_templates.department_id',
      'tblwork_shift.department',
      'tblday_off.department',
    ]);
    expect(of('idJson')).toEqual(['tblhr_procedure_retire_manage.department']);
  });

  it('names neither tblstaff_departments (identity counts it, D-51) nor a name snapshot (D-52)', () => {
    const keys = DEPARTMENT_REFERENCES.map(referenceKey);
    const tables = DEPARTMENT_REFERENCES.map((reference) => reference.table);
    expect(tables).not.toContain('tblstaff_departments');
    for (const snapshot of NOT_COUNTED) expect(keys).not.toContain(snapshot);
  });
});

const MODULE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const V1_ROOT = resolve(MODULE_ROOT, '..');

/** Every `.ts` file under `root` outside `__tests__`, as absolute paths. */
function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !relative(root, path).split(sep).includes('__tests__'));
}

/** Every module specifier of a source: `from '...'`, `import '...'` and `import('...')`. */
function specifiers(source: string): string[] {
  return [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)'([^']+)'/g)].map(
    (match) => match[1] ?? '',
  );
}

/** The imports of the module under `moduleRoot` that resolve under `v1Root` but outside the module. */
function crossModuleImports(moduleRoot: string, v1Root: string): string[] {
  return sourceFiles(moduleRoot).flatMap((file) =>
    specifiers(readFileSync(file, 'utf8'))
      .filter((specifier) => specifier.startsWith('.'))
      .map((specifier) => resolve(dirname(file), specifier))
      .filter((target) => {
        const inV1 = !relative(v1Root, target).startsWith('..');
        const inModule = !relative(moduleRoot, target).startsWith('..');
        return inV1 && !inModule;
      })
      .map((target) => `${relative(moduleRoot, file)} -> ${relative(v1Root, target)}`),
  );
}

describe('the module boundary (D-51, D-55)', () => {
  it('D-51: departments imports no other v1 module', () => {
    expect(crossModuleImports(MODULE_ROOT, V1_ROOT)).toEqual([]);

    // The same check on a temporary copy with one planted line: it must fail there.
    const scratch = mkdtempSync(join(tmpdir(), 'departments-boundary-'));
    try {
      const copy = join(scratch, 'v1', 'departments');
      cpSync(MODULE_ROOT, copy, { recursive: true });
      writeFileSync(
        join(copy, 'service', 'probe.ts'),
        "import '../../identity/index.js';\nexport {};\n",
      );
      expect(crossModuleImports(copy, join(scratch, 'v1'))).toEqual([
        `service${sep}probe.ts -> identity${sep}index.js`,
      ]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
