/**
 * Loader for the recorded co-write register (ADR-0050, plan 04.6-03).
 *
 * There are three registers. `prisma/ownership.json` (generated, the legacy tables) and
 * `prisma/ownership-node.json` (the tables Node creates) say who OWNS a table; the guard unions them
 * (ADR-0035). `prisma/ownership-cowrites.json` says nothing about ownership: each record is a
 * temporary, reviewed exception that lets one Node module write named columns of a table it does
 * not own, from named files, until the slice that migrates the table deletes the record. All three
 * live in `prisma/` and are the only copies; they are edited here.
 *
 * Why the co-write register is not disjoint from the ownership registers: every co-write table IS in
 * the legacy register, owned by its Perfex module; that is the point of the record. What the loader
 * refuses is a record for a table the union gives to `node` (Node already writes it, so a record
 * would only hide a wrong register) and a record for a table neither register names (a typo would
 * otherwise sit in the register admitting nothing). It also refuses a duplicate (table, operation),
 * `'*'` with `update`, a repeated column, an unknown field and a missing file: the guard must not
 * start on a register it cannot trust.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { OwnershipMap } from './ownership.js';

/** The guard's `NODE_OWNER`; not imported, because the guard imports this file's types. */
const NODE = 'node';

/** One co-write record (ADR-0050 decision 2); strict, so an unknown field fails the load. */
export const coWriteRecordSchema = z.strictObject({
  table: z.string().regex(/^tbl[a-z0-9_]+$/),
  operation: z.enum(['insert', 'update']),
  columns: z.union([z.literal('*'), z.array(z.string().min(1)).min(1)]),
  raw: z.boolean(),
  module: z.string().regex(/^v1\/[a-z-]+$/),
  files: z.array(z.string().regex(/^src\/.+\.ts$/)).min(1),
  decision: z.string().min(1),
  until: z.string().min(1),
  note: z.string().min(1),
});

/** A validated co-write record. */
export type CoWriteRecord = z.infer<typeof coWriteRecordSchema>;

/** table -> its records (at most one per operation). */
export type CoWriteMap = ReadonlyMap<string, readonly CoWriteRecord[]>;

// From src/shared/db/ and from dist/shared/db/ this resolves to <repo>/prisma/...
const DEFAULT_COWRITES_FILE = new URL('../../../prisma/ownership-cowrites.json', import.meta.url);
const FILE_LABEL = 'prisma/ownership-cowrites.json';

/**
 * Reads prisma/ownership-cowrites.json; throws on a bad record, a duplicate (table, operation),
 * '*' with update, duplicate column names, or a table the union of the two ownership registers
 * gives to `node` or does not name at all.
 */
export function loadCoWrites(
  ownership: OwnershipMap,
  file: URL = DEFAULT_COWRITES_FILE,
): CoWriteMap {
  const records = z.array(coWriteRecordSchema).parse(JSON.parse(readFileSync(file, 'utf8')));
  const map = new Map<string, CoWriteRecord[]>();
  const seen = new Set<string>();
  for (const record of records) {
    assertRecord(record, ownership);
    const pair = `${record.table} ${record.operation}`;
    if (seen.has(pair)) {
      throw new Error(
        `${FILE_LABEL}: table "${record.table}" has operation "${record.operation}" more than once`,
      );
    }
    seen.add(pair);
    map.set(record.table, [...(map.get(record.table) ?? []), record]);
  }
  return map;
}

/** Throws when one record breaks a rule the schema cannot express (ADR-0050 decisions 2 and 3). */
function assertRecord({ table, operation, columns }: CoWriteRecord, ownership: OwnershipMap): void {
  const owner = ownership.get(table);
  if (owner === undefined || owner === NODE) {
    const why = owner === undefined ? 'in neither ownership register' : 'owned by node';
    throw new Error(
      `${FILE_LABEL}: table "${table}" is ${why}; a co-write record is only for a table another owner holds (ADR-0050)`,
    );
  }
  if (columns === '*' && operation === 'update') {
    throw new Error(
      `${FILE_LABEL}: table "${table}" uses columns '*' with update; list the columns (ADR-0050)`,
    );
  }
  if (columns !== '*' && new Set(columns).size !== columns.length) {
    throw new Error(`${FILE_LABEL}: table "${table}" lists a column twice`);
  }
}

/**
 * The typed (`raw: false`) record admitting `operation` on `table` for these data keys, or
 * undefined. Every key must be a listed column unless the record lists `'*'`. A raw record never
 * admits a typed write: the guard asks for those by verb, not here. Pure.
 */
export function coWriteFor(
  map: CoWriteMap,
  table: string,
  operation: 'insert' | 'update',
  keys: readonly string[],
): CoWriteRecord | undefined {
  const record = map.get(table)?.find((r) => r.operation === operation && !r.raw);
  if (record === undefined) return undefined;
  const { columns } = record;
  if (columns === '*') return record;
  return keys.every((key) => columns.includes(key)) ? record : undefined;
}
