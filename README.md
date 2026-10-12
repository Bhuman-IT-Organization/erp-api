# erp-api

The ERP backend: NestJS 12 on the Fastify adapter, built as a modular monolith with one facade per module (ADR-0001). Yarn 4 via corepack, one committed lockfile, no npm or pnpm anywhere (ADR-0018). This repository lives beside `erp-web`, `erp-infra` and `erp-legacy` in the fixed workstation layout (ADR-0011); relative paths in scripts depend on that layout.

## Prerequisites

- Node 22.16 (pinned in `.node-version`; use fnm or volta) and corepack, which ships with Node.
- If `corepack enable` fails with EPERM on Windows (no admin rights), skip it and prefix commands with `corepack yarn`, or run `corepack enable --install-directory "$env:LOCALAPPDATA\corepack-shims"` once and add that folder to your PATH. Never call bare `yarn`: on a machine with a global Yarn 1 it silently runs the wrong version.
- Docker Desktop for the local stack (MySQL, Redis, Nginx) in `../erp-infra` (plan 06).

## Run locally

There is no `.env` in this repository (ADR-0014). `src/shared/config/env.schema.ts` is the documentation of every variable. Local values are rendered by `node ../erp-infra/scripts/render-local-env.mjs` into `../erp-infra/env/local/api.host.env`; `corepack yarn start:local` loads that file.

```bash
corepack yarn install
corepack yarn db:generate   # generate the Prisma client from the committed prisma/schema.prisma (no database needed)
corepack yarn check         # typecheck + lint + check:arch + format + unit tests; must be green before a PR
corepack yarn lint          # the full typed ESLint needs up to 6 GB of heap, so the script runs it as node --max-old-space-size=6144 on every OS; no NODE_OPTIONS to set
corepack yarn check:arch    # proves the architecture block in eslint.config.mjs fires: writes one throwaway probe per scope into src/, lints it, removes it (scripts/check-architecture-lint.mjs)
corepack yarn start:local   # build, then run with the erp-infra local env
```

With the legacy stack running (`node ../erp-infra/scripts/local-up.mjs`, or `node ../erp-infra/legacy-local/setup.mjs` for the database alone):

```bash
corepack yarn db:validate   # prisma validate with the local DATABASE_URL
corepack yarn db:pull       # re-introspect 127.0.0.1:33061, prisma format, regenerate prisma/INTROSPECTION.md
corepack yarn check:db      # validate + report; fails if INTROSPECTION.md or model-table-map.json would change, or if DATABASE_URL lacks connection_limit= (ADR-0031)
corepack yarn test:int      # integration tests (src/**/*.int.spec.ts) against the local database
corepack yarn test:e2e      # the wave-0 stack proof (../erp-infra/scripts/verify-wave0.mjs) over the wire through Nginx; needs `node ../erp-infra/scripts/local-up.mjs` first, restores the test row and the stack when it ends
```

In Docker: `node ../erp-infra/scripts/local-up.mjs` builds the image from `Dockerfile` (`node:22-bookworm-slim`, no env baked in; Compose injects `../erp-infra/env/local/api.env`). The image runs `prisma generate` and `tsc`, then copies the engine into `dist/` (`scripts/copy-generated-runtime.mjs`, also part of `corepack yarn build` on the host).

`GET /health` (container healthcheck) and `GET /api/v1/health` (through Nginx) both answer `{"status":"ok","checks":{"db":"ok","redis":"ok","breakers":{"legacy":"closed"}}}`; a failing probe turns it into a 503 with the same body shape, while a breaker state never changes `status`. The `redis` probe is registered only when `REDIS_URL` is set.

## Database mirror and ownership guard

