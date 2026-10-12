/**
 * Loaders for the table-ownership registers and the model→table map.
 *
 * There are **two** registers and the guard reads their union (ADR-0035):
 *
 * - `prisma/ownership.json` — the legacy register. Generated from the client's schema dump, so it
 *   holds exactly the tables we inherited. Never hand-edited.
 * - `prisma/ownership-node.json` — the register for tables the new system *creates*
 *   (`tblidentity_audit` is the first, ADR-0034 decision 3). Hand-maintained,
 *   because a record for a table the dump does not contain is reported `ORPHAN` and deleted by the
 *   next regeneration of the legacy register. Every record carries `decided_by` and `decided_on`: a table we created
 *   has no attribution ambiguity, so it is never `unattributed` and never an open violation — the
 *   `--allow-open` ratchet is counted over the legacy register alone.
 *
 * Both live in `prisma/` and are the only copies: ownership decisions are made by editing them here
 * (see README "Database mirror and ownership guard").
 *
 * A table present in **both** files fails the load. It is not a precedence question: it means one
 * of the two registers is wrong, and the guard must not start on a register it cannot trust.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

/** One register record. Extra fields (evidence, confidence, notes) are carried through untouched. */
export const ownershipRecordSchema = z.object({ table: z.string(), owner: z.string() }).loose();

export type OwnershipRecord = z.infer<typeof ownershipRecordSchema>;

/** table -> owner */
export type OwnershipMap = ReadonlyMap<string, string>;

// From src/shared/db/ and from dist/shared/db/ this resolves to <repo>/prisma/...
const DEFAULT_OWNERSHIP_FILE = new URL('../../../prisma/ownership.json', import.meta.url);
const DEFAULT_NODE_OWNERSHIP_FILE = new URL('../../../prisma/ownership-node.json', import.meta.url);
const DEFAULT_MODEL_TABLE_MAP_FILE = new URL(
  '../../../prisma/model-table-map.json',
  import.meta.url,
);

function readJson(file: URL): unknown {
  return JSON.parse(readFileSync(file, 'utf8'));
}

/** Reads one register file into a map; throws on an invalid record or a table listed twice. */
function readRegister(file: URL, label: string): Map<string, string> {
  const records = z.array(ownershipRecordSchema).parse(readJson(file));
  const map = new Map<string, string>();
  for (const record of records) {
    if (map.has(record.table)) {
      throw new Error(`${label} lists table "${record.table}" more than once`);
    }
    map.set(record.table, record.owner);
  }
  return map;
}

/**
 * The legacy register unioned with the node register (ADR-0035). A table present in both is an
 * error, not a merge: the two registers must stay disjoint, because a table is either one the
 * client's system created or one ours did, never both. A missing node register is an error too —
 * silently treating it as empty would make the guard refuse every write to a table we created,
 * which looks like a bug in the module rather than a missing file.
 */
export function loadOwnership(
  legacyFile: URL = DEFAULT_OWNERSHIP_FILE,
  nodeFile: URL = DEFAULT_NODE_OWNERSHIP_FILE,
): OwnershipMap {
  const legacy = readRegister(legacyFile, 'prisma/ownership.json');
  const node = readRegister(nodeFile, 'prisma/ownership-node.json');
  for (const [table, owner] of node) {
    if (legacy.has(table)) {
      throw new Error(
        `table "${table}" is in both prisma/ownership.json and prisma/ownership-node.json; ` +
          'the two registers must be disjoint (ADR-0035) — remove the wrong record',
      );
    }
    legacy.set(table, owner);
  }
  return legacy;
}

/**
 * Reads model -> table for the models whose Prisma name differs from their table (`@@map`).
 * `db pull` names a model exactly as its table when that is a valid identifier, so the map is
 * usually empty; resolve a table with `map.get(model) ?? model`.
 */
export function loadModelTableMap(
  file: URL = DEFAULT_MODEL_TABLE_MAP_FILE,
): ReadonlyMap<string, string> {
  const record = z.record(z.string(), z.string()).parse(readJson(file));
  return new Map(Object.entries(record));
}
