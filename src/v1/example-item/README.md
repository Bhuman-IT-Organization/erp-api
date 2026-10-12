# example-item

## Purpose

The module skeleton every backend module starts from: one folder in the approved per-module tree with every layer present, compiling, linting under the architecture block and testing green. It serves exactly what erp-docs' `05-templates/frontend-feature` builds in erp-web — a list, a record, create, update and an export in CSV, Excel, PDF and print rows — so a module and its screens work together the day both are copied. It owns no business rule; a real module replaces the fields and keeps the shape.

It is the checked-in copy of erp-docs' `05-templates/backend-module`; change the template and this copy together. `v1/identity` (a list, its export and the writes on real tables) and `v1/branding` (the smallest complete module) are the built references this skeleton follows.

## Owned tables

None. The rows live in a bounded in-memory store behind the repository seam (`EXAMPLE_ITEM_MEMORY_MAX_ROWS`; the oldest row is evicted past it), so every other layer runs before the module owns a table, and a restart empties it. To claim a table: add it to `prisma/ownership.json` with owner `node` (ADR-0029, ADR-0030), run `corepack yarn db:generate`, inject `PrismaService` and replace each repository method with the one delegate call its doc comment shows, write `__tests__/example-item.repository.int.spec.ts` (module-shape requires it once the repository reads `this.prisma`), and list the table here as `` `tbl<name>` `` — owner since which phase, the columns Node writes, the columns the legacy system still writes (a recorded coexistence exception) — one bullet per table.

## Facade surface

- `describe(): { module: 'example-item'; version: 1 }`
- `findById(id: number): Promise<ExampleItem | null>` — the model, never the wire DTO, whoever owns the row

Other modules import only `src/v1/example-item/index.ts` (the facade and the `ExampleItem` / `ExampleItemId` types); the architecture block in `eslint.config.mjs` rejects a deeper path.

## Endpoints

Under `api/v1/example-item` (`EXAMPLE_ITEM_ROUTES` in `example-item.routes.ts`). Every handler carries `JwtAuthGuard, PermissionGuard` (`__tests__/route-gates.spec.ts` classifies each against the screen that calls it). Every failure is an RFC 9457 problem (`application/problem+json`) with an `ERP-*` code: 400 `ERP-VALIDATION-0001` (+ `issues`), 401 `ERP-AUTH-0004`, 403 `ERP-AUTH-0005`.

| Method  | Path     | Codes                                 | Success                                                                                                                                                                                                                                                                                                   | Errors beyond the three                                                                            |
| ------- | -------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `GET`   | ``       | any of `view`, `viewOwn` + `@Scope()` | 200 `{ data, meta: { nextCursor, prevCursor, total, rangeStart, exportLimit, printLimit } }`; `?limit` (1–500, default 50) `&cursor&q&sort` (`id`, `name`)                                                                                                                                                | —                                                                                                  |
| `GET`   | `export` | any of `view`, `viewOwn` + `@Scope()` | 200 by `?format=`: `csv` (absent; `text/csv; charset=utf-8`, BOM), `xlsx`, `pdf` (each `attachment; filename="example-item-YYYY-MM-DD.<ext>"`) or `print` (`application/json` rows, no attachment); `no-store` always; `?q&sort&column&header&key...` and, for pdf and print, the presentation parameters | 400 on `export` over the format's cap, on `key`, on `font` for a PDF the standard font cannot draw |
| `GET`   | `:id`    | any of `view`, `viewOwn` + `@Scope()` | 200 the record                                                                                                                                                                                                                                                                                            | 404 `ERP-CORE-0004`                                                                                |
| `POST`  | ``       | `create`                              | 201 the record; the caller is its owner                                                                                                                                                                                                                                                                   | —                                                                                                  |
| `PATCH` | `:id`    | `edit`                                | 200 the record                                                                                                                                                                                                                                                                                            | 404 `ERP-CORE-0004`                                                                                |

