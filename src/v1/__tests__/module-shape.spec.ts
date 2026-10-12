/**
 * The module tree is a test, not a checklist (erp-docs 02-coding-rules/05-backend.md BE-01,
 * BE-05; ADR-0029, ADR-0034): every
 * `src/v1/<module>` has exactly the allowed top-level entries, its events files, a README with the
 * ten mandatory sections in order and the three Resilience bullets, one spec per layer present, an
 * Events published table that equals `events/published.ts`, and is registered in `v1.module.ts`.
 * D-23 names the first exception: `settings` is facade-only (`FACADE_ONLY_MODULES`), with no routes,
 * controller, DTO or events. Currencies planning answer 5 names the second: `branding` is tableless
 * (`TABLELESS_MODULES`), with no repository folder. Pure `node:fs` + regex: nothing is imported, so
 * a broken module cannot break the checker. Failure messages name the module and the offending
 * entry.
 *
 * It also carries ADR-0034 decision 1's build-time clause: only `v1/identity` may name the identity
 * tables or import its repository, with `v1/auth`'s three login columns of `tblstaff` as the one
 * named, column-scoped exception (see `STAFF_TABLE_ALLOWLIST`). Those three clauses walk
 * `src/v1/**` **and `src/shared/**`** (see `sharedSources`): this build-time clause is the only
 * module-level enforcement ADR-0034 decision 1 has, because the runtime ownership guard is
 * table-level and every identity table is now `node`-owned.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = resolve(import.meta.dirname, '..', '..');
const V1 = join(SRC, 'v1');
const SHARED = join(SRC, 'shared');

/** Modules whose spec-per-layer clause is skipped; emptied by plan 02-05 in the commit that regenerates the module. */
const PENDING_REGENERATION: string[] = [];

const MIN_MODULES = 3;
const MODULES = readdirSync(V1, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name !== '__tests__')
  .map((entry) => entry.name)
  .sort();

const OPTIONAL_LAYERS = ['validator', 'enricher', 'transformer', 'transport'] as const;
const SERVICE_FILE = (m: string) =>
  new RegExp(`^${m}\\.(service|${OPTIONAL_LAYERS.join('|')})\\.ts$`);

/**
 * D-23 (lead 2026-10-02): the facade-only modules, BY NAME. No HTTP surface and nothing published, so
 * no `<m>.routes.ts`, `controller/`, `dto/` or `events/`, and no controller e2e spec; the README keeps
 * the ten headings (Endpoints and both Events sections say None). Never inferred from a folder's
 * contents: any other module without a controller still fails.
 */
const FACADE_ONLY_MODULES = ['settings'];
const HTTP_AND_EVENT_ENTRIES = (m: string) => [`${m}.routes.ts`, 'controller', 'dto', 'events'];
const isFacadeOnly = (m: string) => FACADE_ONLY_MODULES.includes(m);

/**
 * Currencies planning answer 5 (2026-10-04): the modules that own no table and read none directly,
 * BY NAME, as `FACADE_ONLY_MODULES` is. A module with no tables has no `repository/` folder (no
 * empty repository class): `allowedTop` drops it, so a `repository/` there is an extra entry. Never
 * inferred from a folder's contents: any other module without `repository/` still fails.
 * `branding` reads the options through `SettingsFacade` and the base currency through
 * `CurrenciesFacade` (D-44).
 */
const TABLELESS_MODULES = ['branding'];
const isTableless = (m: string) => TABLELESS_MODULES.includes(m);

const allowedTop = (m: string) => {
  const all = [
    `${m}.module.ts`,
    `${m}.routes.ts`,
    'index.ts',
    'README.md',
    'controller',
    'service',
    'repository',
    'model',
    'dto',
    'events',
    'facade',
    '__tests__',
  ];
  const dropped = [
    ...(isFacadeOnly(m) ? HTTP_AND_EVENT_ENTRIES(m) : []),
    ...(isTableless(m) ? ['repository'] : []),
  ];
  return all.filter((entry) => !dropped.includes(entry));
};

/**
 * Top-level entries a module MAY have and need not: allowed when present, never required (every
 * `allowedTop` entry is required). `jobs/` holds `<name>.job.ts` and `<name>.processor.ts` on
 * `src/shared/queue/` (BE-14), opened by plan 04.2-04.
 */
const optionalTop = ['jobs'];