`prisma/schema.prisma` is a read-only mirror of the legacy database introspected from the LOCAL stack (never the client's server) — see `prisma/INTROSPECTION.md` for what is ignored and why. It is committed exactly as `prisma db pull` + `prisma format` wrote it; no model is hand-edited. The generated client (`src/shared/db/generated/`) is gitignored and produced by `corepack yarn db:generate`.

`prisma/ownership.json`, `prisma/ownership-node.json` and `prisma/ownership-cowrites.json` are the ownership registers, and this repository holds the only copies: an ownership decision is made by editing them here, in the same change as the code it allows.

`src/shared/db/ownership-guard.ts` rejects, outside production, every write to a table not owned by `node` (ADR-0029, the second line of defence of erp-docs `03-architecture/05-strangler-fig-migration.md`); today every table except `tblstaff`, which the auth module owns for its identity columns (ADR-0030, Phase 1.3; see `src/v1/auth/README.md`). It is a Prisma client extension applied by `PrismaService`, the only client the application exposes: model writes (`create`, `update`, `delete`, `upsert`, `*Many`), `$executeRaw*`, and any `$queryRaw*` not starting with `SELECT`/`SHOW`/`EXPLAIN`/`DESCRIBE`/`WITH` throw `OwnershipViolationError` before reaching the engine. `OWNERSHIP_GUARD=off` is refused unless `NODE_ENV=production`.

## Why Prisma 6, not 7

Prisma 7.x (`prisma@7.10.0`, `@prisma/client@7.10.0`, Apache-2.0) requires a driver adapter for MySQL, and the only official one, `@prisma/adapter-mariadb@7.10.0`, depends on `mariadb@3.4.5`, licensed **LGPL-2.1-or-later**. ADR-0017 permits only MIT, Apache-2.0, BSD and ISC. This repository therefore uses **Prisma 6.19.3** (`prisma@6.19.3` dev, `@prisma/client@6.19.3`, both Apache-2.0), whose built-in query engine (Apache-2.0) needs no driver adapter and no LGPL package. `prisma`'s npm `latest` tag currently points at `8.0.0-rc.15` — always pin the exact version, never `latest`. Moving to Prisma 7 later needs either a permissive MySQL adapter or an ADR that supersedes ADR-0017's list; that is the lead's decision.

## Folder tree

```text
src/
  main.ts                                   # bootstrap: Fastify adapter, global prefix api/v1, fatal process handlers
  app.module.ts                             # root: ConfigModule, HealthModule, V1Module, IntegrationsModule
  ambient.d.ts                              # ambient aliases needed because skipLibCheck is false
  reset.d.ts                                # loads @total-typescript/ts-reset
  shared/                                   # cross-cutting, generic, never module-specific (README inside)
    config/   env.schema.ts, app-config.ts, config.module.ts   # zod-validated env, fail fast; the only process.env reader
    http/     api-prefix.ts, compression.ts, fastify-plugins.ts, openapi.ts, status.ts, auth/, guards/, decorators/   # prefix + JWKS path, compression, cookie/CSRF plugins, @ApiZod + the generated OpenAPI document, named statuses, verifier port, JwtAuthGuard/PermissionGuard
    errors/   app-error.ts, error-codes.ts, problem-details.filter.ts   # ERP-* catalog and the one place an error becomes HTTP
    resilience/ retry.ts, breaker.ts, timeout.ts, resilience.module.ts # withRetry, opossum breakers (state on /health), timeoutSignal (ADR-0031)
    events/, logger/, cache/                                     # domain-event publisher port, redacting winston logger, redis client
    health/   health.types.ts, health.service.ts, health.controller.ts, health.module.ts
    db/       prisma.service.ts, db.module.ts, ownership.ts, ownership-guard.ts; generated/ is gitignored
    <area>/__tests__/                       # every shared spec sits in a __tests__ folder beside its code (src/__tests__/test-placement.spec.ts rejects a colocated one)
  __tests__/
    app.e2e.int.spec.ts                     # boots AppModule against the local stack: health, JWKS, compression, docs, a real login (yarn test:int)
    test-placement.spec.ts                  # every *.spec.ts under src/ has __tests__ as its parent folder
  v1/
    v1.module.ts                            # registers every v1 module
    auth/                                   # identity for the whole ERP (wave 0): login, refresh, logout, me, csrf, legacy-sso, JWKS (README inside)
      auth.module.ts                        # @Global(); provides ACCESS_TOKEN_VERIFIER for the shared guards
      index.ts                              # facade, public types, AUTH_HTTP_SECURITY (cookie/CSRF constants for main.ts)
      controller/auth.controller.ts, jwks.controller.ts
      service/auth.service.ts               # the orchestrator; validator, enricher, transformer, transport, lockout-policy, password-hasher, token-issuer beside it
      repository/auth.repository.ts, auth-session.store.ts (port), redis-auth-session.store.ts, in-memory-auth-session.store.ts
      __tests__/                            # one spec per layer + auth.controller.e2e.spec.ts (Fastify inject) + *.int.spec.ts
    example-item/                           # the backend module skeleton (erp-docs `05-templates/backend-module`); a new module starts as a copy of it
      example-item.module.ts                # wiring; exports only the facade
      example-item.routes.ts                # route constants
      index.ts                              # public surface: facade + public types
      controller/example-item.controller.ts # HTTP entry, no logic, never catches
      service/example-item.service.ts       # orchestrator: validate -> repository -> enrich -> transform
      service/example-item.validator.ts     # request schemas + business rules
      service/example-item.enricher.ts      # computed fields, other modules via facade, cache reads
      service/example-item.transformer.ts   # entity -> response DTO
      service/example-item.transport.ts     # outbound adapters
      repository/example-item.repository.ts # the only Prisma caller in the module
      model/example-item.model.ts           # domain types
      dto/example-item.dto.ts               # zod schemas and z.infer DTOs
      events/published.ts, subscribed.ts    # domain events (ADR-0029)
      facade/example-item.facade.ts         # the only import surface for other modules
      __tests__/                            # one spec per layer + e2e (Fastify inject) + repository int spec
      README.md                             # module doc: owned tables, facade, endpoints, events, jobs, layers
  integrations/
    integrations.module.ts                  # ports and adapters home (README inside)
configs/                                    # the shared configs (tsconfig, ESLint, Prettier); erp-web holds the same files
eslint-suppressions.json                    # ESLint bulk suppressions: the violations that existed when the Phase 4 rules were switched on; total pinned by check:ratchet
REFACTOR-BACKLOG.md                         # generated by corepack yarn check:ratchet --write from eslint-suppressions.json; never edited by hand
vitest.config.mts                           # spreads @erp/configs/vitest/base; coverage over an explicit include with per-layer thresholds (test:coverage, in check:phase)
stryker.config.mjs                          # test:mutation over services, validators, enrichers, transformers, dto, guards and contracts; thresholds.break raised only
lefthook.yml                                # copy of configs/lefthook.yml: the git hooks (see Git hooks)
commitlint.config.mjs                       # re-exports @erp/configs/commitlint (commit-msg)
lint-staged.config.mjs                      # re-exports @erp/configs/lint-staged (pre-commit)
.github/workflows/check.yml                 # dormant CI: workflow_dispatch only, runs corepack yarn check
.github/workflows/mutation.yml              # dormant: workflow_dispatch only, runs corepack yarn test:mutation
```

`shared/` and `integrations/` are unversioned; a module is copied into `v2/` only when its contract changes.

## Identity (wave 0)

The `v1/auth` module (ADR-0005, ADR-0030; `src/v1/auth/README.md`) signs RS256 access tokens and keeps rotating refresh tokens in Redis. Configuration, all in `src/shared/config/env.schema.ts`: `AUTH_JWT_PRIVATE_KEY_PEM` (base64 PKCS8, rendered per machine by erp-infra, never committed), `AUTH_JWT_ISSUER`, `AUTH_JWT_AUDIENCE`, `AUTH_REDIS_DB` (the auth keys' own logical database), `AUTH_COOKIE_SECURE` (`false` only on the plain-http local origin). TTLs live in `src/shared/config/timings.ts` (`TIMINGS.auth`: 15 min access, 30 d refresh, lockout 5 failures then 1 min doubling to 15 min).

- Endpoints: `POST /api/v1/auth/login|refresh|logout|logout-all`, `GET /api/v1/auth/me|csrf|legacy-sso`, and the public key set at `GET /.well-known/jwks.json` (outside the prefix; `Cache-Control: public, max-age=300`).
- Cookies: `erp_refresh` (httpOnly, SameSite=Strict, `Path=/api/v1/auth/refresh`) carries the refresh token; `erp_csrf` (httpOnly, SameSite=Strict, `Path=/api/v1/auth`) is the double-submit secret. The client echoes the `csrfToken` from the login/refresh body in the `x-csrf-token` header on `refresh`, `logout` and `logout-all`; a missing or wrong token is 403 `ERP-AUTH-0008`. `@fastify/cookie` and `@fastify/csrf-protection` are registered in `src/shared/http/fastify-plugins.ts` with the constants the module exports (`AUTH_HTTP_SECURITY`).
- Guards anywhere: `@UseGuards(JwtAuthGuard, PermissionGuard)` from `src/shared/http/guards/` resolve the verifier `AuthModule` provides globally.

Resilience (ADR-0031): the api's own calls to the legacy system (`LEGACY_BASE_URL`) go through the `legacy` breaker in the auth transport; `GET /api/v1/auth/legacy-sso` (bearer) reports whether the legacy `erp_sso` module is `ready`. While the breaker is open the endpoint answers 503 `ERP-UPSTREAM-0001` with `Retry-After` and makes no network call; `/health` and `/api/v1/health` list every created breaker under `checks.breakers` (state word only) without degrading `status`. Login is never retried (the lockout counter makes a retried verify non-idempotent). `RESILIENCE_BREAKER_VOLUME_THRESHOLD` and `RESILIENCE_BREAKER_HALF_OPEN_AFTER_MS` shrink the breaker for the local stack proof and are refused in production. `corepack yarn check:db` fails when the rendered `DATABASE_URL` carries no `connection_limit=` (`scripts/check-database-url.mjs`): pools are explicit.

## API documentation

`GET /api/v1/docs` is the Swagger UI and `GET /api/v1/openapi.json` the OpenAPI 3.1 document, both generated at boot by `src/shared/http/openapi.ts` from the `@ApiZod({ … })` decorator every handler carries: request, query, params and response schemas are the module's zod DTOs turned into JSON Schema with `z.toJSONSchema()`, every error is `application/problem+json` with the `ProblemDetails` schema and the `code` enum the handler declares, and `x-request-id` is documented on every response. Nothing is written twice and no `@ApiProperty` class exists. `src/v1/__tests__/openapi-covers-routes.spec.ts` fails when a registered route has no operation or an operation has no success schema. `API_DOCS_ENABLED` (`src/shared/config/env.schema.ts`) defaults to `true` outside production and `false` in it; when disabled neither route exists (404). The erp-infra env templates need no change: the default applies.

## Refactor backlog

`REFACTOR-BACKLOG.md` lists, per file and rule, the violations of the Phase 4 code-shape rules (complexity, nesting, nested loops, queries in loops, timers, flags, TSDoc on the door surface, disabled tests) that existed when those rules were switched on as errors (D-07, D-08). They are ESLint bulk suppressions in `eslint-suppressions.json`: `corepack yarn lint` tolerates exactly those counts per file and rule, and any new violation, in a new file or an old one, fails. The backlog is generated by `corepack yarn check:ratchet --write`, never edited by hand, and `corepack yarn check:ratchet` (in `check`) fails when it is stale or when the total differs from the `--expect` pinned in `package.json`.

A fix lowers the pin in the same commit: fix the code, run `corepack yarn lint:prune` (ESLint fails on a suppression left without a violation), then `corepack yarn check:ratchet --write`, and set `--expect` to the total it prints. The pin only goes down; adding a suppression to hide a new violation fails `check:ratchet`. `check:cycles` (dependency-cruiser `no-circular`, type-only imports included) runs over `src` and `packages/contracts/src` with no known cycle; Prisma's generated client is outside it.

## Test gates

- `corepack yarn test`: the whole Vitest suite, fast; what pre-push runs.
- `corepack yarn test:coverage`: the same suite with V8 coverage over an explicit `include` (an untested file counts as 0), failing when the global value or any per-layer threshold in `vitest.config.mts` is not met (services, validators, enrichers and transformers, `dto`, the permission guards, `@erp/contracts`). It runs in `check:phase` at each phase close; `check` runs plain `test`. The thresholds are the measured values, floored: raise one when coverage rises, never lower it.
- `corepack yarn test:mutation`: Stryker over the critical layers in `stryker.config.mjs`, weekly and on demand by a named person, never in a hook or `check` (it takes minutes to an hour). It fails when the mutation score is under `thresholds.break`, the tracked score: raise `break` in a commit when a run scores higher, never lower it. Its output (`reports/`, `.stryker-tmp/`) is per machine and ignored; `reports/stryker-incremental.json` makes the next run fast.
- **`test:mutation` is parked:** `@stryker-mutator/vitest-runner` 10.0.0 runs no tests per mutant under Vitest 5.0.1, so its score is not valid and `thresholds.break` is `null`. Set `break` only after a runner release kills mutants in erp-api's `src/shared/http/guards/permission.guard.ts`.

## Git hooks

`corepack yarn install` installs them: the `postinstall` runs `node configs/scripts/git-hooks.mjs install`, which calls `lefthook install` (pre-commit, commit-msg, post-merge, post-rewrite) and then writes `.git/hooks/pre-push` itself, only inside a git checkout and never in CI or a Docker build. pre-push is not lefthook's because lefthook skips its pre-push commands when the branch has no new file changes, which would let an unchanged branch reach `main`. Yarn runs the `postinstall` on a fresh clone or a dependency change; to reinstall the hooks by hand, run `node configs/scripts/git-hooks.mjs install`. `lefthook.yml` comes from `configs/lefthook.yml`, and erp-web holds the same `configs/`; change both together.

| Hook                         | What it runs                                                                                                                                                       | Cost (measured on the lead's machine)                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `pre-commit`                 | `lint-staged` on the staged files only: `eslint --fix` then `prettier --write` on TypeScript, `prettier --write` on the rest; skipped during a merge or rebase     | about 11 s with a TypeScript file staged (one typed ESLint start), a few seconds without |
| `commit-msg`                 | `commitlint`: `type(scope): subject` with a scope, no em dash in the header, no `Co-Authored-By` or `Generated with` line; no length limit                         | about 2.3 s                                                                              |
| `pre-push`                   | refuses a push to `main` and a push holding a merge commit (history is rebase-only), then `corepack yarn check:push` (`typecheck` and `test`), one after the other | about 65 s (the guard under 1 s)                                                         |
| `post-merge`, `post-rewrite` | `corepack yarn install` when the pull changed `yarn.lock` (a `git pull --rebase` fires `post-rewrite`)                                                             | 0 s unless the lockfile changed                                                          |

Before merge, run the full `corepack yarn check` and paste its output in the PR: the hooks are its fast part, and `check` ends with `check:audit` (`yarn npm audit --all --recursive --severity high`), which needs the network and so runs in no hook. An advisory with no fix in the same major is listed in `.yarnrc.yml` `npmAuditIgnoreAdvisories` with its package and reason, and reviewed at the next dependency bump.

- `git commit --no-verify` and `git push --no-verify` skip the hooks, and `LEFTHOOK=0` skips the lefthook ones (not pre-push); nothing on GitHub notices while CI is parked. The pasted `check` output in the PR is the control.
- A push to `main` the lead intends: `ERP_ALLOW_MAIN_PUSH=1 git push ...` (PowerShell: `$env:ERP_ALLOW_MAIN_PUSH='1'; git push ...; Remove-Item Env:ERP_ALLOW_MAIN_PUSH`), for that one command only.
- A GUI git client started outside a terminal (from the macOS Dock, for example) may not see `node` and `corepack` installed through a version manager, so a hook fails with "command not found". Start the client from a terminal, or point lefthook's `rc:` option at the file that sets your `PATH`.

`.github/workflows/check.yml` (`corepack yarn check`) and `mutation.yml` (`corepack yarn test:mutation`) are dormant: `workflow_dispatch` only, until CI is switched on (one commit).

## Dependencies

ADR-0017 requires a line here for every dependency stating why it is present and under which licence. Versions are exact pins in `package.json`; `corepack yarn install --immutable` is what CI and the Dockerfile run.

- `@fastify/compress` (MIT) — gzip/brotli for the api's own JSON and text responses above `HTTP.compress.thresholdBytes`; Nginx does not recompress api locations, so each body is compressed once (ADR-0031 §6).
- `@fastify/cookie` (MIT) — cookie parsing and `reply.setCookie` for the refresh and CSRF cookies on the Fastify adapter (ADR-0005).
- `@fastify/csrf-protection` (MIT) — double-submit CSRF for `POST /api/v1/auth/refresh|logout|logout-all` (07-security).
- `@fastify/static` (MIT) — peer dependency of `@nestjs/swagger` on the Fastify adapter; serves the Swagger UI assets under `/api/v1/docs` (only when `API_DOCS_ENABLED`).
- `@nestjs/common` (MIT) — decorators, DI, pipes, guards, filters: the framework's public API. See ADR-0001.
- `@nestjs/core` (MIT) — the Nest runtime: module graph, injector, router. See ADR-0001.
- `@nestjs/platform-fastify` (MIT) — the Fastify adapter; roughly twice Express's throughput at no code cost. See ADR-0001.
- `@nestjs/swagger` (MIT) — builds the OpenAPI 3.1 document from route metadata and serves the Swagger UI (`src/shared/http/openapi.ts`, BE-23); every schema comes from the zod DTOs through `z.toJSONSchema()` — no `@ApiProperty` class, no second schema library. Pulls `swagger-ui-dist` (Apache-2.0), whose `@scarf/scarf` (Apache-2.0) install-time telemetry is disabled by `dependenciesMeta` in `package.json`.
- `reflect-metadata` (Apache-2.0) — polyfill that stores `design:paramtypes` so Nest's constructor injection works.
- `rxjs` (Apache-2.0) — peer dependency of Nest; interceptors and the event pipeline are Observables.
- `zod` (MIT) — the one validation library: env schema, request/response DTOs, shared with the frontend through @erp/contracts. See ADR-0010.
- `@prisma/client` (Apache-2.0) — database client over the read-only mirror; ADR-0003.
- `bcryptjs` (BSD-3-Clause) — pure-JS bcrypt: verifies the legacy `$2a$`/`$2y$` staff hashes and re-hashes at cost 12 as `$2y$12$`, no native build (ADR-0017).
- `ioredis` (MIT): Redis client: the health probe and cache client (`shared/cache`) plus the auth module's own session-store client on `AUTH_REDIS_DB`; BullMQ's connections on `QUEUE_REDIS_DB` (ADR-0005, BE-14).
- `jose` (MIT) — RS256 sign/verify, `kid` thumbprints and the JWKS document (ADR-0005).
- `opossum` (Apache-2.0) — the circuit breaker behind `shared/resilience/breaker.ts`, one per external system; retry stays in our own `withRetry` and the timeout is ours, so only the breaker state machine comes from the library (ADR-0031 §3).
- `winston` (MIT) — structured logging with the redaction list from 07-security.
- `write-excel-file` (MIT): the Excel export, typed cells and never a formula (`src/shared/http/xlsx.ts`); approved in ADR-0043.
- `pdfkit` (MIT): the PDF export on its standard fonts (`src/shared/http/pdf.ts`); approved in ADR-0043.
- `@tus/server` (MIT): the tus 1.0.0 server behind `/api/v1/uploads`, resumable uploads (`src/shared/uploads/uploads.service.ts`); approved in ADR-0041. Pulls `srvx` (MIT), its Node request adapter.
- `@tus/file-store` (MIT): tus staging on the files volume under `FILE_STORAGE_DIR/.tus`; approved in ADR-0041.
- `bullmq` (MIT): the background-job queue on Redis db 2, with retries, delayed and repeatable jobs and a dead-letter queue per queue (`src/shared/queue/`, BE-14); ADR-0017's chosen queue, approved in ADR-0041. It drives our `ioredis`; its other client peers (`pg`, `redis`, `bullmq-otel`) are optional and not installed.
- `file-type` (MIT): magic-byte sniffing of a complete upload before it is stored (`src/shared/uploads/sniff.ts`); approved in ADR-0041.
- `@nestjs/testing` (MIT, dev) — `Test.createTestingModule` for in-process module and controller tests.
- `@swc/core` (Apache-2.0, dev) — compiler used by `unplugin-swc`; emits decorator metadata that esbuild cannot.
- `@total-typescript/ts-reset` (MIT, dev) — tightens built-in types (`JSON.parse` returns `unknown`, `.filter(Boolean)` narrows). Loaded by `src/reset.d.ts`.
- `@types/node` (MIT, dev) — Node 22 type definitions.
- `@types/opossum` (MIT, dev) — typings for opossum, which ships none.
- `@types/pdfkit` (MIT, dev): pdfkit ships no types; approved in ADR-0043.
- `fflate` (MIT, dev): unzips an xlsx in `xlsx.spec.ts` to prove the cells; approved in ADR-0043.
- `@erp/configs` (`link:./configs`, dev): the shared configs, held in `configs/` (the base of `tsconfig.json`, `eslint.config.mjs` and `prettier.config.mjs`); no licence of its own to vet.
- `@eslint-community/eslint-plugin-eslint-comments` (MIT, dev) — `require-description`: every `eslint-disable` carries a `-- reason` (the `HYGIENE` object in `eslint.config.mjs`, BE-24); an unused directive is ESLint's own `reportUnusedDisableDirectives`.
- `@vitest/eslint-plugin` (MIT, dev) — `no-focused-tests`, `no-disabled-tests`, `expect-expect`, `no-identical-title` on every spec (`TEST_HYGIENE`, BE-24).
- `dependency-cruiser` (MIT, dev): the import graph behind `check:cycles`; its `no-circular` rule (`configs/dependency-cruiser.cjs`) fails on any circular import, type-only imports included (TS-15).
- `dotenv-cli` (MIT, dev) — loads `../erp-infra/env/local/api.host.env` for `start:local` without any env file in this repo. See ADR-0014.
- `eslint` (MIT, dev) — the lint runner behind `yarn lint`.
- `eslint-plugin-jsdoc` (BSD-3-Clause, dev): `jsdoc/require-jsdoc` on the door surface (`src/shared`, module facades, `packages/contracts/src`), so every exported door carries a TSDoc block (QA-06). Pinned at 63.3.3: 64.x needs Node 22.22 (D-14).
- `prettier` (MIT, dev) — formatting; `endOfLine: 'lf'` keeps every file LF on Windows.
- `prisma` (Apache-2.0, dev) — introspection, validation, client generation; pinned exactly, `latest` is a release candidate. See "Why Prisma 6, not 7".
- `typescript` (Apache-2.0, dev): compiler; the locked strictness flags live in `configs/tsconfig/base.json`, which `tsconfig.json` extends.
- `typescript-eslint` (MIT, dev) — `strictTypeChecked` + `stylisticTypeChecked` typed lint base; the architecture block in `eslint.config.mjs` (core `no-restricted-imports` / `no-restricted-syntax` / `no-magic-numbers` scopes, no plugin) is the layer enforcement, proven by `corepack yarn check:arch`, which also proves the `HYGIENE` / `TEST_HYGIENE` objects after it (`no-console`, `no-debugger`, `eqeqeq`, described disable directives, `vitest/no-focused-tests`).
- `unplugin-swc` (MIT, dev) — Vite/Vitest plugin that runs SWC so Nest decorator metadata exists under test. See ADR-0016.
- `vite` (MIT, dev) — peer of vitest; pinned here so it resolves from this repository and not from an unrelated parent folder (Phase 1.1 finding).
- `vitest` (MIT, dev) — the test runner in both application repositories. See ADR-0016.
- `@vitest/coverage-v8` (MIT, dev): V8 coverage for `test:coverage`, the per-layer coverage gate in `check:phase` (thresholds in `vitest.config.mts`, TEST-04).
- `@stryker-mutator/core` (Apache-2.0, dev): the mutation tester behind `test:mutation` (`stryker.config.mjs`, TEST-05).
- `@stryker-mutator/vitest-runner` (Apache-2.0, dev): runs this repository's Vitest suite for each mutant.
- `lefthook` (MIT, dev): the git hook runner; `lefthook.yml` holds the chain (see Git hooks).
- `lint-staged` (MIT, dev): runs ESLint and Prettier on the staged files only (pre-commit). Pinned at 16.4.0: 17.x needs Node 22.22 (D-14).
- `@commitlint/cli` (MIT, dev): checks each commit message (commit-msg) against `commitlint.config.mjs`.
- `@commitlint/config-conventional` (MIT, dev): the conventional-commit rule set that `@erp/configs/commitlint` extends.

Outbound HTTP is Node 22's built-in `fetch` behind `shared/resilience/`; `got`, `axios`, `node-fetch` are not permitted and `undici` only inside `shared/resilience/` (ADR-0031 §6).

No copyleft or paid dependency (ADR-0017).

## Known deviations

- Strictness flags: none relaxed. `tsc --noEmit` over the 409-model generated client passes under every locked flag (the generator emits `// @ts-nocheck` files, so the fallback ladder in plan 01.2-04 was not needed).
- `src/**/*.int.spec.ts` read `process.env.DATABASE_URL` once, only to skip themselves when no database is configured; application code still has exactly one `process.env` reader (`env.schema.ts`).
