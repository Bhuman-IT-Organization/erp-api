// Applies every forward-only DDL file in prisma/sql/ to the local database, in filename order.
//
// ADR-0036: erp-api has no migration mechanism until Phase 5, and DB-01 forbids authoring
// prisma/schema.prisma by hand — so a table the new system creates is defined by a numbered SQL
// file here and applied with `prisma db execute`, which ships with the pinned Prisma CLI (no new
// dependency, ADR-0017). Afterwards `corepack yarn db:pull` re-introspects, so the mirror still
// describes the database rather than anyone's intent.
//
// Every statement is `CREATE TABLE IF NOT EXISTS`, or a guarded `ADD COLUMN` / `ADD INDEX` that runs
// only when information_schema says the column or index is missing (ADR-0050, never DROP, MODIFY,
// CHANGE or RENAME), so a second run is a no-op. A file that has been applied is never edited; a
// correction is a new, higher-numbered file.
//
// The environment is the same one `db:pull` uses (`../erp-infra/env/local/api.host.env` through
// dotenv-cli), so this can no more point at a shared database than `db:pull` can.
//
// Usage: node scripts/apply-node-schema.mjs        (exposed as `corepack yarn db:apply`)
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sqlDir = join(root, 'prisma', 'sql');
const envFile = join(root, '..', 'erp-infra', 'env', 'local', 'api.host.env');

/** NNN-<slug>.sql — the shape ADR-0036 fixes, so the order is the number and nothing else. */
const DDL_FILE = /^\d{4}-[a-z0-9]+(?:-[a-z0-9]+)*\.sql$/;

if (!existsSync(sqlDir)) {
  console.log('db:apply: prisma/sql does not exist; nothing to apply');
  process.exit(0);
}

if (!existsSync(envFile)) {
  console.error(
    `db:apply: ${envFile} not found — bring the local stack up first (node ../erp-infra/scripts/local-up.mjs)`,
  );
  process.exit(1);
}

const files = readdirSync(sqlDir).sort();
const bad = files.filter((name) => !DDL_FILE.test(name));
if (bad.length > 0) {
  console.error(`db:apply: not NNN-<slug>.sql: ${bad.join(', ')} (ADR-0036)`);
  process.exit(1);
}

if (files.length === 0) {
  console.log('db:apply: no DDL files in prisma/sql');
  process.exit(0);
}

for (const name of files) {
  const file = relative(root, join(sqlDir, name));
  const result = spawnSync(
    'yarn',
    [
      'dotenv',
      '-e',
      relative(root, envFile),
      '--',
      'prisma',
      'db',
      'execute',
      '--schema',
      'prisma/schema.prisma',
      '--file',
      file,
    ],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' },
  );
  if (result.status !== 0) {
    console.error(`db:apply: ${name} failed (exit ${String(result.status)})`);
    process.exit(result.status === null ? 1 : result.status);
  }
  console.log(`db:apply: applied ${name}`);
}

console.log(`db:apply: ${String(files.length)} file(s) applied`);
