/**
 * The recorded co-write register (ADR-0050, plan 04.6-03): the loader's refusals, the pure
 * admission lookup, and the structural scan that keeps every write into a co-write table inside the
 * files its record names.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { coWriteFor, loadCoWrites, type CoWriteMap } from '../ownership-cowrites.js';
import { loadOwnership } from '../ownership.js';

const scratch = mkdtempSync(join(tmpdir(), 'erp-cowrites-'));
const register = (records: unknown): URL => {
  const file = join(scratch, `${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify(records));
  return pathToFileURL(file);
};

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const ownership = new Map([
  ['tblperfex_thing', 'purchase'],
  ['tblother_thing', 'quality'],
  ['tblours', 'node'],
]);

const record = (over: Record<string, unknown> = {}) => ({
  table: 'tblperfex_thing',
  operation: 'update',
  columns: ['a', 'b'],
  raw: false,
  module: 'v1/currencies',
  files: ['src/v1/currencies/repository/co-writes.repository.ts'],
  decision: '4.6 D-05',
  until: 'purchase slice S3',
  note: 'A test record.',
  ...over,
});

const count = (map: CoWriteMap): number =>
  [...map.values()].reduce((n, records) => n + records.length, 0);

describe('loadCoWrites (ADR-0050)', () => {
  it('loads the committed register: no record today', () => {
    const map = loadCoWrites(loadOwnership());
    expect(count(map)).toBe(0);
  });

  it('loads a valid fixture record keyed by its table', () => {
    const map = loadCoWrites(ownership, register([record()]));
    expect(map.get('tblperfex_thing')).toHaveLength(1);
  });

  it('refuses a record for a node-owned table', () => {
    expect(() => loadCoWrites(ownership, register([record({ table: 'tblours' })]))).toThrow(
      /tblours/,
    );
  });

  it('refuses a record for a table neither ownership register names', () => {
    expect(() => loadCoWrites(ownership, register([record({ table: 'tblnowhere' })]))).toThrow(
      /tblnowhere/,
    );
  });

  it('refuses a duplicate (table, operation)', () => {
    expect(() => loadCoWrites(ownership, register([record(), record({ columns: ['c'] })]))).toThrow(
      /more than once/,
    );
  });

  it("refuses columns '*' with update, and admits it with insert", () => {
    expect(() => loadCoWrites(ownership, register([record({ columns: '*' })]))).toThrow(/'\*'/);
    expect(
      loadCoWrites(ownership, register([record({ operation: 'insert', columns: '*' })])).size,
    ).toBe(1);
  });

  it('refuses a duplicated column name', () => {
    expect(() => loadCoWrites(ownership, register([record({ columns: ['a', 'a'] })]))).toThrow(
      /column/,
    );
  });

  it('refuses an unknown field (strict) and a record that is not the shape', () => {
    expect(() => loadCoWrites(ownership, register([{ ...record(), extra: 1 }]))).toThrow();
    expect(() => loadCoWrites(ownership, register([record({ operation: 'upsert' })]))).toThrow();
    expect(() => loadCoWrites(ownership, register([record({ files: [] })]))).toThrow();
    expect(() => loadCoWrites(ownership, register([record({ module: 'currencies' })]))).toThrow();
    expect(() => loadCoWrites(ownership, register(record()))).toThrow();
  });

  it('refuses a missing file instead of loading an empty register', () => {
    expect(() => loadCoWrites(ownership, pathToFileURL(join(scratch, 'absent.json')))).toThrow();
  });
});

describe('coWriteFor', () => {
  const map = loadCoWrites(
    ownership,
    register([
      record(),
      record({ table: 'tblother_thing', operation: 'insert', columns: '*' }),
      record({ table: 'tblother_thing', operation: 'update', columns: ['v'], raw: true }),
    ]),
  );

  it('admits a typed write whose keys sit inside the listed columns', () => {
    expect(coWriteFor(map, 'tblperfex_thing', 'update', ['a'])?.table).toBe('tblperfex_thing');
    expect(coWriteFor(map, 'tblperfex_thing', 'update', ['a', 'b'])).toBeDefined();
  });

  it('refuses an extra column', () => {
    expect(coWriteFor(map, 'tblperfex_thing', 'update', ['a', 'z'])).toBeUndefined();
  });

  it('refuses an operation the table has no record for, and an unlisted table', () => {
    expect(coWriteFor(map, 'tblperfex_thing', 'insert', ['a'])).toBeUndefined();
    expect(coWriteFor(map, 'tblunlisted', 'update', ['a'])).toBeUndefined();
  });

  it("admits any keys under '*'", () => {
    expect(coWriteFor(map, 'tblother_thing', 'insert', ['x', 'y', 'z'])).toBeDefined();
  });

  it('never admits a typed write through a raw record', () => {
    expect(coWriteFor(map, 'tblother_thing', 'update', ['v'])).toBeUndefined();
  });
});

// The structural half of ADR-0050 decision 4: the guard sees tables and columns, this scan sees
// files. A write into a co-write table from any file a record does not list fails here.
const SRC = fileURLToPath(new URL('../../../', import.meta.url));
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const GENERATED = join(SRC, 'shared', 'db', 'generated');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || path === GENERATED) continue;
      sourceFiles(path, out);
    } else if (entry.name.endsWith('.ts')) {
      out.push(path);
    }
  }
  return out;
}

const DELEGATE_WRITES =
  'create|createMany|createManyAndReturn|update|updateMany|updateManyAndReturn|upsert|delete|deleteMany';

function writePatterns(table: string): RegExp[] {
  return [
    new RegExp(String.raw`\.${table}\.(?:${DELEGATE_WRITES})\(`),
    new RegExp(
      String.raw`\b(?:UPDATE|INSERT\s+(?:IGNORE\s+)?INTO|REPLACE\s+INTO|DELETE\s+FROM)\s+\x60?${table}\b`,
      'i',
    ),
  ];
}

describe('structural scan: only the listed files write a co-write table (ADR-0050 decision 4)', () => {
  const map = loadCoWrites(loadOwnership());
  const files = sourceFiles(SRC);

  it('walks the source tree, skipping __tests__ and the generated client', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.includes(`${sep}__tests__${sep}`))).toBe(false);
    expect(files.some((f) => f.startsWith(GENERATED))).toBe(false);
  });

  it('recognises a typed delegate write and a raw write, and not a read', () => {
    const [delegate, raw] = writePatterns('tblpur_orders');
    expect(delegate?.test('await tx.tblpur_orders.update({')).toBe(true);
    expect(delegate?.test('await tx.tblpur_orders.findMany({')).toBe(false);
    expect(raw?.test('`UPDATE tblpur_orders SET status_goods = 1`')).toBe(true);
    expect(raw?.test('insert into `tblpur_orders` (a) values (1)')).toBe(true);
    expect(raw?.test('SELECT * FROM tblpur_orders')).toBe(false);
  });

  it('finds every writer of a co-write table inside the files its records list', () => {
    const strays: string[] = [];
    if (map.size === 0) {
      expect(strays).toEqual([]);
      return;
    }
    const compiled = [...map.entries()].map(([table, records]) => ({
      table,
      patterns: writePatterns(table),
      allowed: new Set(records.flatMap((r) => r.files)),
    }));
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      const path = relative(ROOT, file).split(sep).join('/');
      for (const { table, patterns, allowed } of compiled) {
        if (!patterns.some((p) => p.test(text))) continue;
        if (!allowed.has(path)) strays.push(`${path} writes ${table}`);
      }
    }
    expect(strays).toEqual([]);
  });
});
