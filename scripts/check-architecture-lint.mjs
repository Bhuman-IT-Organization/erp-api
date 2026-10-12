// Proves the architecture block in eslint.config.mjs fires (erp-docs 02-coding-rules/05-backend.md BE-03/06/08/09/16/18/20,
// DB-04, ADR-0031, ADR-0049) and the HYGIENE / TEST_HYGIENE objects after it (BE-10 no-console, BE-24). Runs from `check:arch`. It writes one throwaway probe file per ESLint scope INTO src/ or packages/<pkg>/
// (typescript-eslint's projectService only sees files under a tsconfig's `include`, which is why
// packages/contracts/tsconfig.json includes its `__tests__` and the emit moved to tsconfig.build.json), lints them through
// ESLint's Node API, asserts every expected rule id and message tag fires and every permitted construct
// (the negative lines) stays silent, and always removes the probes — in `finally` and on SIGINT.
// It also proves the scopes are disjoint: flat config REPLACES a rule's options per file, so a file
// matched by two scopes would silently lose one scope's entries.
import { ESLint } from 'eslint';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import config from '../eslint.config.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROBE_MODULE = 'zz-lint-probe';
const ARCH_RULES = new Set([
  'no-restricted-imports',
  'no-restricted-syntax',
  '@typescript-eslint/no-magic-numbers',
  // HYGIENE / TEST_HYGIENE (BE-24; no-console is BE-10)
  'no-console',
  'no-debugger',
  'eqeqeq',
  '@eslint-community/eslint-comments/require-description',
  'vitest/no-focused-tests',
  // The typed base, not an architecture rule as such: SF-5's point was that two directories sat
  // outside `strictTypeChecked`, so the checker needs one rule from it to prove the base applies.
  '@typescript-eslint/no-floating-promises',
]);
/**
 * The code-shape rules of `base()` (01-typescript-and-lint TS-08 to TS-18, 04-shared-utilities
 * UTIL-01, QA-06) and D-23. A probe's
 * `expect` may name them; the negative lines keep `ARCH_RULES` only, because a shape rule may fire on a
 * permitted architecture construct (a probe line is not written to be well-shaped).
 */
const SHAPE_RULES = new Set([
  'complexity',
  'max-depth',
  'no-nested-ternary',
  'no-else-return',
  'no-lonely-if',
  'no-await-in-loop',
  '@typescript-eslint/switch-exhaustiveness-check',
  '@typescript-eslint/naming-convention',
  'erp/no-nested-loops',
  'erp/no-query-in-loop',
  'erp/flag-naming',
  'erp/no-generic-filename',
  'erp/require-complexity-note',
  'no-restricted-globals',
  'no-restricted-properties',
  'jsdoc/require-jsdoc',
  'vitest/no-disabled-tests',
]);
/** ESLint reports an unused `eslint-disable` with `ruleId: null` (`linterOptions.reportUnusedDisableDirectives`). */
const UNUSED_DIRECTIVE = 'Unused eslint-disable directive';
/**
 * Files under src/ that no scope claims, by design: the root `src/__tests__/` specs (the whole-app
 * int spec, the test-placement spec) have nothing to enforce — they sit in TEST_HYGIENE only.
 * The specs under `src/integrations/` too (Phase 4.3 PATTERNS M4): an adapter's own specs import
 * the adapter and its fake and read `process.env` to skip, so no restricted scope claims them.
 */
const UNSCOPED_BY_DESIGN = (file) =>
  file.startsWith('src/__tests__/') ||
  (file.startsWith('src/integrations/') && file.endsWith('.spec.ts'));
const UNSCOPED_BY_DESIGN_TEXT = 'src/__tests__/* and src/integrations/**/*.spec.ts';

/**
 * One probe per scope. `lines` is the file; `expect` lists the message tags and rule ids that must
 * appear somewhere in the file; `negative` lists 1-based line numbers on which no architecture rule
 * may report (the constructs that scope permits).
 */
