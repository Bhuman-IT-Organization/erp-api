#!/usr/bin/env node
/**
 * Copies the Prisma client's runtime files into dist/ after tsc.
 *
 * `prisma generate` emits TypeScript into src/shared/db/generated/ plus files tsc does not
 * touch: the query engine (`*.node`) and, depending on the generator version, `schema.prisma`
 * or `*.wasm`. The generated client resolves the engine relative to its own directory, so
 * every non-.ts file must sit at the same relative path under dist/shared/db/generated/.
 *
 * Usage: node scripts/copy-generated-runtime.mjs   (part of `yarn build`)
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src', 'shared', 'db', 'generated');
const DST = join(ROOT, 'dist', 'shared', 'db', 'generated');

if (!existsSync(SRC)) {
  console.error(
    `copy-generated-runtime: ${relative(ROOT, SRC)} is missing — run corepack yarn db:generate first`,
  );
  process.exit(1);
}

let copied = 0;
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const from = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(from);
      continue;
    }
    if (entry.name.endsWith('.ts')) continue;
    const to = join(DST, relative(SRC, from));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(from, to);
    console.log(`copied ${relative(ROOT, from)} -> ${relative(ROOT, to)}`);
    copied += 1;
  }
};
walk(SRC);

if (copied === 0) {
  console.error(
    'copy-generated-runtime: no runtime file found under src/shared/db/generated (expected the query engine)',
  );
  process.exit(1);
}
