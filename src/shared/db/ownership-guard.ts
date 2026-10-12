/**
 * Ownership guard: a Prisma client extension that rejects every write to a table whose owner in
 * `prisma/ownership.json` is not `node`.
 *
 * This is the "second line of defence" of erp-docs 03-architecture/05-strangler-fig-migration.md
 * (one writer per table; ADR-0029): CI's schema/ownership check is the first line, this runtime hook catches what
 * slips through in dev/uat. Today no table is owned by `node`, so every write is rejected.
 *
 * Raw SQL rule (T-1.2-21, review WR-01): a `$queryRaw*` statement must both start with a read
 * keyword and contain no write keyword anywhere outside a string literal. The leading-keyword
 * check alone is not enough on MySQL 8, which executes `WITH ... DELETE` and (8.0.19+)
 * `EXPLAIN ANALYZE UPDATE|DELETE`. False positives (a column literally named `update`) are
 * accepted for a development guard; the lint rule confining raw SQL to `infrastructure/sql/`
 * (Phase 4) is the structural control.
 *
 * Nested writes (review WR-02): `create`/`update`/`upsert` payloads may write related models
 * (`data: { relation: { create: ... } }`). Every model reached through a nested write verb is
 * resolved through the client's runtime data model and checked like a top-level write, so a
 * node-owned model cannot be used as a door into a perfex-owned one.
 *
 * Raw writes (plan 03.1-05, ADR-0029 + ADR-0034): `$executeRaw*` used to be refused for every
 * table, owned or not. `tblstaff_permissions` has no primary key, so Prisma `@@ignore`s it and
 * gives it no typed delegate — the register can hand it to `node` and it still would not be
 * writable. So the raw branch now reads the owner exactly as the model branch does: the target
 * tables are parsed out of the statement by {@link tablesWrittenBy} and every one of them must be
 * `node`-owned.
 *
 * {@link tablesWrittenBy} is deliberately narrow and fails closed. It understands one statement of
 * the form `INSERT [IGNORE] INTO t`, `REPLACE INTO t`, `UPDATE t[, t2]` or `DELETE FROM t[, t2]`,
 * with optional backticks around each name, anchored at the start of the text. The target list must
 * be followed immediately by the verb's own keyword (review WR-01 of Phase 3.1): `SET` after
 * `UPDATE`; `WHERE` or the end of the text after `DELETE FROM`; `(`, `VALUE[S]`, `SET` or `SELECT`
 * after `INSERT`/`REPLACE`. Anything else there — an alias, `AS`, a `JOIN`, `USING`, `PARTITION`,
 * `LIMIT`/`ORDER BY`, a comma after an alias — means the engine may write a table the parser never
 * listed (`UPDATE a p JOIN b c … SET c.x`), so it yields no table and is refused. Everything else —
 * a leading comment, a schema-qualified or computed target, a second statement after a `;`, and in
 * particular the `WITH … DELETE` and `EXPLAIN ANALYZE UPDATE` shapes this docblock already raises
 * for `$queryRaw*` — yields no table and is therefore refused. What it deliberately does not do:
 * understand a table named by a subquery, a `DELETE … USING`, a stored procedure `CALL`, or any
 * DDL. Those stay refused; a module that needs one is a design conversation, not a regex.
 *
 * Recorded co-writes (ADR-0050, plan 04.6-03): where a table's owner is not `node`, `decide()`
 * consults the co-write map (`prisma/ownership-cowrites.json`, loaded by `loadCoWrites`) and admits
 * the write only through a record. A typed write is admitted when it is the TOP-LEVEL model of the
 * call (a nested write into a co-write table is never admitted), its operation maps to the record's
 * (`create`, `createMany`, `createManyAndReturn` to insert; `update`, `updateMany`,
 * `updateManyAndReturn` to update; `upsert`, `delete` and `deleteMany` never), the record is not
 * raw, and every key of `args.data` (of each element for an array) is a listed column or the record
 * lists `'*'`. A `$executeRaw*` is admitted when its one parsed statement writes exactly that table,
 * a `raw: true` record exists for it, and {@link rawVerbOf} equals the record's operation; `REPLACE
 * INTO` and `ON DUPLICATE KEY UPDATE` are upserts and never admitted. Without a co-write map the
 * guard behaves exactly as before. Which rows a record may touch is the owning repository's job.
 */