/** The entries of a module folder outside the allowed set, and the required ones it lacks. */
function topLevelProblems(m: string, actual: readonly string[]) {
  const required = allowedTop(m);
  const allowed = [...required, ...optionalTop];
  return {
    extra: actual.filter((e) => !allowed.includes(e)),
    missing: required.filter((e) => !actual.includes(e)),
  };
}

/** The ten mandatory `## ` headings, in this relative order; optional headings may sit between them. */
const README_HEADINGS = [
  '## Purpose',
  '## Owned tables',
  '## Facade surface',
  '## Endpoints',
  '## Events published',
  '## Events subscribed',
  '## Jobs',
  '## Resilience',
  '## Layers',
  '## How to run its tests',
];
const RESILIENCE_BULLETS = ['**Breaker:', '**Retry policy:', '**Pool budget:'];

/** `src/shared/*` folders that exist; adding one means editing this list and `src/shared/README.md` in the same PR. */
const SHARED_ALLOWLIST = [
  'cache',
  'config',
  // Non-HTTP cryptographic ports. `PASSWORD_HASHER` moved here from `http/auth/` in plan 03.1-11:
  // `v1/identity` writes `tblstaff.password` (ADR-0034 d.1) and `v1/auth` owns the `$2y$12$`
  // contract, so the port is shared — but hashing reads no request and does not belong under `http/`.
  'crypto',
  'db',
  'errors',
  'events',
  'health',
  'http',
  'logger',
  // BullMQ on Redis db 2 with a DLQ per queue (BE-14), built by plan 04.2-04 for the first job.
  'queue',
  'resilience',
  // Node's own file storage behind a port (ADR-0041, D-17): a volume now, object storage later; never Perfex's disk (ADR-0024).
  'storage',
  // Resumable uploads over tus (ADR-0041, P-12): purposes are registered by the modules that own the resulting rows.
  'uploads',
];
/** Reserved in `src/shared/README.md`, created by the first module that needs them. */
const SHARED_RESERVED = ['validation', 'base', 'timers', 'utils'];

/**
 * ADR-0034 decision 1 — **`v1/identity` is the only module that writes identity.** The clause below
 * is one of the ADR's four Enforcement bullets, and it is here rather than in a grep because the
 * property is "no code names the table", not "the word does not appear": a docblock that explains
 * why `v1/auth` no longer reads `tblstaff_permissions` legitimately contains the word (the lead's
 * lesson: a gate that greps for the absence of a word tests the word). `stripComments`
 * is what makes the difference, and it preserves the line count so a failure message can name the
 * line.
 */
const IDENTITY_TABLES = ['tblstaff_permissions', 'tblroles'];

/** `tblstaff` is shared, and the sharing is column-scoped and written down. */
const SHARED_STAFF_TABLE = 'tblstaff';

/**
 * The two modules that may name `tblstaff`. **`auth`'s allowance is column-scoped:** it writes
 * `password` (the compare-and-set re-hash on login), `last_login` and `last_ip` and nothing else —
 * identity-access brief §2.1, BE-04's column-level scope, and `src/v1/auth/README.md` § Owned tables,
 * which is the sentence this allowlist points at. ADR-0034 decision 1 is about *granting* (the role,
 * the permission set, the administrator flag), not about the three login columns, so the exception is
 * an exception to the table rule and not to the decision.
 */
const STAFF_TABLE_ALLOWLIST = ['identity', 'auth'];

/** No module but `v1/identity` may reach into its repository, facade or not. */
const IDENTITY_REPOSITORY_IMPORT = 'identity/repository/';

/** The module the decision names as the single writer. */
const IDENTITY_MODULE = 'identity';

/**
 * `src/v1/__tests__/` is excluded from the clause by name: this spec is the one file that must
 * carry the table names as data in order to check for them.
 */
const CLAUSE_EXCLUDED_DIRS = ['__tests__'];

/** `src/shared` in the clause messages — it is not a module, so it is in no allowlist. */
const SHARED_MODULE = 'shared';

/**
 * Skipped by the `src/shared/**` walk: `generated/` is Prisma's output, which names every one of the
 * 409 legacy tables by construction and is hand-edited by nobody (it is in ESLint's global ignores
 * and `.gitignore`'s generated set for the same reason).
 */
const SHARED_EXCLUDED_DIRS = ['generated'];

