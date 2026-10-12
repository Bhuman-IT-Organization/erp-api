// Normalises the freshly introspected prisma/schema.prisma so it validates.
//
// Why this exists: `prisma db pull` emits a relation field pointing at an `@@ignore`d model
// WITHOUT the field-level `@ignore` the validator then demands, so `prisma format` fails with
// P1012 ("The relation field `x` on Model `y` must specify the `@ignore` attribute, because the
// model it is pointing to is marked ignored"). The attributes were added by hand once (plan
// 01.2-04) and every regeneration since would have dropped them — `check:db` validates the
// COMMITTED mirror, never a fresh pull, so the broken pipeline stayed invisible until plan
// 03.1-05 needed to create a table (ADR-0036 decision 3 refreshes the mirror by introspection).
//
// What it does: reads the schema, collects every model carrying `@@ignore`, then appends
// `@ignore` to any field whose type is one of those models and does not already carry it.
// Nothing else is touched — this is a normalisation of generated output, not an edit of it
// (DB-01: the mirror is introspected, never authored). Idempotent: a second run changes nothing.
//
// Runs between `prisma db pull` and `prisma format` in the `db:pull` chain.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = join(root, 'prisma', 'schema.prisma');

const original = readFileSync(schemaPath, 'utf8');
const eol = original.includes('\r\n') ? '\r\n' : '\n';
const lines = original.replace(/\r\n/g, '\n').split('\n');

/** Model names carrying `@@ignore`, i.e. the models a relation field may not point at unmarked. */
const ignoredModels = new Set();
let current = null;
for (const line of lines) {
  const opened = /^model\s+(\S+)\s*\{/.exec(line);
  if (opened) {
    current = opened[1];
    continue;
  }
  if (line.startsWith('}')) {
    current = null;
    continue;
  }
  if (current && line.trim() === '@@ignore') ignoredModels.add(current);
}

if (ignoredModels.size === 0) {
  console.log('fix-ignored-relations: no @@ignore model in the schema; nothing to normalise');
  process.exit(0);
}

/**
 * A field line is `  name  Type  …`. It needs `@ignore` when `Type` (minus `[]` and `?`) is an
 * ignored model and the line does not already carry the attribute. Scalars, comments, block
 * attributes (`@@…`) and the `}` terminator are skipped by construction.
 */
const fixed = [];
let added = 0;
for (const line of lines) {
  const field = /^(\s+)(\w+)(\s+)(\w+)(\[\]|\?)?(\s.*)?$/.exec(line);
  const isBlockAttribute = line.trim().startsWith('@@') || line.trim().startsWith('//');
  if (!field || isBlockAttribute) {
    fixed.push(line);
    continue;
  }
  const [, indent, name, gap, type, modifier = '', rest = ''] = field;
  if (!ignoredModels.has(type) || /(^|\s)@ignore(\s|$)/.test(rest)) {
    fixed.push(line);
    continue;
  }
  fixed.push(`${indent}${name}${gap}${type}${modifier}${rest} @ignore`.trimEnd());
  added += 1;
}

if (added === 0) {
  console.log(
    `fix-ignored-relations: ${ignoredModels.size} ignored model(s), every relation field already marked`,
  );
  process.exit(0);
}

writeFileSync(schemaPath, fixed.join(eol), 'utf8');
console.log(
  `fix-ignored-relations: added @ignore to ${added} relation field(s) pointing at ${ignoredModels.size} ignored model(s)`,
);