import { Prisma } from './generated/client.js';
import { coWriteFor, type CoWriteMap } from './ownership-cowrites.js';
import type { OwnershipMap } from './ownership.js';

export const NODE_OWNER = 'node' as const;

/** Prisma model operations that write. Everything else on a model is a read. */
export const WRITE_OPERATIONS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
]);

/** Leading keywords a `$queryRaw*` statement may start with. `EXPLAIN ANALYZE` executes. */
export const READ_ONLY_SQL = /^\s*(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN(?!\s+ANALYZE)|WITH)\b/i;

/** A keyword that, anywhere outside a literal, means the statement can change data or schema. */
export const WRITE_KEYWORD =
  /\b(INSERT|UPDATE|DELETE|REPLACE|MERGE|TRUNCATE|ALTER|DROP|CREATE|RENAME|LOAD|SET|CALL|GRANT|REVOKE)\b/i;

/** Replaces single-, double- and backtick-quoted literals with `''` so keywords inside them are ignored. */
export function stripLiterals(sql: string): string {
  return sql.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`[^`]*`/g, "''");
}

/** True when `sql` starts with a read keyword and has no write keyword outside a literal. */
export function isReadOnlySql(sql: string): boolean {
  return READ_ONLY_SQL.test(sql) && !WRITE_KEYWORD.test(stripLiterals(sql));
}

/** Nested keys that write rows of the related model. */
export const NESTED_WRITE_KEYS: ReadonlySet<string> = new Set([
  'create',
  'createMany',
  'connectOrCreate',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
]);

/**
 * Nested keys that only change which rows are linked. They write the model that holds the
 * foreign key: this model when the relation's `fields` are on it, the related model otherwise.
 */
export const NESTED_LINK_KEYS: ReadonlySet<string> = new Set(['connect', 'disconnect', 'set']);

const RAW_TABLE = '<raw>';

/** One table name in a raw statement: a bare identifier or a backtick-quoted one. */
const RAW_IDENTIFIER = '(?:`[^`]+`|[A-Za-z_][A-Za-z0-9_$]*)';

/**
 * The only raw statement shapes the guard parses. Anchored at the start of the text, so a leading
 * comment, `WITH`, `EXPLAIN` or anything else never matches and the statement is refused. Group 1
 * is the verb, group 2 the target list.
 */
export const RAW_WRITE_STATEMENT = new RegExp(
  String.raw`^\s*(INSERT\s+(?:IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+(${RAW_IDENTIFIER}(?:\s*,\s*${RAW_IDENTIFIER})*)`,
  'i',
);

/**
 * What must follow the target list, per verb (review WR-01 of Phase 3.1). Anything else — an
 * alias, `AS`, a `JOIN`, `USING`, `PARTITION`, `LIMIT` — fails closed.
 */