/**
 * The two files `src/shared/**` exempts, for the same reason `src/v1/__tests__/` is exempt: they are
 * the ownership register's and the guard's own specs, so the table names *are* their fixture data —
 * the whole point of `src/shared/db/__tests__/ownership-guard*.spec.ts` is to assert what the guard
 * decides for `tblstaff` and `tblstaff_permissions`. Every other file under `src/shared`, spec or
 * not, is covered. Keep this list at two entries: a third shared file needing the names is a design
 * conversation, not an append.
 */
const SHARED_CLAUSE_EXEMPT = [
  'src/shared/db/__tests__/ownership-guard.spec.ts',
  'src/shared/db/__tests__/ownership-guard.int.spec.ts',
];

/** Line and block comments blanked, line count preserved, so a code match is really code. */
function stripComments(source: string): string {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
  out = out.replace(
    /(^|[^:])\/\/[^\n]*/g,
    (match, lead: string) => lead + ' '.repeat(match.length - lead.length),
  );
  return out;
}

/** A file the ADR-0034 decision 1 clauses read: which module owns it, its repo-relative path, its text. */
interface ClauseSource {
  module: string;
  file: string;
  source: string;
}

/** Walks `dir` and yields every `.ts` file under it as a {@link ClauseSource} of `module`. */
function walkTs(dir: string, module: string, prefix: string, found: ClauseSource[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const next = join(dir, entry.name);
    const nextRel = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SHARED_EXCLUDED_DIRS.includes(entry.name)) walkTs(next, module, nextRel, found);
    } else if (entry.name.endsWith('.ts')) {
      found.push({ module, file: nextRel, source: read(next) });
    }
  }
}

/** Every `.ts` file under `src/v1/<module>/` for a module the clause covers, as `<module>` + path. */
function moduleSources(): ClauseSource[] {
  const found: ClauseSource[] = [];
  for (const module of MODULES) {
    if (CLAUSE_EXCLUDED_DIRS.includes(module)) continue;
    walkTs(join(V1, module), module, `src/v1/${module}`, found);
  }
  return found;
}

/**
 * The same walk over `src/shared/**` (CR follow-up). `src/shared` is not a module,
 * so it owns no identity table and appears in no allowlist: a shared helper naming one is an
 * offence exactly as a business module's would be. BE-25's **Where** names `src/shared/db/`, and
 * before this the clauses walked `src/v1/**` only — a future `src/shared/rbac.ts` naming
 * `tblstaff_permissions` was invisible to the one enforcement that is module-level at all (the
 * runtime ownership guard is table-level and now passes every one of these tables; ADR-0034
 * Enforcement).
 */
function sharedSources(): ClauseSource[] {
  const found: ClauseSource[] = [];
  walkTs(SHARED, SHARED_MODULE, 'src/shared', found);
  return found.filter((entry) => !SHARED_CLAUSE_EXEMPT.includes(entry.file));
}

/** Everything the ADR-0034 decision 1 clauses below read: every v1 module, then `src/shared`. */
function clauseSources(): ClauseSource[] {
  return [...moduleSources(), ...sharedSources()];
}

const read = (...parts: string[]) => readFileSync(join(...parts), 'utf8');
const listDir = (dir: string) => (existsSync(dir) ? readdirSync(dir).sort() : []);

/** Lines between `## <heading>` and the next `## ` heading. */
const section = (readme: string, heading: string): string[] => {
  const lines = readme.split('\n');
  const start = lines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];
  const body: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    body.push(line);
  }
  return body;
};

