# knowledge-base

## Purpose

The Knowledge Base list: list, read, create, update, delete and the four-format export of the knowledge base Perfex's purchase requests, orders and quotations, shipping charges, expenses and fixed assets name, replacing Perfex's `admin/knowledge_base` screen. Started as a copy of `cost-centers` (forms: singular `knowledge-base`, plural `knowledge-base`) and reshaped to the table's columns; the screens live under `/setup/knowledge-base` in erp-web, the api under `api/v1/knowledge-base`.

## Owned tables

- `tblknowledge_base`: claimed for `node` in the ownership register, written here through Prisma's typed delegate, which the ownership guard admits because the register names `node`. Node writes `name` (`VARCHAR(255)`); on create only, `created_by` (the signed-in staff id) and `datecreated` (Perfex's wall clock, below); `id` is assigned by the database. An update writes the name and nothing else, so `created_by` and `datecreated` never change after the create (D-31). Perfex's own screen was its one writer (D-27): no co-writer.

`datecreated` (D-31): Perfex's `add` writes PHP's `date('Y-m-d H:i:s')`, and PHP's zone is the `default_timezone` setting when it is set (`application/core/App_Controller.php:59-62`). So the column holds a naive wall clock in the company zone, and Node writes the same: `wallClockAt(now, companyZone(default_timezone))`, stored verbatim. When the setting is empty or not an IANA zone name, the zone is `UTC` (PHP keeps the server's zone, UTC on the client's stack). The wire answers `dateCreated` as the ISO instant that wall clock names in the same zone, or `null` when the column is NULL.

Read only, never written (DB-03):

