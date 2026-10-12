import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadOwnership } from '../ownership.js';

/** `@total-typescript/ts-reset` types JSON.parse as unknown (TS-02: parse, never assert). */
const recordsSchema = z.array(z.object({ table: z.string(), owner: z.string() }).loose());
const readRecords = (file: URL) => recordsSchema.parse(JSON.parse(readFileSync(file, 'utf8')));

/** Throwaway register files, so the union can be exercised without a committed fixture. */
const scratch = mkdtempSync(join(tmpdir(), 'erp-ownership-'));
const register = (records: unknown): URL => {
  const file = join(scratch, `${randomUUID()}.json`);
  writeFileSync(file, JSON.stringify(records));
  return pathToFileURL(file);
};

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const LEGACY = new URL('../../../../prisma/ownership.json', import.meta.url);
const NODE = new URL('../../../../prisma/ownership-node.json', import.meta.url);

describe('loadOwnership unions the two registers (ADR-0035)', () => {
  it('reads a table from each file into one map', () => {
    const map = loadOwnership(
      register([{ table: 'tblinherited', owner: 'perfex-core' }]),
      register([{ table: 'tblours', owner: 'node' }]),
    );
    expect(map.size).toBe(2);
    expect(map.get('tblinherited')).toBe('perfex-core');
    expect(map.get('tblours')).toBe('node');
  });

  it('refuses a table listed in both registers, naming the table and both files', () => {
    expect(() =>
      loadOwnership(
        register([{ table: 'tblboth', owner: 'perfex-core' }]),
        register([{ table: 'tblboth', owner: 'node' }]),
      ),
    ).toThrow(/tblboth.*ownership\.json.*ownership-node\.json/s);
  });

  it('refuses a table listed twice inside one register, naming which file', () => {
    expect(() =>
      loadOwnership(
        register([
          { table: 'tbldup', owner: 'perfex-core' },
          { table: 'tbldup', owner: 'node' },
        ]),
        register([]),
      ),
    ).toThrow(/prisma\/ownership\.json lists table "tbldup" more than once/);
    expect(() =>
      loadOwnership(
        register([]),
        register([
          { table: 'tbldup', owner: 'node' },
          { table: 'tbldup', owner: 'node' },
        ]),
      ),
    ).toThrow(/prisma\/ownership-node\.json lists table "tbldup" more than once/);
  });

  it('treats a missing node register as an error, never as a silent empty map', () => {
    // A silently empty node register would make the guard refuse every write to a table we
    // created, which reads as a bug in the module rather than as a missing file.
    expect(() =>
      loadOwnership(
        register([{ table: 'tbla', owner: 'perfex-core' }]),
        new URL('file:///nope/absent.json'),
      ),
    ).toThrow();
  });

  it('refuses a record that is not the documented shape', () => {
    expect(() => loadOwnership(register([{ table: 'tbla' }]), register([]))).toThrow();
    expect(() => loadOwnership(register([{ owner: 'node' }]), register([]))).toThrow();
    expect(() => loadOwnership(register({ table: 'tbla', owner: 'node' }), register([]))).toThrow();
  });
});

describe('the committed node register, today', () => {
  const records = readRecords(NODE);

  it('holds exactly tblidentity_audit and the three mail tables (plan 04.3-04), owned by node', () => {
    expect(records.map((r) => r.table)).toEqual([
      'tblidentity_audit',
      'tblmail_sent_emails',
      'tblmail_template_versions',
      'tblmail_templates',
    ]);
    expect(records.every((r) => r.owner === 'node')).toBe(true);
  });

  it('carries decided_by and decided_on on every record (ADR-0035 Enforcement)', () => {
    // A table we created has no attribution ambiguity, so this file may never accumulate the
    // nulls the generated legacy register is allowed to have.
    for (const record of records) {
      expect(typeof record.decided_by).toBe('string');
      expect(record.decided_by).not.toBe('');
      expect(record.decided_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('names no table that the legacy register also names', () => {
    const legacyTables = new Set(readRecords(LEGACY).map((r) => r.table));
    for (const record of records) expect(legacyTables.has(record.table)).toBe(false);
  });

  it('is what the default loader reads, alongside the whole legacy register', () => {
    const map = loadOwnership();
    expect(map.get('tblidentity_audit')).toBe('node');
    expect(map.size).toBeGreaterThanOrEqual(403);
  });
});
