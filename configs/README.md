# configs

The shared TypeScript, ESLint and Prettier configuration of the ERP code repositories. The folder is laid out as the future package `@erp/configs`: it has its own `package.json` with an `exports` map, and every consumer already imports it by that package name.

| File                       | What it holds                                                                                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json`             | `@erp/configs`, private, `exports` for `./tsconfig/*.json`, `./eslint/*`, `./prettier`, `./dependency-cruiser`, `./vitest/*`, `./commitlint` and `./lint-staged`                                                                                 |
| `tsconfig/base.json`       | the TS-01 strictness flags, `target` ES2023, `lib` ES2024                                                                                                                                                                                        |
| `tsconfig/node.json`       | `base.json` plus NodeNext modules, Node types and Nest decorators                                                                                                                                                                                |
| `tsconfig/next.json`       | `base.json` plus erp-web's Next.js options (DOM lib, bundler resolution, `jsx`, `noEmit`, the `next` plugin)                                                                                                                                     |
| `eslint/base.mjs`          | `base({ files, tests, timerDoors, docSurface, allowGenericFilenames })`: the objects every consumer spreads first: the unused-directive error, the code-shape rules, the timer doors, the complexity note and the TSDoc rule on the door surface |
| `eslint/backend.mjs`       | `backend({ root })`: erp-api's typed base, the fifteen architecture scopes, `HYGIENE`, `TEST_HYGIENE` (02-coding-rules/05-backend.md)                                                                                                                    |
| `eslint/frontend.mjs`      | `frontend({ root })`: erp-web's Next rule sets, typed base, `21 + FEATURES.length` architecture scopes (`FEATURES` read from `<root>/src/features`), S13-S19 (02-coding-rules/06-frontend.md)                                                           |
| `prettier.config.mjs`      | the TS-05 Prettier options                                                                                                                                                                                                                       |
| `eslint/plugin.mjs`        | the local `erp` ESLint plugin: five rules no library provides                                                                                                                                                                                    |
| `scripts/lint-ratchet.mjs` | the pinned total of suppressed lint violations and the `REFACTOR-BACKLOG.md` generator                                                                                                                                                           |
| `dependency-cruiser.cjs`   | the `no-circular` rule of `check:cycles` (TS-15), type-only imports included                                                                                                                                                                     |
| `vitest/base.mjs`          | the shared Vitest defaults `test` and `coverage`; `vitest/base.d.mts` declares their types                                                                                                                                                       |
| `lefthook.yml`             | pre-commit, commit-msg, post-merge and post-rewrite; each repository root holds a byte copy (see "Git hooks")                                                                                                                                    |
| `commitlint.config.mjs`    | the commit-msg rules: conventional commits with a scope, no em dash in the header, no attribution trailer, no length limit                                                                                                           |
| `lint-staged.config.mjs`   | the pre-commit commands on staged files: ESLint then Prettier on TypeScript, Prettier on the rest                                                                                                                                                |
| `scripts/git-hooks.mjs`    | `install` (the postinstall: lefthook, then our own `.git/hooks/pre-push`), `pre-push` (the guard) and `post-sync` (the lockfile reinstall)                                                                                                       |

## The erp plugin and the lint ratchet

`eslint/plugin.mjs` is the local `erp` ESLint plugin (`meta.name` `erp`), imported as `@erp/configs/eslint/plugin`. It holds five rules, each message ending with the rule id it enforces: `erp/no-nested-loops` (TS-12), `erp/no-query-in-loop` (TS-16), `erp/flag-naming` (TS-14), `erp/require-complexity-note` (TS-17) and `erp/no-generic-filename` (UTIL-01). `base()` switches them on in every consumer.

`scripts/lint-ratchet.mjs` is run by path from a consumer's root as `corepack yarn check:ratchet` (`node configs/scripts/lint-ratchet.mjs --expect <n>`, the number pinned in that consumer's `package.json`). It fails when the total of ESLint's bulk suppressions (plus the known dependency-cruiser `no-circular` entries) is above the pin (a suppression was added) or below it (lower the pin to the printed total), and when `REFACTOR-BACKLOG.md` is not what the suppressions generate (`--write` regenerates it). A fixed violation is pruned with `corepack yarn lint:prune` (`eslint . --prune-suppressions`).

## base() and the ratchet in a consumer

`base()` takes the consumer's globs, so one file serves both code repositories:

| Parameter               | What it is                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `files`                 | the production sources the shape rules and the timer rule cover                                        |
| `tests`                 | the globs those rules skip (specs, `__tests__`, stories, harnesses)                                    |
| `timerDoors`            | the files that may call `setTimeout` and `setInterval` (TS-13)                                         |
| `docSurface`            | the door files whose exports carry a TSDoc block (`jsdoc/require-jsdoc`); an empty list omits the rule |
| `allowGenericFilenames` | POSIX path suffixes `erp/no-generic-filename` accepts (erp-web's shadcn `src/lib/utils.ts`)            |

Every rule is an error. The violations that existed when the rules were switched on are ESLint bulk suppressions in the consumer's `eslint-suppressions.json`, listed per file and rule in its generated `REFACTOR-BACKLOG.md`. A consumer runs, in `check`:

- `check:ratchet`: `node configs/scripts/lint-ratchet.mjs --expect <n>`, the pinned total (see above);
- `check:cycles`: `depcruise <source folders> --config configs/dependency-cruiser.cjs`, plus `--ignore-known` where a `.dependency-cruiser-known-violations.json` baseline holds the cycles that existed at switch-on (they count in the ratchet);
- and has `lint:prune` (`eslint . --prune-suppressions`) for the commit that fixes a suppressed violation, which also lowers the pin.

A new file has no suppression, so any violation in it fails `lint`.

Never baseline a rule whose autofix would run on suppressed code: ESLint applies fixes to suppressed violations too, so `eslint --fix` (the pre-commit, or `lint --fix`) rewrites the code, the suppression goes unused and ESLint refuses. Turn that rule's fixer off or fix the code. `jsdoc/require-jsdoc` has `enableFixer: false` for this reason (its fixer writes an empty `/** */` block, which is not documentation).

The templates carry no suppression on a copied path (`src/v1/example-item/`, `src/features/example-item/`): a template's `eslint-suppressions.json` may only name a kit file its manifest copies from erp-api or erp-web. When a re-copy brings in a kit file whose violation was fixed upstream, the template's entry goes stale and the template's `lint` fails with ESLint's "suppressions left that do not occur anymore". Prune it with `eslint . --prune-suppressions` in the template folder and commit the file with the re-copy.

## Git hooks

`lefthook.yml` holds four of the five hooks, the gate while CI is parked. lefthook reads its config from the repository root only, so erp-api and erp-web each hold a byte copy at `lefthook.yml`; every path in it is `configs/...` from that root. The root `postinstall` runs `node configs/scripts/git-hooks.mjs install` (after `prisma generate` in erp-api): `lefthook install`, then it writes `.git/hooks/pre-push` itself. Yarn runs the root `postinstall` when it builds the root (a fresh clone, a dependency change); to reinstall the hooks by hand, run `node configs/scripts/git-hooks.mjs install`. It does nothing when `CI` is set or outside a git checkout, so the Docker builds stay green.

| Hook                         | What it runs                                                                                                                                                                              | Failure it prevents                                                                                                                          | Cost                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `pre-commit`                 | `corepack yarn lint-staged --config lint-staged.config.mjs`: the root `lint-staged.config.mjs` on the staged files only (not the copy under `configs/`); skipped during a merge or rebase | a lint or format error reaching a commit                                                                                                     | about 12 to 15 s per commit, mostly one typed ESLint start                  |
| `commit-msg`                 | `corepack yarn commitlint --edit` with `commitlint.config.mjs`                                                                                                                            | a non-conventional header, a missing scope, an em dash, an attribution trailer                                                               | about 2 s                                                                   |
| `pre-push`, first            | `node configs/scripts/git-hooks.mjs pre-push`                                                                                                                                             | a direct push to `main` (not server-protected); a merge commit in a rebase-only history                                  | under 1 s                                                                   |
| `pre-push`, second           | `corepack yarn check:push`: `typecheck` and `test` in erp-api and erp-web                                                              | a type error or failing unit test on the remote                                    | about 65 s erp-api, 55 s erp-web (measured) |
| `post-merge`, `post-rewrite` | `node configs/scripts/git-hooks.mjs post-sync`: `corepack yarn install` when `yarn.lock` changed                                                                                          | running code against a stale `node_modules` after a pull; a rebasing pull (`pull.rebase true`) fires `post-rewrite`, not `post-merge` | 0 s unless the lockfile changed                                             |

`pre-push` is not a lefthook hook: lefthook 2.1.14 skips every pre-push command when `git diff HEAD @{push}` is empty, so `git push origin HEAD:main` from a branch already pushed would skip the guard. The written hook runs the guard, then `check:push`, one after the other, stopping at the first failure; it never holds lefthook's name in capitals, which lefthook reads as its own. The full `corepack yarn check` runs before merge and its output is pasted in the PR; in erp-api and erp-web it ends with `check:audit` (`yarn npm audit --all --recursive --severity high`), which needs the network and so is never in a hook.

Bypasses and what they cost:

- `git commit --no-verify` and `git push --no-verify` skip the hooks, and `LEFTHOOK=0` skips the lefthook ones (not `pre-push`); nothing server-side notices while CI is parked. The control is the full `check` output pasted in the PR.
- `ERP_ALLOW_MAIN_PUSH=1 git push ...` (PowerShell: `$env:ERP_ALLOW_MAIN_PUSH='1'; git push ...; Remove-Item Env:ERP_ALLOW_MAIN_PUSH`) lets one push reach `main`. It is for a push the lead intends, set for that one command only.

## Vitest defaults

`vitest/base.mjs` exports `test` (environment `node`, no watch) and `coverage` (provider `v8`, reporters `text-summary` and `json-summary`, folder `coverage`). erp-api and erp-web spread both into their own `vitest.config.mts` (`import { coverage, test } from '@erp/configs/vitest/base'`) and add what is theirs: the test globs, the coverage `include` (explicit, so an untested file counts) and the per-layer `thresholds`. The thresholds are each repository's measured state, floored, and only ever raised; they are not here (see "What is not here").

## Consumers

| Consumer                     | Copy                                      | Dependency                                              | Consumer files                                                                                                                                                                    |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `erp-api`                    | `configs/` (whole folder), `lefthook.yml` | `"@erp/configs": "link:./configs"` in `devDependencies` | `tsconfig.json`, `eslint.config.mjs`, `prettier.config.mjs`, `vitest.config.mts`, `.prettierignore`, `Dockerfile`, `commitlint.config.mjs`, `lint-staged.config.mjs`              |
| `erp-web`                    | `configs/`, `lefthook.yml`                | the same                                                | `tsconfig.json`, `eslint.config.mjs`, `prettier.config.mjs`, `vitest.config.mts`, `.prettierignore`, `Dockerfile`, `commitlint.config.mjs`, `lint-staged.config.mjs`              |
| `05-templates/backend-module`   | `configs/`                                | the same                                                | `tsconfig.json`, `eslint.config.mjs`                                                                                                                                              |
| `05-templates/frontend-feature` | `configs/`                                | the same                                                | `tsconfig.json`, `eslint.config.mjs`, `prettier.config.mjs`, `vitest.config.mts`, `.prettierignore` (byte copies of erp-web's) |

Each consumer holds a byte copy inside its own tree, so a bare import inside a config (`typescript-eslint`, `@vitest/eslint-plugin`) resolves from that consumer's own `node_modules`.

The consumer files of erp-api:

```json
{
  "extends": "@erp/configs/tsconfig/node.json",
  "compilerOptions": { "sourceMap": true, "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts"]
}
```

```js
import { defineConfig } from 'eslint/config';
import { backend } from '@erp/configs/eslint/backend';
import { base } from '@erp/configs/eslint/base';

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'packages/*/dist/**',
      'node_modules/**',
      'coverage/**',
      'src/shared/db/generated/**',
      // Byte copy of the shared configs/; linted nowhere.
      'configs/**',
    ],
  },
  ...base({
    files: ['src/**/*.ts', 'packages/contracts/src/**/*.ts'],
    tests: ['src/**/*.spec.ts', 'src/**/__tests__/**', 'packages/*/__tests__/**'],
    timerDoors: ['src/shared/resilience/**', 'src/shared/health/**'],
    docSurface: ['src/shared/**/*.ts', 'src/v1/*/facade/*.ts', 'packages/contracts/src/**/*.ts'],
  }),
  ...backend({ root: import.meta.dirname }),
);
```

```js
export { default } from '@erp/configs/prettier';
```

The consumer files of erp-web (the frontend template holds byte copies of all three):

```json
{
  "extends": "@erp/configs/tsconfig/next.json",
  "compilerOptions": { "paths": { "@/*": ["./src/*"] } },
  "include": [
    "next-env.d.ts",
    "reset.d.ts",
    "**/*.ts",
    "**/*.tsx",
    "**/*.mts",
    ".next/types/**/*.ts",
    ".next/dev/types/**/*.ts"
  ],
  "exclude": ["node_modules"]
}
```

```js
import { defineConfig } from 'eslint/config';
import { base } from '@erp/configs/eslint/base';
import { frontend } from '@erp/configs/eslint/frontend';