/** First-column backticked names of a markdown table inside a section, e.g. `| \`auth.login.succeeded\`   | ...` (Prettier pads the cell). */
const tableNames = (body: string[]): string[] =>
  body
    .map((line) => /^\| `([^`]+)`\s+\|/.exec(line))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => m[1] ?? '');

const eventNames = (source: string): string[] =>
  [...source.matchAll(/static readonly NAME = '([^']+)'/g)].map((m) => m[1] ?? '');

describe('src/v1 module shape', () => {
  it(`has at least ${String(MIN_MODULES)} modules beside __tests__`, () => {
    expect(MODULES.length, `modules found: ${MODULES.join(', ')}`).toBeGreaterThanOrEqual(
      MIN_MODULES,
    );
  });

  it('registers every module in v1.module.ts', () => {
    const v1Module = read(V1, 'v1.module.ts');
    for (const m of MODULES) {
      expect(
        v1Module.includes(`./${m}/${m}.module.js`),
        `v1.module.ts does not import ./${m}/${m}.module.js`,
      ).toBe(true);
    }
  });

  it('allows @Global() only in src/v1/auth/auth.module.ts among v1 modules', () => {
    for (const m of MODULES) {
      const moduleFiles = listDir(join(V1, m)).filter((f) => f.endsWith('.module.ts'));
      for (const file of moduleFiles) {
        const isGlobal = read(V1, m, file).includes('@Global()');
        const allowed = m === 'auth' && file === 'auth.module.ts';
        expect(
          isGlobal && !allowed,
          `${m}/${file} uses @Global(); only auth.module.ts may (it provides ACCESS_TOKEN_VERIFIER)`,
        ).toBe(false);
      }
    }
  });

  it('keeps src/shared to the allowlist (no loose .ts, README.md only)', () => {
    const entries = readdirSync(SHARED, { withFileTypes: true });
    const dirs = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    const files = entries.filter((e) => e.isFile()).map((e) => e.name);
    expect(dirs, 'src/shared folders differ from SHARED_ALLOWLIST').toEqual(
      [...SHARED_ALLOWLIST].sort(),
    );
    expect(files, 'src/shared may hold README.md and nothing else at its root').toEqual([
      'README.md',
    ]);
    for (const reserved of SHARED_RESERVED) {
      expect(
        SHARED_ALLOWLIST.includes(reserved),
        `${reserved} is reserved and allowlisted at once`,
      ).toBe(false);
    }
  });

  it(`lets only v1/${IDENTITY_MODULE} name ${IDENTITY_TABLES.join(' and ')} (ADR-0034 decision 1)`, () => {
    const offences: string[] = [];
    for (const { module, file, source } of clauseSources()) {
      if (module === IDENTITY_MODULE) continue;
      const code = stripComments(source);
      for (const table of IDENTITY_TABLES) {
        if (new RegExp(String.raw`\b${table}\b`).test(code)) {
          offences.push(
            `${file} names \`${table}\`; ADR-0034 decision 1 makes v1/${IDENTITY_MODULE} its only writer — ask identity.facade or subscribe to its event (BE-03)`,
          );
        }
      }
    }
    expect(offences, offences.join('\n')).toEqual([]);
  });

  it(`lets only ${STAFF_TABLE_ALLOWLIST.join(' and ')} name ${SHARED_STAFF_TABLE} (ADR-0034 decision 1, BE-04 column scope)`, () => {
    const offences: string[] = [];
    for (const { module, file, source } of clauseSources()) {
      if (STAFF_TABLE_ALLOWLIST.includes(module)) continue;
      if (new RegExp(String.raw`\b${SHARED_STAFF_TABLE}\b`).test(stripComments(source))) {
        offences.push(
          `${file} names \`${SHARED_STAFF_TABLE}\`; only ${STAFF_TABLE_ALLOWLIST.join(' and ')} may (ADR-0034 decision 1; auth's allowance is the three login columns of src/v1/auth/README.md § Owned tables)`,
        );
      }
    }
    expect(offences, offences.join('\n')).toEqual([]);
  });

  it(`lets no module but v1/${IDENTITY_MODULE} import ${IDENTITY_REPOSITORY_IMPORT} (ADR-0034 decision 1)`, () => {
    const offences: string[] = [];
    for (const { module, file, source } of clauseSources()) {
      if (module === IDENTITY_MODULE) continue;
      if (stripComments(source).includes(IDENTITY_REPOSITORY_IMPORT)) {
        offences.push(
          `${file} imports \`${IDENTITY_REPOSITORY_IMPORT}\`; reach v1/${IDENTITY_MODULE} through its index.ts (the facade) only — ADR-0034 decision 1, BE-03`,
        );
      }
    }
    expect(offences, offences.join('\n')).toEqual([]);
  });
});