The codes are `EXAMPLE_ITEM_PERMISSIONS`: the module's own `example-item.*` names, in no `@erp/contracts` catalogue, so only an administrator holds them — the fail-closed default, matching the `ADMIN_GATE` the generated screens carry. Declare them in `@erp/contracts` (with the Perfex mapping), import them in `example-item.routes.ts` and replace `ADMIN_GATE` with the view code in both `ROUTE_GATES`: the two flip together.

A list response is `{ data, meta }`; a single resource is a bare body; the request id is never in a body — it travels in the `x-request-id` response header. The cursor is opaque and bound to its `sort`: send `meta.nextCursor` or `meta.prevCursor` back with the same `sort`; another sort's cursor, a tampered one or a `filter[…]` (this list takes none) is a 400. The export (ADR-0043) runs on the shared core (`shared/http/export.ts`) and takes the list's `q` and `sort` (never `limit` or `cursor`, each a 400), `format` (`csv`, the default, `xlsx`, `pdf` or `print`), `column` (a subset of `id`, `name`, `label`, `createdAt`, answered in that order), one translated `header` label per exported column, and for pdf and print the presentation parameters (`title`, `yes`, `no`, `blank`, `dateFormat`, `timeFormat`, `timeZone`). **This list takes the ticked rows** (D-27): each `key` is a row id (at most 500, each a positive integer, else a 400 on `key`), and the keys become the request's `ids`, AND-ed in the repository with `q` and the row scope, so a key only ever narrows: under `viewOwn` a key naming another member's row exports no row, never that row (D-03). The core counts first and refuses more than 10,000 rows for csv and xlsx, or 1,000 for pdf and print, on path `export` with `params: { limit, total }` before reading a row (the list meta carries both caps, `exportLimit` and `printLimit`); a PDF whose text the standard font cannot draw is refused on path `font`, while print answers it. A missing id and a row `viewOwn` hides answer the same 404, so an id reveals nothing; a non-numeric id is a 400. The bodies are strict: `id`, `createdAt`, `internalRef` or `ownerStaffId` is a 400 naming the key. `POST` is unkeyed, like `v1/identity`'s `POST members`: BE-15's idempotency interceptor is built by the first module that needs a keyed POST.

## Events published

| Event                         | When                   | Payload                               |
| ----------------------------- | ---------------------- | ------------------------------------- |
| `example-item.record.created` | after `POST` stores it | `{ id, at }` — `ExampleItemCreatedV1` |
| `example-item.record.updated` | after `PATCH` saves it | `{ id, at }` — `ExampleItemUpdatedV1` |

Declared in `events/published.ts` (`EXAMPLE_ITEM_PUBLISHED_EVENTS`), published through `DOMAIN_EVENT_PUBLISHER` (`shared/events/`) from `service/example-item.transport.ts`. Keep `events/published.ts` and this table in step — the module-shape spec compares the event classes' `NAME`s with the first column here.

## Events subscribed

None. Listed in `events/subscribed.ts` (`EXAMPLE_ITEM_SUBSCRIBED_EVENTS`); handlers live in `events/handlers/` and are the only way another module's change reaches this one.

## Jobs

None. A `jobs/` folder arrives with `shared/queue/` (built by the first module that needs a job; the module-shape spec rejects `jobs/` until then).

## Resilience

ADR-0031: every outbound call goes through `src/shared/resilience/` from `service/example-item.transport.ts` and nowhere else — the `fetch` and `shared/resilience/*` scopes of the architecture block in `eslint.config.mjs` enforce it. This skeleton makes no outbound call; the nesting a real module uses (retry outside the breaker, timeout on the request) is the doc comment in the transport.