const probes = [
  {
    scope: '1 v1 default',
    path: `src/v1/${PROBE_MODULE}/service/${PROBE_MODULE}.service.ts`,
    lines: [
      "import '../../../shared/events/domain-event.js';", // 1 negative: shared/ is not another module
      "import '../../../shared/resilience/retry.js';", // 2 BE-18
      "import '@prisma/client';", // 3 DB-04
      "import { BadRequestException } from '@nestjs/common';", // 4 BE-09
      "import 'axios';", // 5 BE-18
      "import '../../auth/service/auth.service.js';", // 6 BE-03
      "import '../../../integrations/adapters/x.js';", // 7 BE-16
      'void BadRequestException;',
      "void fetch('x');", // 9 BE-18
      'void globalThis.fetch;', // 10 BE-18
      'void process.env.X;', // 11 BE-06
      'const t = setTimeout(() => undefined, 5000);', // 12 no-magic-numbers
      'void t;',
      "console.log('x');", // 14 no-console (BE-10)
      'debugger;', // 15 no-debugger (BE-24)
      'void (t == null);', // 16 eqeqeq (BE-24)
      '// eslint-disable-next-line no-debugger', // 17 require-description (BE-24) — no `-- reason`
      'debugger;',
      '// eslint-disable-next-line no-var -- unused directive (BE-24)', // 19 reportUnusedDisableDirectives
      'void 0;',
      "void 'staff.members.view';", // 21 ADR-0033: a clean permission name outside its two homes
    ],
    expect: {
      tags: ['BE-03', 'BE-06', 'BE-08', 'BE-09', 'BE-16', 'BE-18', 'DB-04', 'ADR-0033'],
      ruleIds: [
        'no-restricted-imports',
        'no-restricted-syntax',
        '@typescript-eslint/no-magic-numbers',
        'no-console',
        'no-debugger',
        'eqeqeq',
        '@eslint-community/eslint-comments/require-description',
      ],
      unusedDirective: true,
    },
    negative: [1],
  },
  {
    scope: '2 v1 transport',
    path: `src/v1/${PROBE_MODULE}/service/${PROBE_MODULE}.transport.ts`,
    lines: [
      "import '../../../shared/resilience/retry.js';", // 1 negative
      "import '@prisma/client';", // 2 DB-04
      "import '../../auth/model/auth.model.js';", // 3 BE-03
      "void fetch('x');", // 4 negative
      'void process.env.X;', // 5 BE-06
    ],
    expect: {
      tags: ['BE-03', 'BE-06', 'DB-04'],
      ruleIds: ['no-restricted-imports', 'no-restricted-syntax'],
    },
    negative: [1, 4],
  },
  {
    scope: '3 v1 repository',
    path: `src/v1/${PROBE_MODULE}/repository/${PROBE_MODULE}.repository.ts`,
    lines: [
      "import '../../../shared/db/prisma.service.js';", // 1 negative
      "import '../../../shared/resilience/retry.js';", // 2 BE-18
      "import 'got';", // 3 BE-18
      "void fetch('x');", // 4 BE-18
    ],
    expect: { tags: ['BE-18'], ruleIds: ['no-restricted-imports', 'no-restricted-syntax'] },
    negative: [1],
  },
  {
    scope: '4 v1 controller',
    path: `src/v1/${PROBE_MODULE}/controller/${PROBE_MODULE}.controller.ts`,
    lines: [
      "import '../../auth/dto/auth.dto.js';", // 1 BE-03
      'try {', // 2 BE-08
      '  void 0;',
      '} catch {',
      '  void 0;',
      '}',
    ],
    expect: {
      tags: ['BE-03', 'BE-08'],
      ruleIds: ['no-restricted-imports', 'no-restricted-syntax'],
    },
    negative: [],
  },
  {
    scope: '5 v1 unit tests',
    path: `src/v1/${PROBE_MODULE}/__tests__/${PROBE_MODULE}.service.spec.ts`,
    lines: [
      "import '@prisma/client';", // 1 DB-04
      "void fetch('x');", // 2 negative
      'void process.env.X;', // 3 BE-06
      "import { expect, it } from 'vitest';",
      "it.only('focused', () => {", // 5 vitest/no-focused-tests (TEST_HYGIENE, BE-24)
      '  expect(1).toBe(1);',
      '});',
      '// eslint-disable-next-line no-console -- probe: a described directive is permitted (BE-24)', // 8 negative
      "console.log('described');", // 9 negative (disabled by the described directive)
      "it.skip('disabled', () => {", // 10 vitest/no-disabled-tests (D-23)
      '  expect(1).toBe(1);',
      '});',
    ],
    expect: {
      tags: ['BE-06', 'DB-04'],
      ruleIds: [
        'no-restricted-imports',
        'no-restricted-syntax',
        'vitest/no-focused-tests',
        'vitest/no-disabled-tests',
      ],
    },
    negative: [2, 8, 9],
  },
  {
    scope: '6 v1 int specs',
    path: `src/v1/${PROBE_MODULE}/__tests__/${PROBE_MODULE}.repository.int.spec.ts`,
    lines: [
      "import '@prisma/client';", // 1 negative
      "import 'axios';", // 2 BE-18
      "import '../../auth/facade/auth.facade.js';", // 3 BE-03
      'void process.env.DATABASE_URL;', // 4 negative
    ],
    expect: { tags: ['BE-03', 'BE-18'], ruleIds: ['no-restricted-imports'] },
    negative: [1, 4],
  },
  {
    scope: '7 shared',
    path: `src/shared/${PROBE_MODULE}.ts`,
    lines: [
      "import '../v1/auth/index.js';", // 1 BE-20
      "import 'undici';", // 2 BE-18
      'void process.env.X;', // 3 BE-06
      "import { LoggerService } from './logger/logger.service.js';",
      "new LoggerService().log('through the logger');", // 5 negative: LoggerService is the only output (BE-10)
    ],
    expect: {
      tags: ['BE-06', 'BE-18', 'BE-20'],
      ruleIds: ['no-restricted-imports', 'no-restricted-syntax'],
    },
    negative: [5],
  },
  {
    scope: '9 shared specs',
    path: `src/shared/${PROBE_MODULE}.spec.ts`,
    lines: [
      "import '../v1/auth/index.js';", // 1 BE-20
      "import 'undici';", // 2 BE-18
      'void process.env.X;', // 3 negative
    ],
    expect: { tags: ['BE-18', 'BE-20'], ruleIds: ['no-restricted-imports'] },
    negative: [3],
  },
  {
    scope: '12 v1 routes',
    path: `src/v1/${PROBE_MODULE}/${PROBE_MODULE}.routes.ts`,
    lines: [
      "import '../auth/service/auth.service.js';", // 1 BE-03
      "export const PROBE_PERMISSIONS = { view: 'staff.members.view' } as const;", // 2 negative: the module's own permission map (ADR-0033)
    ],
    expect: { tags: ['BE-03'], ruleIds: ['no-restricted-imports'] },
    negative: [2],
  },
  {
    scope: '14 v1 events',
    path: `src/v1/${PROBE_MODULE}/events/published.ts`,
    lines: [
      "import '../../auth/model/auth.model.js';", // 1 BE-03
      "export const PROBE_EVENT = 'probe.thing.happened';", // 2 negative: an event name, not a permission (BE-13)
    ],
    expect: { tags: ['BE-03'], ruleIds: ['no-restricted-imports'] },
    negative: [2],
  },
  {
    scope: '13 @erp/contracts',
    path: 'packages/contracts/src/zz-lint-probe.ts',
    lines: [
      "export const PROBE_CLEAN = 'staff.members.view';", // 1 negative: the catalogue's own home
      "export const PROBE_PERFEX = 'staff.view';", // 2 negative: the only file that may carry a Perfex code
    ],
    expect: { tags: [], ruleIds: [] },
    negative: [1, 2],
  },
  {
    // SF-5: `packages/*/__tests__/**` used to match no configuration object at all, so `eslint .`
    // skipped it — the `it.only` below would have shipped. This probe is the standing proof that
    // the package specs get TEST_HYGIENE, HYGIENE and the typed base, and that they keep scope 13's
    // permission-literal allowance (a mapping spec has to name both halves of a pair).
    scope: '13 @erp/contracts __tests__',
    path: 'packages/contracts/__tests__/zz-lint-probe.spec.ts',
    lines: [
      "import { expect, it } from 'vitest';",
      "export const PROBE_PERFEX = 'staff.view';", // 2 negative: scope 13 may carry a Perfex code
      "it.only('focused', () => {", // 3 vitest/no-focused-tests (TEST_HYGIENE)
      "  console.log('x');", // 4 no-console (HYGIENE, BE-10)
      '  void (PROBE_PERFEX == null);', // 5 eqeqeq (HYGIENE, BE-24)
      '  Promise.resolve(1);', // 6 typed base: no-floating-promises
      '  expect(1).toBe(1);',
      '});',
    ],
    expect: {
      tags: [],
      ruleIds: [
        'vitest/no-focused-tests',
        'no-console',
        'eqeqeq',
        '@typescript-eslint/no-floating-promises',
      ],
    },
    negative: [2],
  },
  {
    // The code-shape rules (base()): every new rule id fires in a v1 file, and the UTIL-03 bans ride
    // inside the scope's own no-restricted-imports (never a second object, RESEARCH Pattern 2).
    scope: '1 v1 default: shape rules',
    path: `src/v1/${PROBE_MODULE}/service/${PROBE_MODULE}.shape.ts`,
    lines: [
      "import 'lodash';", // 1 no-restricted-imports (UTIL-03)
      'export class ZzShape {',
      '  constructor(private readonly repository: { find(id: number): Promise<unknown> }) {}',
      '  async load(ids: readonly number[]): Promise<void> {',
      '    for (const id of ids) {',
      '      await this.repository.find(id);', // 6 erp/no-query-in-loop, no-await-in-loop
      '    }',
      '  }',
      '}',
      'export const ENABLE_X = true;', // 10 erp/flag-naming
      'export function zzNested(rows: readonly (readonly number[])[], x: number): number {',
      '  let s = 0;',
      '  for (const row of rows) {',
      '    for (const cell of row) s += cell;', // 14 erp/no-nested-loops
      '  }',
      '  if (x > 0) {',
      '    if (x > 1) {',
      '      if (x > 2) s += 1;', // 18 max-depth (a third level)
      '    }',
      '  }',
      '  return s;',
      '}',
      'const t = setTimeout(() => undefined, 0);', // 23 no-restricted-globals (TS-13)
      'const u = globalThis.setInterval(() => undefined, 0);', // 24 no-restricted-properties (TS-13)
      'void [t, u];',
      'export function zzComplex(x: number): number {', // 26 complexity (eleven sequential returns)
      '  if (x === 1) return 1;',
      '  if (x === 2) return 2;',
      '  if (x === 3) return 3;',
      '  if (x === 4) return 4;',
      '  if (x === 5) return 5;',
      '  if (x === 6) return 6;',
      '  if (x === 7) return 7;',
      '  if (x === 8) return 8;',
      '  if (x === 9) return 9;',
      '  if (x === 10) return 10;',
      '  if (x === 11) return 11;',
      '  return 0;',
      '}',
      'export const zzTernary = (x: number): number => (x > 0 ? 1 : x < 0 ? -1 : 0);', // 40 no-nested-ternary
      'export function zzElse(x: number): number {',
      '  if (x > 0) {',
      '    return 1;',
      '  } else {', // 44 no-else-return
      '    return 2;',
      '  }',
      '}',
      'export function zzLonely(x: number): number {',
      '  if (x > 0) {',
      '    return 1;',
      '  } else {',
      '    if (x < 0) return -1;', // 52 no-lonely-if
      '  }',
      '  return 0;',
      '}',
      'export type zz_bad_type = number;', // 56 @typescript-eslint/naming-convention (typeLike)
      "export function zzSwitch(k: 'a' | 'b'): number {",
      '  switch (k) {', // 58 @typescript-eslint/switch-exhaustiveness-check
      "    case 'a':",
      '      return 1;',
      '  }',
      '  return 0;',
      '}',
    ],
    expect: {
      tags: ['UTIL-03', 'TS-12', 'TS-13', 'TS-14', 'TS-16'],
      ruleIds: [
        'no-restricted-imports',
        'erp/no-query-in-loop',
        'no-await-in-loop',
        'erp/flag-naming',
        'erp/no-nested-loops',
        'max-depth',
        'no-restricted-globals',
        'no-restricted-properties',
        'complexity',
        'no-nested-ternary',
        'no-else-return',
        'no-lonely-if',
        '@typescript-eslint/naming-convention',
        '@typescript-eslint/switch-exhaustiveness-check',
      ],
    },
    negative: [],
  },
  {
    // A door file (docSurface) named like a junk drawer: TSDoc and UTIL-01.
    scope: '7 shared: door surface',
    path: `src/shared/${PROBE_MODULE}/utils.ts`,
    lines: [
      'export function zzUndocumented(): number {', // 1 jsdoc/require-jsdoc (QA-06)
      '  return 1;',
      '}',
    ],
    expect: { tags: ['UTIL-01'], ruleIds: ['jsdoc/require-jsdoc', 'erp/no-generic-filename'] },
    negative: [],
  },
  {
    // A helper under utils/ with a loop and no @complexity line (TS-17); documented, so jsdoc is silent.
    scope: '7 shared: utils/ helper',
    path: `src/shared/${PROBE_MODULE}/utils/sum.ts`,
    lines: [
      '/** Sums. */',
      'export function zzSum(values: readonly number[]): number {', // 2 erp/require-complexity-note
      '  let s = 0;',
      '  for (const v of values) s += v;',
      '  return s;',
      '}',
    ],
    expect: { tags: ['TS-17'], ruleIds: ['erp/require-complexity-note'] },
    negative: [],
  },
  {
    scope: '10 root + integrations',
    path: `src/integrations/${PROBE_MODULE}.ts`,
    lines: [
      "import './adapters/x.js';", // 1 BE-16
      'void process.env.X;', // 2 BE-06
      "import 'nodemailer';", // 3 ADR-0049: only the email adapter folder imports nodemailer
    ],
    expect: {
      tags: ['BE-06', 'BE-16', 'ADR-0049'],
      ruleIds: ['no-restricted-imports', 'no-restricted-syntax'],
    },
    negative: [],
  },
  {
    // The one door for nodemailer (BE-16 rule 4, ADR-0049): scope 16 drops P_NODEMAILER and keeps
    // everything else of scope 10, so process.env is still refused here.
    scope: '16 email adapter',
    path: `src/integrations/adapters/email/${PROBE_MODULE}.ts`,
    lines: [
      "import 'nodemailer';", // 1 negative: permitted here
      'void process.env.X;', // 2 BE-06
    ],
    expect: { tags: ['BE-06'], ruleIds: ['no-restricted-syntax'] },
    negative: [1],
  },
];