export default defineConfig(
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'node_modules/**',
      'coverage/**',
      'storybook-static/**',
      'next-env.d.ts',
      // shadcn primitives are never edited, so they are never linted.
      'src/components/ui/**',
      // Byte copy of the shared configs/; linted nowhere.
      'configs/**',
    ],
  },
  ...base({
    files: ['app/**/*.{ts,tsx}', 'src/**/*.{ts,tsx}', 'proxy.ts'],
    tests: ['**/__tests__/**', '**/*.test.{ts,tsx}', '**/*.stories.tsx', 'src/test/**'],
    // swr-config.ts owns SWR's retry timer (onErrorRetry, delay from CLIENT_TIMINGS, injectable for tests): a door, not a hook.
    timerDoors: ['src/lib/hooks/**', 'src/lib/api/swr-config.ts'],
    docSurface: ['src/lib/**/*.{ts,tsx}'],
    allowGenericFilenames: ['src/lib/utils.ts'],
  }),
  ...frontend({ root: import.meta.dirname }),
);
```

```js
export { default } from '@erp/configs/prettier';
```

A consumer lists `configs` in its `.prettierignore` and `configs/**` in its ESLint `ignores`. The erp-api and erp-web `Dockerfile`s copy `configs/` before `corepack yarn install`, because the install resolves the `link:` dependency.

## Never edit one copy alone

Change the file in erp-api's copy, then re-copy it into every other consumer, from the project root. Each copy keeps its own `README.md`, so the copy skips it:

```sh
for c in erp-web erp-docs/05-templates/backend-module erp-docs/05-templates/frontend-feature; do rsync -a --checksum --delete --exclude README.md erp-api/configs/ "$c/configs/"; done
for r in erp-api erp-web; do cp erp-api/configs/lefthook.yml "$r/lefthook.yml"; done
```

## What is not here

Coverage thresholds and mutation (Stryker) scores are repository state, not shared configuration: each repository ratchets its own numbers, so they live in that repository.

## Switching to an installed package

1. Publish `@erp/configs` from this folder.
2. In every consumer, replace `link:./configs` with the published version.
3. Delete the copies. Scripts that run `node configs/scripts/...` change to `node node_modules/@erp/configs/scripts/...`.

No import changes: every consumer already imports `@erp/configs/...`.