const RAW_TERMINATOR = {
  update: /^\s+SET\b/i,
  delete: /^(?:\s+WHERE\b|\s*$)/i,
  insert: /^(?:\s*\(|\s+(?:VALUES?|SET|SELECT)\b)/i,
} as const;

/** The terminator for a captured verb; `INSERT [IGNORE] INTO` and `REPLACE INTO` share one. */
function terminatorFor(verb: string): RegExp {
  if (/^UPDATE$/i.test(verb)) return RAW_TERMINATOR.update;
  if (/^DELETE\b/i.test(verb)) return RAW_TERMINATOR.delete;
  return RAW_TERMINATOR.insert;
}

/** Replaces single- and double-quoted literals with `''`, keeping backtick identifiers intact. */
export function stripStringLiterals(sql: string): string {
  return sql.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
}

/**
 * The tables a raw write statement writes, or `[]` when the statement is not one the parser
 * understands. `[]` means refused: the guard fails closed on anything it cannot read.
 */
export function tablesWrittenBy(sql: string): string[] {
  return parseRawWrite(sql)?.tables ?? [];
}

/**
 * The verb of a raw write statement, or `undefined` when {@link tablesWrittenBy} would refuse it
 * (the same single-statement and terminator checks). `REPLACE INTO` reads as `insert`; the
 * co-write branch refuses it separately, because it deletes the row it replaces.
 */
export function rawVerbOf(sql: string): 'insert' | 'update' | 'delete' | undefined {
  const verb = parseRawWrite(sql)?.verb;
  if (verb === undefined) return undefined;
  if (/^UPDATE$/i.test(verb)) return 'update';
  if (/^DELETE\b/i.test(verb)) return 'delete';
  return 'insert';
}

/** One parsed raw write: its verb as written and its target tables; `undefined` fails closed. */
function parseRawWrite(sql: string): { verb: string; tables: string[] } | undefined {
  const stripped = stripStringLiterals(sql);
  // More than one statement: the parser reads only the first, so refuse the whole thing.
  if (/;\s*\S/.test(stripped)) return undefined;
  const match = RAW_WRITE_STATEMENT.exec(stripped);
  const verb = match?.[1];
  const list = match?.[2];
  if (match === null || verb === undefined || list === undefined) return undefined;
  // The table list must be followed immediately by the verb's own keyword. A qualified target
  // (`db.tbl`), an alias, a JOIN or USING means the parser did not read what the engine will, so
  // refuse rather than guess (WR-01).
  const rest = stripped.slice(match[0].length);
  if (!terminatorFor(verb).test(rest)) return undefined;
  return { verb, tables: list.split(',').map((name) => name.trim().replace(/^`|`$/g, '')) };
}

export class OwnershipViolationError extends Error {
  override readonly name = 'OwnershipViolationError';

  constructor(
    readonly table: string,
    readonly operation: string,
    readonly owner: string | undefined,
  ) {
    super(
      `Write "${operation}" to table "${table}" rejected: owner is ${
        owner === undefined ? 'not in prisma/ownership.json' : `"${owner}"`
      }, not "node". A module writes only the tables it owns (ADR-0029); see erp-docs 03-architecture/05-strangler-fig-migration.md.`,
    );
  }
}

export type Decision =
  { allowed: true } | { allowed: false; table: string; owner: string | undefined };

/** Where a relation field points and which side stores the foreign key. */
export interface RelationTarget {
  readonly model: string;
  /** True when the foreign key columns live on the model that declares the field. */
  readonly foreignKeyOnThisSide: boolean;
}

/** Resolves `model.field` to the related model, or `undefined` when `field` is not a relation. */
export type RelationLookup = (model: string, field: string) => RelationTarget | undefined;

export interface DecideInput {
  readonly model: string | undefined;
  readonly operation: string;
  readonly args: unknown;
  readonly ownership: OwnershipMap;
  readonly modelToTable: ReadonlyMap<string, string>;
  readonly relations: RelationLookup;
  /** The recorded co-writes (ADR-0050); absent means no exception, the behaviour before 4.6. */
  readonly coWrites?: CoWriteMap;
}

const ALLOWED: Decision = { allowed: true };

/** The co-write operation a typed Prisma write maps to; `upsert` and the deletes map to none. */
const CO_WRITE_OPERATION: ReadonlyMap<string, 'insert' | 'update'> = new Map([
  ['create', 'insert'],
  ['createMany', 'insert'],
  ['createManyAndReturn', 'insert'],
  ['update', 'update'],
  ['updateMany', 'update'],
  ['updateManyAndReturn', 'update'],
]);

/** True when a recorded co-write admits this top-level typed write (ADR-0050). */
function admitsTypedCoWrite(
  coWrites: CoWriteMap | undefined,
  table: string,
  operation: string,
  args: unknown,
): boolean {
  const coOperation = CO_WRITE_OPERATION.get(operation);
  if (coWrites === undefined || coOperation === undefined || !isRecord(args)) return false;
  const rows = asList(args.data);
  if (rows.length === 0) return false;
  const keys = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return coWriteFor(coWrites, table, coOperation, keys) !== undefined;
}

/** True when a `raw: true` record admits this raw statement; it must write exactly one table (ADR-0050). */
function admitsRawCoWrite(
  coWrites: CoWriteMap | undefined,
  tables: readonly string[],
  sql: string,
): boolean {
  const [table] = tables;
  if (coWrites === undefined || table === undefined || tables.length !== 1) return false;
  const stripped = stripStringLiterals(sql);
  // Upserts: REPLACE deletes the row it replaces, ON DUPLICATE KEY UPDATE updates on insert.
  if (/^\s*REPLACE\b/i.test(stripped) || /\bON\s+DUPLICATE\s+KEY\b/i.test(stripped)) return false;
  const verb = rawVerbOf(sql);
  return coWrites.get(table)?.some((r) => r.raw && r.operation === verb) === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asList(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  return isRecord(value) ? [value] : [];
}

/** Best-effort extraction of the SQL text from `$queryRaw*` arguments (string, Sql or template). */
export function extractSql(args: unknown): string {
  if (typeof args === 'string') return args;
  if (Array.isArray(args) && typeof args[0] === 'string') return args[0];
  if (isRecord(args)) {
    if (typeof args.sql === 'string') return args.sql;
    const strings: unknown = args.strings;
    if (Array.isArray(strings) && strings.every((s) => typeof s === 'string')) {
      return strings.join(' ? ');
    }
  }
  return '';
}

/**
 * Walks a create/update payload of `model` and appends every model written through a nested
 * relation verb, depth first, in the order Prisma would reach them.
 */
export function nestedWriteModels(
  model: string,
  data: unknown,
  relations: RelationLookup,
  out: string[] = [],
): string[] {
  for (const item of asList(data)) {
    for (const [field, value] of Object.entries(item)) {
      if (!isRecord(value)) continue;
      const keys = Object.keys(value);
      const writes = keys.some((k) => NESTED_WRITE_KEYS.has(k));
      const links = keys.some((k) => NESTED_LINK_KEYS.has(k));
      if (!writes && !links) continue;
      const target = relations(model, field);
      if (target === undefined) continue; // a scalar or Json column, not a relation
      if (writes || !target.foreignKeyOnThisSide) out.push(target.model);
      // Descend into the payloads that may themselves carry nested writes.
      nestedWriteModels(target.model, value.create, relations, out);
      for (const c of asList(value.connectOrCreate)) {
        nestedWriteModels(target.model, c.create, relations, out);
      }
      for (const u of asList(value.update)) {
        // To-many (and to-one with `where`) use `{ where, data }`; a bare to-one update is the data itself.
        const wrapped =
          isRecord(u.data) && Object.keys(u).every((k) => k === 'where' || k === 'data');
        nestedWriteModels(target.model, wrapped ? u.data : u, relations, out);
      }
      for (const u of asList(value.updateMany)) {
        nestedWriteModels(target.model, u.data, relations, out);
      }
      for (const u of asList(value.upsert)) {
        nestedWriteModels(target.model, u.create, relations, out);
        nestedWriteModels(target.model, u.update, relations, out);
      }
    }
  }
  return out;
}

/** Every model a top-level write touches: the model itself, then each nested-write target. */
export function writtenModels(
  model: string,
  operation: string,
  args: unknown,
  relations: RelationLookup,
): string[] {
  const out = [model];
  if (!isRecord(args)) return out;
  if (operation === 'upsert') {
    nestedWriteModels(model, args.create, relations, out);
    nestedWriteModels(model, args.update, relations, out);
  } else {
    nestedWriteModels(model, args.data, relations, out);
  }
  return out;
}

/** Pure decision: allowed or not, and why. No I/O, so it is unit-tested without a database. */
export function decide(input: DecideInput): Decision {
  const { model, operation, args, ownership, modelToTable, relations, coWrites } = input;
  if (operation === '$executeRaw' || operation === '$executeRawUnsafe') {
    const sql = extractSql(args);
    const tables = tablesWrittenBy(sql);
    // Unparseable stays refused — the parser is the allowlist, not a best effort.
    if (tables.length === 0) return { allowed: false, table: RAW_TABLE, owner: undefined };
    for (const table of tables) {
      const owner = ownership.get(table);
      if (owner !== NODE_OWNER && !admitsRawCoWrite(coWrites, tables, sql)) {
        return { allowed: false, table, owner };
      }
    }
    return ALLOWED;
  }
  if (operation === '$queryRaw' || operation === '$queryRawUnsafe') {
    return isReadOnlySql(extractSql(args))
      ? ALLOWED
      : { allowed: false, table: RAW_TABLE, owner: undefined };
  }
  if (model !== undefined && WRITE_OPERATIONS.has(operation)) {
    const written = writtenModels(model, operation, args, relations);
    for (const [index, writtenModel] of written.entries()) {
      const table = modelToTable.get(writtenModel) ?? writtenModel;
      const owner = ownership.get(table);
      // Only the top-level model (index 0) may be a co-write; a nested one never is (ADR-0050).
      const coWrite = index === 0 && admitsTypedCoWrite(coWrites, table, operation, args);
      if (owner !== NODE_OWNER && !coWrite) return { allowed: false, table, owner };
    }
    return ALLOWED;
  }
  return ALLOWED;
}

/** The subset of Prisma's runtime data model the guard needs. */
interface RuntimeDataModel {
  readonly models: Readonly<
    Record<
      string,
      {
        readonly fields: readonly {
          readonly name: string;
          readonly kind: string;
          readonly type: string;
          readonly relationFromFields?: readonly string[];
        }[];
      }
    >
  >;
}

function isRuntimeDataModel(value: unknown): value is RuntimeDataModel {
  return isRecord(value) && isRecord(value.models);
}

/**
 * Builds a relation lookup from a client's runtime data model (the generated `prisma-client`
 * output exposes no `Prisma.dmmf`; the client instance carries the model as `_runtimeDataModel`).
 * Throws when the model is not where this Prisma version puts it: the guard must not start blind.
 */
export function relationLookupFromClient(client: unknown): RelationLookup {
  const candidate: unknown = isRecord(client) ? client._runtimeDataModel : undefined;
  if (!isRuntimeDataModel(candidate)) {
    throw new Error(
      'ownership guard: PrismaClient exposes no _runtimeDataModel; nested relation writes cannot be resolved',
    );
  }
  return relationLookupFromDataModel(candidate);
}

/** Same as {@link relationLookupFromClient} for an already-extracted data model (unit tests). */
export function relationLookupFromDataModel(dataModel: RuntimeDataModel): RelationLookup {
  const index = new Map<string, RelationTarget>();
  for (const [modelName, model] of Object.entries(dataModel.models)) {
    for (const field of model.fields) {
      if (field.kind !== 'object') continue;
      index.set(`${modelName}.${field.name}`, {
        model: field.type,
        foreignKeyOnThisSide: (field.relationFromFields?.length ?? 0) > 0,
      });
    }
  }
  return (model, field) => index.get(`${model}.${field}`);
}

/** The extension passed to `PrismaClient.$extends`; throws before the query reaches the engine. */
export function createOwnershipExtension(
  ownership: OwnershipMap,
  modelToTable: ReadonlyMap<string, string>,
  coWrites?: CoWriteMap,
) {
  return Prisma.defineExtension((client) => {
    const relations = relationLookupFromClient(client);
    return client.$extends({
      name: 'ownership-guard',
      query: {
        $allOperations({ model, operation, args, query }) {
          const decision = decide({
            model,
            operation,
            args,
            ownership,
            modelToTable,
            relations,
            ...(coWrites === undefined ? {} : { coWrites }),
          });
          if (!decision.allowed) {
            throw new OwnershipViolationError(decision.table, operation, decision.owner);
          }
          return query(args);
        },
      },
    });
  });
}