- **Breaker:** none — no outbound HTTP, no vendor call. (Otherwise one name from `BREAKER_NAMES`, created in the transport's constructor so `/api/v1/health` lists it from boot.)
- **Retry policy:** none — the store is in process memory and the events are in-process; a write is never retried (an unkeyed `POST` retried could create two rows). (Otherwise a `RETRY_POLICIES.<name>` per outbound operation with the idempotency argument that makes the retry safe.)
- **Pool budget:** none today — no database read. After the swap it shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`, asserted by `check:db`); no extra DB or Redis client.

## Layers

| File                                          | Responsibility                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `example-item.module.ts`                      | Wires every layer as a provider; exports the facade only; not `@Global()`                                                                                                                                                       |
| `example-item.routes.ts`                      | `EXAMPLE_ITEM_ROUTES` (`base`, `list`, `export`, `record`), `EXAMPLE_ITEM_PERMISSIONS` (`view`, `viewOwn`, `create`, `edit`), `EXAMPLE_ITEM_EXPORT_COLUMNS`, `EXAMPLE_ITEM_EXPORT_FILE_STEM`                                    |
| `controller/example-item.controller.ts`       | The five handlers, each `@UseGuards(JwtAuthGuard, PermissionGuard)` + its codes and `@ApiZod`; hands the raw input to the service and returns its DTO. No logic, no transformer import, no try/catch                            |
| `service/example-item.service.ts`             | Use cases `list`, `get`, `create`, `update`, `exportCsv` (every format through `shared/http/export.ts`, the ticked keys as `ids`); `ERP-CORE-0004`; the events after a write; the injectable clock `now`                        |
| `service/example-item.validator.ts`           | `parseListQuery` (BE-19 via `pagination.ts`, one sort from `EXAMPLE_ITEM_SORT_FIELDS`, the cursor bound to it, `q`, no filter), `parseExportList`, `parseParams`, `parseCreateBody`, `parseUpdateBody`; never a Nest exception  |
| `service/example-item.enricher.ts`            | Computed fields (`label`), lookups from other modules via their facade; pure                                                                                                                                                    |
| `service/example-item.transformer.ts`         | Entity → `ExampleItemResponseDto` (the id as a string) / the list envelope with `exportLimit` and `printLimit`, built field by field then parsed through the zod response schema so `internalRef` and `ownerStaffId` never leak |
| `service/example-item.transport.ts`           | Outbound seam: domain events to the publisher port; the only file that may call `fetch` or `shared/resilience/*` (the nesting is its doc comment)                                                                               |
| `repository/example-item.repository.ts`       | The data seam: `list`, `count`, `findById`, `create`, `update` over a bounded in-memory store; the `own` scope only narrows; the swap to the Prisma delegate is its doc comment                                                 |
| `model/example-item.model.ts`                 | `ExampleItem`, `ExampleItemId`, `EnrichedExampleItem`, `ExampleItemSortField`, `ExampleItemListRequest`, `ExampleItemPage`, `NewExampleItem`                                                                                    |
| `dto/example-item.dto.ts`                     | The list, export and params schemas, the strict create body and its `.partial()` update, the response and list-envelope schemas (`EXAMPLE_ITEM_NAME_MAX`, `EXAMPLE_ITEM_SEARCH_MAX`); `z.infer` types                           |
| `events/published.ts`, `events/subscribed.ts` | `ExampleItemCreatedV1`, `ExampleItemUpdatedV1` / none                                                                                                                                                                           |
| `facade/example-item.facade.ts`               | The ONLY surface other modules may import; `describe()`, `findById(id)`                                                                                                                                                         |
| `index.ts`                                    | Public re-exports: facade and public types                                                                                                                                                                                      |
| `__tests__/`                                  | One spec per layer, `example-item.repository.spec.ts` for the store, `route-gates.spec.ts` for the gates; `fakes.ts` = `SEED_ITEMS` + `seedRepository`, `create-example-item-test-app.ts` = the in-process Fastify app          |

## Legacy parity

None: skeleton. A real module lists here the legacy routes it replaces, mapped by hand from the legacy controllers, with the deliberate drops.

## How to run its tests

```bash
corepack yarn test src/v1/example-item          # unit, the store, the gates and the in-process controller e2e spec (stub verifier, no network)
```

There is no int spec until the repository swaps its store for a table; `corepack yarn test:int -- src/v1/example-item` runs it after the swap.