describe('topLevelProblems (optionalTop, facade-only)', () => {
  const complete = allowedTop('demo');

  it('passes a module without jobs/ and one with it', () => {
    expect(topLevelProblems('demo', complete)).toEqual({ extra: [], missing: [] });
    expect(topLevelProblems('demo', [...complete, 'jobs'])).toEqual({ extra: [], missing: [] });
  });

  it('still fails an unknown entry and a missing required one', () => {
    expect(topLevelProblems('demo', [...complete, 'helpers']).extra).toEqual(['helpers']);
    expect(
      topLevelProblems(
        'demo',
        complete.filter((e) => e !== 'facade'),
      ).missing,
    ).toEqual(['facade']);
  });

  it('admits the facade-only shape for settings (D-23): no routes, controller, dto or events', () => {
    expect(allowedTop('settings')).toEqual([
      'settings.module.ts',
      'index.ts',
      'README.md',
      'service',
      'repository',
      'model',
      'facade',
      '__tests__',
    ]);
    expect(topLevelProblems('settings', allowedTop('settings'))).toEqual({
      extra: [],
      missing: [],
    });
  });

  it('still refuses a controller in settings', () => {
    expect(topLevelProblems('settings', [...allowedTop('settings'), 'controller']).extra).toEqual([
      'controller',
    ]);
  });

  it('fails the same eight entries under any other name (the exception is by name, never inferred)', () => {
    expect(
      topLevelProblems('demo', [
        'demo.module.ts',
        'index.ts',
        'README.md',
        'service',
        'repository',
        'model',
        'facade',
        '__tests__',
      ]).missing,
    ).toEqual(['demo.routes.ts', 'controller', 'dto', 'events']);
  });
});

describe('topLevelProblems (tableless, Currencies planning answer 5)', () => {
  it('names branding as the one tableless module', () => {
    expect(TABLELESS_MODULES).toEqual(['branding']);
  });

  it('drops repository from allowedTop for branding and keeps every other entry', () => {
    expect(allowedTop('branding')).not.toContain('repository');
    expect(allowedTop('branding')).toEqual(
      allowedTop('demo')
        .map((entry) => entry.replace('demo', 'branding'))
        .filter((entry) => entry !== 'repository'),
    );
    expect(topLevelProblems('branding', allowedTop('branding'))).toEqual({
      extra: [],
      missing: [],
    });
  });

  it('refuses a repository folder in a tableless module (a module with no tables has none)', () => {
    expect(topLevelProblems('branding', [...allowedTop('branding'), 'repository']).extra).toEqual([
      'repository',
    ]);
  });

  it('fails the same entries under any other name (the exception is by name, never inferred)', () => {
    const entries = allowedTop('branding').map((entry) => entry.replace('branding', 'demo'));
    expect(topLevelProblems('demo', entries).missing).toEqual(['repository']);
  });
});

describe.each(TABLELESS_MODULES)('tableless src/v1/%s', (m) => {
  const dir = join(V1, m);

  it('README ## Owned tables says None', () => {
    const readme = existsSync(join(dir, 'README.md')) ? read(dir, 'README.md') : '';
    const firstText =
      section(readme, '## Owned tables')
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? '';
    expect(
      firstText.startsWith('None'),
      `${m}: README ## Owned tables must start with "None"`,
    ).toBe(true);
  });

  it('names neither PrismaService nor this.prisma in a non-test .ts file (comments stripped)', () => {
    const found: ClauseSource[] = [];
    walkTs(dir, m, `src/v1/${m}`, found);
    const offences = found
      .filter(({ file }) => !file.includes('/__tests__/'))
      .filter(({ source }) => /\bPrismaService\b|this\.prisma\b/.test(stripComments(source)))
      .map(({ file }) => `${file} reaches the database; a tableless module reads through facades`);
    expect(offences, offences.join('\n')).toEqual([]);
  });
});