/** Scopes 8 and 11 are single real files; they are proven from their computed config, not a probe. */
const singleFileScopes = [
  {
    scope: '8 env schema',
    path: 'src/shared/config/env.schema.ts',
    check: (rules) => isOff(rules['no-restricted-syntax']) && hasPattern(rules, '/v1/'),
    describe: 'process.env permitted, shared/ → v1/ still forbidden',
  },
  {
    scope: '11 integrations module',
    path: 'src/integrations/integrations.module.ts',
    check: (rules) => !hasPattern(rules, '**/adapters/**') && !isOff(rules['no-restricted-syntax']),
    describe: 'adapters permitted, process.env still forbidden',
  },
];

/** Computed configs normalise severities to numbers (0/2); accept the string form too. */
const isOff = (rule) => rule === undefined || rule[0] === 0 || rule[0] === 'off';
const hasPattern = (rules, needle) =>
  (rules['no-restricted-imports'][1]?.patterns ?? []).some(
    (p) => p.regex === needle || (p.group ?? []).includes(needle),
  );

let failures = 0;
const report = (ok, text) => {
  console.log(`${ok ? 'ok     ' : 'FAILED '} ${text}`);
  if (!ok) failures += 1;
};

const cleanup = () => {
  for (const probe of probes) rmSync(join(root, probe.path), { force: true });
  rmSync(join(root, 'src', 'v1', PROBE_MODULE), { recursive: true, force: true });
  rmSync(join(root, 'src', 'shared', PROBE_MODULE), { recursive: true, force: true });
};
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