- `tbloptions.default_timezone` (perfex-core), through `SettingsFacade` (`settings/index.js`) from the transport; never logged and never answered.
- `KNOWLEDGE_BASE_REFERENCES` (the repository's docblock), what refers to a knowledge base, for each row's usage and the delete refusal. A declared candidate list (D-28); before every usage read ONE `information_schema.COLUMNS` probe (every table and column name bound) answers which candidates the connected schema has, and only those run. A missing candidate counts 0 and raises no error, and the probe is never cached, so when the Expenses or shipping-charge slice adds its column with Node's own DDL, this module counts it with no code change. This module never adds a column to any table (never patch Perfex). Each present candidate is one tagged `$queryRaw` over all the ids at once (table and column names literal, ids bound with `Prisma.join`), in one `Promise.all`; an error from the probe or any statement rejects the whole answer (fail closed):

| Group                | Owner           | Table and column                         | Match                                                                  |
| -------------------- | --------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| `purchaseRequests`   | purchase        | `tblpur_request.knowledge_base`          | the id                                                                 |
| `purchaseOrders`     | purchase        | `tblpur_orders.knowledge_base`           | the id                                                                 |
| `purchaseQuotations` | purchase        | `tblpur_estimates.knowledge_base`        | the id                                                                 |
| `shippingCharges`    | (unregistered)  | `tblinv_shipping_charges.knowledge_base` | the id; absent locally, counted once the shipping-charge slice adds it |
| `expenses`           | perfex-core     | `tblexpenses.knowledge_base`             | the id; absent locally, counted once the Expenses slice adds it        |
| `assets`             | fixed_equipment | `tblfe_asset_creation.knowledge_centre`  | the NAME as text, exactly: `CAST(... AS BINARY)`, case-sensitive       |

## Facade surface

- `describe(): { module: 'knowledge-base'; version: 1 }`
- `findById(id: number): Promise<KnowledgeBase | null>`
- `listAll(): Promise<readonly KnowledgeBase[]>`: every knowledge base, the name ascending, then the id (the order Perfex's pickers read); refused loudly (`ERP-INTERNAL-0001`) above `KNOWLEDGE_BASE_FACADE_MAX_ROWS` (1,000), never truncated
- `findByIds(ids: readonly number[]): Promise<readonly KnowledgeBase[]>`: in the order given, each id once, absent ids skipped

`KnowledgeBase` is `{ id: number; name: string }`, never the wire DTO and never `created_by`. No facade method writes or asserts the administrator flag: a module-to-module read has no actor.

## Endpoints

Under `api/v1/knowledge-base` (`KNOWLEDGE_BASE_ROUTES` in `knowledge-base.routes.ts`). All six are administrators only (D-06, D-26): every handler carries `JwtAuthGuard, PermissionGuard` and declares no permission code, and the service asserts the administrator flag as the first statement of every use case, so a member holding every catalogue code is still refused. `@erp/contracts`' `ROUTE_GATES` declares the three screens `'admin'` and `__tests__/route-gates.spec.ts` compares every handler with it. Every failure is an RFC 9457 problem (`application/problem+json`) with an `ERP-*` code: 400 `ERP-VALIDATION-0001` (+ `issues`), 401 `ERP-AUTH-0004`, 403 `ERP-AUTH-0005` (not an administrator).

| Method   | Path     | Success                                                                                                                                                                                                 | Errors beyond the three                                                                 |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET`    | ``       | 200 `{ data, meta: { nextCursor, prevCursor, total, rangeStart, exportLimit, printLimit } }`, each row `{ id, name, dateCreated, usage }`; `?limit&cursor&q&sort` (`-id` default, `id`, `name`)         | none                                                                                    |
| `GET`    | `export` | 200 by `?format=`: `csv` (absent), `xlsx`, `pdf` (each `attachment; filename="knowledge-base-YYYY-MM-DD.<ext>"`) or `print` (JSON rows, no attachment); `no-store`; columns `id`, `name`, `dateCreated` | 400 on `export` over the format's cap; on `key` (no row selection); on `font` for a PDF |
| `GET`    | `:id`    | 200 `{ id, name, dateCreated, usage }`                                                                                                                                                                  | 404 `ERP-CORE-0004`                                                                     |
| `POST`   | ``       | 201 the knowledge base                                                                                                                                                                                  | none                                                                                    |
| `PATCH`  | `:id`    | 200 the knowledge base                                                                                                                                                                                  | 404 `ERP-CORE-0004`                                                                     |
| `DELETE` | `:id`    | 204, no body                                                                                                                                                                                            | 404 `ERP-CORE-0004`; 409 `ERP-KNOWLEDGEBASE-0001`                                       |

## Events published

| Event                           | When                      | Payload                                |
| ------------------------------- | ------------------------- | -------------------------------------- |
| `knowledge-base.record.created` | after `POST` stores it    | `{ id, at }`, `KnowledgeBaseCreatedV1` |
| `knowledge-base.record.updated` | after `PATCH` saves it    | `{ id, at }`, `KnowledgeBaseUpdatedV1` |
| `knowledge-base.record.deleted` | after `DELETE` removes it | `{ id, at }`, `KnowledgeBaseDeletedV1` |

## Events subscribed

None. Listed in `events/subscribed.ts` (`KNOWLEDGE_BASE_SUBSCRIBED_EVENTS`).

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound HTTP, no vendor call.
- **Retry policy:** none on writes: an unkeyed `POST` retried could create two rows, and the events are in-process.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`, asserted by `check:db`); a list page costs the page, two counts, the probe, one statement per present candidate in one `Promise.all`; no extra DB or Redis client.

## Layers

| File                                          | Responsibility                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge-base.module.ts`                    | Wires every layer as a provider; exports `KnowledgeBaseFacade` only; not global                                                                                                                                                             |
| `knowledge-base.routes.ts`                    | `KNOWLEDGE_BASE_ROUTES` (`base`, `list`, `export`, `record`, `groups`, `groupRecord`, `groupsExport`), `KNOWLEDGE_BASE_EXPORT_COLUMNS`, `KNOWLEDGE_BASE_EXPORT_FILE_STEM`; no permission map                                                |
| `controller/knowledge-base.controller.ts`     | Handlers for knowledge-base and groups, each `@UseGuards(JwtAuthGuard, PermissionGuard)` with no permission code, `@CurrentUser()` and `@ApiZod`; the DELETE answers 204                                                                    |
| `service/knowledge-base.service.ts`           | `assertAdministrator` first in `list`, `get`, `create`, `update`, `remove`, `exportCsv`, `listGroups`, `getGroup`, `createGroup`, `updateGroup`, `removeGroup`, `exportGroups`                                                              |
| `service/knowledge-base.validator.ts`         | `parseListQuery` (one sort from `KNOWLEDGE_BASE_SORT_FIELDS`, default `-id`), `parseExportList`, `parseParams`, `parseCreateBody`, `parseUpdateBody`                                                                                        |
| `service/knowledge-base.transformer.ts`       | `toResponse`, `toExportRow`, `KNOWLEDGE_BASE_EXPORT_CELLS`, `toKnowledgeBase`; the list envelope with `exportLimit` and `printLimit`                                                                                                        |
| `service/knowledge-base.transport.ts`         | Domain events to the publisher port                                                                                                                                                                                                         |
| `repository/knowledge-base.repository.ts`     | The only Prisma caller: the keyset list, `count`, `findById`, `create`, `update`, `remove`, `presentReferences`, `usageByKnowledgeBase`, `listAll`, `findByIds`, `listGroups`, `findGroupById`, `createGroup`, `updateGroup`, `removeGroup` |
| `model/knowledge-base.model.ts`               | `KnowledgeBaseRow`, `NewKnowledgeBase`, `KnowledgeBaseUsage`, `KnowledgeBase`, `KnowledgeBaseId`, `KnowledgeBaseSortField`, `KnowledgeBaseListRequest`, `KnowledgeBasePage`, `KNOWLEDGE_BASE_FACADE_MAX_ROWS`                               |
| `dto/knowledge-base.dto.ts`                   | The list, export, params, group schemas, the strict body, the response and envelope schemas                                                                                                                                                 |
| `events/published.ts`, `events/subscribed.ts` | `KnowledgeBaseCreatedV1`, `KnowledgeBaseUpdatedV1`, `KnowledgeBaseDeletedV1` / none                                                                                                                                                         |
| `facade/knowledge-base.facade.ts`             | The only surface other modules may import; `describe()`, `findById`, `listAll`, `findByIds`                                                                                                                                                 |
| `index.ts`                                    | Public re-exports: `KnowledgeBaseFacade` and the `KnowledgeBase`, `KnowledgeBaseId` types                                                                                                                                                   |
| `__tests__/`                                  | One spec per layer; `knowledge-base.repository.spec.ts` and `knowledge-base.repository.int.spec.ts`; `route-gates.spec.ts`; `fakes.ts`; `create-knowledge-base-test-app.ts`                                                                 |

## How to run its tests

```bash
corepack yarn test src/v1/knowledge-base          # unit, the repository over a stub client, the gates and the in-process controller e2e spec
corepack yarn test:int src/v1/knowledge-base      # the repository against the local stack
```