describe.each(MODULES)('src/v1/%s', (m) => {
  const dir = join(V1, m);
  const readme = existsSync(join(dir, 'README.md')) ? read(dir, 'README.md') : '';

  it('has exactly the allowed top-level entries', () => {
    const { extra, missing } = topLevelProblems(m, listDir(dir));
    expect(extra, `${m}: top-level entries not in the allowed set: ${extra.join(', ')}`).toEqual(
      [],
    );
    expect(missing, `${m}: required top-level entries missing: ${missing.join(', ')}`).toEqual([]);
  });

  // A facade-only module has no events/ at all; topLevelProblems already refuses one (D-23).
  it.skipIf(isFacadeOnly(m))(
    'has events/published.ts and events/subscribed.ts (handlers/ is the only other entry)',
    () => {
      const entries = listDir(join(dir, 'events'));
      expect(entries.includes('published.ts'), `${m}: events/published.ts missing`).toBe(true);
      expect(entries.includes('subscribed.ts'), `${m}: events/subscribed.ts missing`).toBe(true);
      const extra = entries.filter(
        (e) => !['published.ts', 'subscribed.ts', 'handlers'].includes(e),
      );
      expect(extra, `${m}: unexpected entries under events/: ${extra.join(', ')}`).toEqual([]);
      if (entries.includes('handlers')) {
        expect(
          statSync(join(dir, 'events', 'handlers')).isDirectory(),
          `${m}: events/handlers must be a folder`,
        ).toBe(true);
      }
    },
  );

  it('has no jobs/ folder while src/shared/queue does not exist', () => {
    const queueExists = existsSync(join(SHARED, 'queue'));
    const jobsExists = existsSync(join(dir, 'jobs'));
    expect(
      jobsExists && !queueExists,
      `${m}: jobs/ is rejected until src/shared/queue/ exists (then add 'jobs' to optionalTop in the same PR)`,
    ).toBe(false);
  });

  it('names service/ files <m>.(service|validator|enricher|transformer|transport).ts or lists them in the README Layers table', () => {
    const layers = section(readme, '## Layers').join('\n');
    for (const file of listDir(join(dir, 'service'))) {
      const ok = SERVICE_FILE(m).test(file) || layers.includes(`\`service/${file}\``);
      expect(
        ok,
        `${m}: service/${file} matches neither ${m}.(service|${OPTIONAL_LAYERS.join('|')}).ts nor a backticked \`service/${file}\` row in README ## Layers`,
      ).toBe(true);
    }
  });

  it('README has the ten mandatory headings in relative order', () => {
    expect(readme.length, `${m}: README.md missing or empty`).toBeGreaterThan(0);
    const headings = readme.split('\n').map((line) => line.trim());
    let cursor = -1;
    for (const heading of README_HEADINGS) {
      const at = headings.indexOf(heading, cursor + 1);
      expect(
        at,
        `${m}: README heading "${heading}" missing or out of order (must follow "${README_HEADINGS[README_HEADINGS.indexOf(heading) - 1] ?? '(start)'}")`,
      ).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it('README ## Resilience has the Breaker, Retry policy and Pool budget bullets', () => {
    const body = section(readme, '## Resilience');
    for (const prefix of RESILIENCE_BULLETS) {
      expect(
        body.some((line) => line.trimStart().startsWith(`- ${prefix}`)),
        `${m}: README ## Resilience lacks a bullet starting "- ${prefix}"`,
      ).toBe(true);
    }
  });

  it('README ## Events published table equals the NAME constants in events/published.ts', () => {
    // No events/published.ts (a facade-only module) publishes nothing: the README then says None.
    const published = join(dir, 'events', 'published.ts');
    const inCode = existsSync(published) ? eventNames(read(published)).sort() : [];
    const body = section(readme, '## Events published');
    const inReadme = tableNames(body).sort();
    if (inCode.length === 0 && inReadme.length === 0) {
      const firstText = body.map((l) => l.trim()).find((l) => l.length > 0) ?? '';
      expect(
        firstText.startsWith('None'),
        `${m}: no events in code and no table in README ## Events published — the section must start with "None"`,
      ).toBe(true);
      return;
    }
    expect(
      inReadme,
      `${m}: README ## Events published names [${inReadme.join(', ')}] but events/published.ts declares [${inCode.join(', ')}]`,
    ).toEqual(inCode);
  });

  it.skipIf(PENDING_REGENERATION.includes(m))(
    `has one spec per layer present${PENDING_REGENERATION.includes(m) ? ' (skipped: pending regeneration by plan 02-05)' : ''}`,
    () => {
      const tests = listDir(join(dir, '__tests__'));
      // A facade-only module has no controller, so no e2e spec (D-23).
      const required = [
        ...(isFacadeOnly(m) ? [] : [`${m}.controller.e2e.spec.ts`]),
        `${m}.service.spec.ts`,
        `${m}.facade.spec.ts`,
      ];
      for (const layer of OPTIONAL_LAYERS) {
        if (existsSync(join(dir, 'service', `${m}.${layer}.ts`))) {
          required.push(`${m}.${layer}.spec.ts`);
        }
      }
      const repository = join(dir, 'repository', `${m}.repository.ts`);
      if (existsSync(repository) && readFileSync(repository, 'utf8').includes('this.prisma')) {
        required.push(`${m}.repository.int.spec.ts`);
      }
      const missing = required.filter((spec) => !tests.includes(spec));
      expect(missing, `${m}: layer specs missing under __tests__/: ${missing.join(', ')}`).toEqual(
        [],
      );
    },
  );
});