/** Every `.ts` file under `root/dir`, repo-relative with forward slashes; `[]` when it is absent. */
const walkTs = (dir) =>
  existsSync(join(root, dir))
    ? readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
        .map((entry) => relative(root, join(entry.parentPath, entry.name)).split(sep).join('/'))
    : [];

/**
 * Every workspace package's `src` and `__tests__`, discovered rather than listed (SF-5).
 * The bug this replaces was a walk over `src` alone, so `packages/contracts/**`
 * was invisible to the "every file is in a scope" clause below and
 * `packages/contracts/__tests__/**` had in fact fallen out of `eslint .` altogether — no
 * `no-console`, no `vitest/no-focused-tests`, no typed rules. Enumerating `packages/*` means the
 * next package is covered without editing this line, which is the lesson of `proxy.ts`
 * (patched with a literal instead of a generalisation).
 */
const listPackageDirs = () =>
  existsSync(join(root, 'packages'))
    ? readdirSync(join(root, 'packages'), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .flatMap((entry) => [`packages/${entry.name}/src`, `packages/${entry.name}/__tests__`])
    : [];

const listSourceFiles = () =>
  ['src', ...listPackageDirs()]
    .flatMap(walkTs)
    .filter((file) => !file.startsWith('src/shared/db/generated/'));

/**
 * Disjointness: rebuild every scope as a config object carrying only a marker setting. Settings
 * MERGE across matching objects (unlike rule options), so the merged config for a file lists every
 * scope that claims it — the count must be ≤ 1 everywhere and exactly 1 for every probe.
 */
const checkDisjoint = async () => {
  const scopes = config.filter((o) => Array.isArray(o.files) && o.rules?.['no-restricted-imports']);
  report(
    scopes.length === 15,
    `fifteen import/syntax scopes in eslint.config.mjs (found ${scopes.length})`,
  );
  const markers = scopes.map((s, i) => ({
    files: s.files,
    ignores: s.ignores,
    settings: { [`scope-${i + 1}`]: true },
  }));
  // A `files` pattern ending in `/**` (V1_TESTS) applies only when another object with a file-level
  // pattern matches too — in eslint.config.mjs that is the typed base; mirror its patterns here so
  // the packages walked above are seen the same way `src/**` is.
  const eslint = new ESLint({
    cwd: root,
    overrideConfigFile: true,
    overrideConfig: [{ files: ['src/**/*.ts', 'packages/*/**/*.ts'] }, ...markers],
  });
  const unscoped = [];
  let overlaps = 0;
  for (const file of listSourceFiles()) {
    const computed = await eslint.calculateConfigForFile(join(root, file));
    const owners = Object.keys(computed?.settings ?? {});
    if (owners.length > 1) {
      overlaps += 1;
      console.log(`  overlap: ${file} is in ${owners.join(', ')}`);
    }
    if (owners.length === 0) unscoped.push(file);
    if (probes.some((p) => p.path === file))
      report(
        owners.length === 1,
        `${file} sits in exactly one scope (${owners.join(', ') || 'none'})`,
      );
  }
  report(overlaps === 0, `no walked file is matched by two scopes (${overlaps} overlaps)`);
  const unexpected = unscoped.filter((f) => !UNSCOPED_BY_DESIGN(f) && !f.includes(PROBE_MODULE));
  report(
    unexpected.length === 0,
    `files in no scope are only the by-design ${UNSCOPED_BY_DESIGN_TEXT} (${unscoped.length} unscoped)${unexpected.length > 0 ? ` — unexpected: ${unexpected.join(', ')}` : ''}`,
  );
};

const checkProbes = async () => {
  for (const probe of probes) {
    const abs = join(root, probe.path);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${probe.lines.join('\n')}\n`);
  }
  const eslint = new ESLint({ cwd: root });
  const results = await eslint.lintFiles(probes.map((p) => join(root, p.path)));
  for (const probe of probes) {
    const result = results.find(
      (r) => relative(root, r.filePath).split(sep).join('/') === probe.path,
    );
    const messages = (result?.messages ?? []).filter((m) => ARCH_RULES.has(m.ruleId));
    const expected = (result?.messages ?? []).filter(
      (m) => ARCH_RULES.has(m.ruleId) || SHAPE_RULES.has(m.ruleId),
    );
    const fatal = (result?.messages ?? []).filter((m) => m.fatal);
    if (probe.expect.unusedDirective === true) {
      report(
        (result?.messages ?? []).some((m) => m.message.includes(UNUSED_DIRECTIVE)),
        `[${probe.scope}] reports an unused eslint-disable directive (BE-24)`,
      );
    }
    report(
      fatal.length === 0,
      `[${probe.scope}] probe parses (${fatal.map((m) => m.message).join('; ') || 'no fatal'})`,
    );
    for (const tag of probe.expect.tags) {
      report(
        expected.some((m) => m.message.includes(tag)),
        `[${probe.scope}] fires ${tag}`,
      );
    }
    for (const ruleId of probe.expect.ruleIds) {
      report(
        expected.some((m) => m.ruleId === ruleId),
        `[${probe.scope}] fires ${ruleId}`,
      );
    }
    for (const line of probe.negative) {
      const onLine = messages.filter((m) => m.line === line);
      report(
        onLine.length === 0,
        `[${probe.scope}] silent on permitted line ${line} \`${probe.lines[line - 1]}\`${onLine.length > 0 ? ` — got ${onLine.map((m) => m.ruleId).join(', ')}` : ''}`,
      );
    }
  }
  for (const single of singleFileScopes) {
    const computed = await eslint.calculateConfigForFile(join(root, single.path));
    report(
      computed !== undefined && single.check(computed.rules),
      `[${single.scope}] ${single.path}: ${single.describe}`,
    );
  }
};

try {
  await checkDisjoint();
  await checkProbes();
} finally {
  cleanup();
}

const leftovers = [
  `src/v1/${PROBE_MODULE}`,
  `src/shared/${PROBE_MODULE}`,
  ...probes.map((p) => p.path),
].filter((p) => existsSync(join(root, p)));
report(
  leftovers.length === 0,
  `no probe left in the tree${leftovers.length > 0 ? ` — ${leftovers.join(', ')}` : ''}`,
);

if (failures > 0) {
  console.error(`architecture lint: ${failures} expectation(s) failed`);
  process.exit(1);
}
console.log('architecture lint: every scope fires and every permitted construct is silent');
