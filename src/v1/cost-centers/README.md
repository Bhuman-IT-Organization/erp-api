# cost-centers

## Purpose

The Cost Centers list (W2A-03): list, read, create, update, delete and the four-format export of the cost centers Perfex's purchase requests, orders and quotations, shipping charges, expenses and fixed assets name, replacing Perfex's `admin/cost_centers` screen (`controllers/admin/Cost_centers.php`, `models/Cost_centers_model.php`, `views/admin/cost_centers/manage.php` and `form.php`). Started as a copy of erp-docs `05-templates/backend-module` (forms: singular `cost-center`, plural `cost-centers`) and reshaped to the table's columns; the screens live under `/setup/cost-centers` in erp-web (Cost Centers stays a main-menu item, D-25), the api under `api/v1/cost-centers`.

## Owned tables

- `tblcost_centers`: claimed for `node` in the ownership register by plan 04.1-17 (W2A-03), written here through Prisma's typed delegate, which the ownership guard admits because the register names `node`. Node writes `name` (`VARCHAR(255)`); on create only, `created_by` (the signed-in staff id) and `datecreated` (Perfex's wall clock, below); `id` is assigned by the database. An update writes the name and nothing else, so `created_by` and `datecreated` never change after the create (D-31). Perfex's own screen was its one writer (D-27): no co-writer.

`datecreated` (D-31): Perfex's `add` writes PHP's `date('Y-m-d H:i:s')`, and PHP's zone is the `default_timezone` setting when it is set (`application/core/App_Controller.php:59-62`). So the column holds a naive wall clock in the company zone, and Node writes the same: `wallClockAt(now, companyZone(default_timezone))`, stored verbatim. When the setting is empty or not an IANA zone name, the zone is `UTC` (PHP keeps the server's zone, UTC on the client's stack). The wire answers `dateCreated` as the ISO instant that wall clock names in the same zone, or `null` when the column is NULL.

Read only, never written (DB-03):

- `tbloptions.default_timezone` (perfex-core), through `SettingsFacade` (`settings/index.js`) from the transport; never logged and never answered.
- `COST_CENTER_REFERENCES` (the repository's docblock), what refers to a cost center, for each row's usage and the delete refusal. A declared candidate list (D-28); before every usage read ONE `information_schema.COLUMNS` probe (every table and column name bound) answers which candidates the connected schema has, and only those run. A missing candidate counts 0 and raises no error, and the probe is never cached, so when the Expenses or shipping-charge slice adds its column with Node's own DDL, this module counts it with no code change. This module never adds a column to any table (never patch Perfex). Each present candidate is one tagged `$queryRaw` over all the ids at once (table and column names literal, ids bound with `Prisma.join`), in one `Promise.all`; an error from the probe or any statement rejects the whole answer (fail closed):

| Group                | Owner           | Table and column                      | Match                                                                  |
| -------------------- | --------------- | ------------------------------------- | ---------------------------------------------------------------------- |
| `purchaseRequests`   | purchase        | `tblpur_request.cost_center`          | the id                                                                 |
| `purchaseOrders`     | purchase        | `tblpur_orders.cost_center`           | the id                                                                 |
| `purchaseQuotations` | purchase        | `tblpur_estimates.cost_center`        | the id                                                                 |
| `shippingCharges`    | (unregistered)  | `tblinv_shipping_charges.cost_center` | the id; absent locally, counted once the shipping-charge slice adds it |
| `expenses`           | perfex-core     | `tblexpenses.cost_center`             | the id; absent locally, counted once the Expenses slice adds it        |
| `assets`             | fixed_equipment | `tblfe_asset_creation.cost_centre`    | the NAME as text, exactly: `CAST(... AS BINARY)`, case-sensitive       |

fixed_equipment stores the cost center's name, not its id (its asset form's options carry the name), so an asset counts only when its text equals the name byte for byte (lead 2026-10-03), never under the columns' case-insensitive collation.

## Facade surface

- `describe(): { module: 'cost-centers'; version: 1 }`
- `findById(id: number): Promise<CostCenter | null>`
- `listAll(): Promise<readonly CostCenter[]>`: every cost center, the name ascending, then the id (the order Perfex's pickers read); refused loudly (`ERP-INTERNAL-0001`) above `COST_CENTERS_FACADE_MAX_ROWS` (1,000), never truncated
- `findByIds(ids: readonly number[]): Promise<readonly CostCenter[]>`: in the order given, each id once, absent ids skipped

`CostCenter` is `{ id: number; name: string }`, never the wire DTO and never `created_by`. No facade method writes or asserts the administrator flag: a module-to-module read has no actor. **Who uses it:** the purchase, expenses and fixed_equipment migrations, `listAll` for a cost center picker and `findByIds` for the names a document's ids point at. Other modules import only `src/v1/cost-centers/index.ts` (the facade and the `CostCenter` / `CostCenterId` types) and `CostCentersModule`.

## Endpoints

Under `api/v1/cost-centers` (`COST_CENTERS_ROUTES` in `cost-centers.routes.ts`). All six are administrators only (D-06, D-26): every handler carries `JwtAuthGuard, PermissionGuard` and declares no permission code, and the service asserts the administrator flag as the first statement of every use case, so a member holding every catalogue code is still refused. Perfex's own controller had no check at all (any signed-in staff member could list, add, edit and delete by URL; only the menu item was administrator-only), so this closes D-26's finding. `@erp/contracts`' `ROUTE_GATES` declares the three screens `'admin'` and `__tests__/route-gates.spec.ts` compares every handler with it. Every failure is an RFC 9457 problem (`application/problem+json`) with an `ERP-*` code: 400 `ERP-VALIDATION-0001` (+ `issues`), 401 `ERP-AUTH-0004`, 403 `ERP-AUTH-0005` (not an administrator).

| Method   | Path     | Success                                                                                                                                                                                               | Errors beyond the three                                                                 |
| -------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET`    | ``       | 200 `{ data, meta: { nextCursor, prevCursor, total, rangeStart, exportLimit, printLimit } }`, each row `{ id, name, dateCreated, usage }`; `?limit&cursor&q&sort` (`-id` default, `id`, `name`)       | none                                                                                    |
| `GET`    | `export` | 200 by `?format=`: `csv` (absent), `xlsx`, `pdf` (each `attachment; filename="cost-centers-YYYY-MM-DD.<ext>"`) or `print` (JSON rows, no attachment); `no-store`; columns `id`, `name`, `dateCreated` | 400 on `export` over the format's cap; on `key` (no row selection); on `font` for a PDF |
| `GET`    | `:id`    | 200 `{ id, name, dateCreated, usage }`                                                                                                                                                                | 404 `ERP-CORE-0004`                                                                     |
| `POST`   | ``       | 201 the cost center                                                                                                                                                                                   | none                                                                                    |
| `PATCH`  | `:id`    | 200 the cost center                                                                                                                                                                                   | 404 `ERP-CORE-0004`                                                                     |
| `DELETE` | `:id`    | 204, no body                                                                                                                                                                                          | 404 `ERP-CORE-0004`; 409 `ERP-COSTCENTERS-0001`                                         |

The body is `{ name }`, strict: the name is required, trimmed, 1 to 255 characters (`COST_CENTERS_NAME_MAX`), every character accepted and stored as text (`<` and `>` included, rendered as text), and a name another cost center holds is accepted (Perfex has no uniqueness check); any other key (`created_by`, `datecreated`, `id`, ...) is a 400 naming it, and `{}` on `PATCH` is a 400 on `['name']`. `usage` holds six counts (`purchaseRequests`, `purchaseOrders`, `purchaseQuotations`, `shippingCharges`, `expenses`, `assets`). `q` matches the name (contains, under the column's collation) and, when `q` is all digits up to 4294967295, the id. `dateCreated` is not a sort: the column is nullable and the shared keyset admits only NOT NULL columns; ids rise with creation, so the default id descending is Perfex's creation order. The export runs on the shared core (`shared/http/export.ts`), administrators first for every format; the usage is never exported, `dateCreated` is the ISO instant in a file and the reader's date and time format and zone in PDF and Print (`kind: 'dateTime'`, as Perfex's list prints `_d()`, which hands a value with a time to `_dt()`: `H:i:s` or `g:i A`), and CSV and Excel escape a leading formula character in every cell and header label.

`ERP-COSTCENTERS-0001` (DELETE): any group of `COST_CENTER_REFERENCES` is non-zero (`used by 2 purchase request(s), 1 expense(s) and 4 asset(s)`, the non-zero groups only, in the order `purchase request(s)`, `purchase order(s)`, `purchase quotation(s)`, `shipping charge(s)`, `expense(s)`, `asset(s)`), or the usage answer does not name the id (`its use could not be counted`). Nothing is deleted and no event is published. The detail names counts only, never a name.

## Events published

| Event                         | When                      | Payload                              |
| ----------------------------- | ------------------------- | ------------------------------------ |
| `cost-centers.record.created` | after `POST` stores it    | `{ id, at }`, `CostCentersCreatedV1` |
| `cost-centers.record.updated` | after `PATCH` saves it    | `{ id, at }`, `CostCentersUpdatedV1` |
| `cost-centers.record.deleted` | after `DELETE` removes it | `{ id, at }`, `CostCentersDeletedV1` |

Declared in `events/published.ts` (`COST_CENTERS_PUBLISHED_EVENTS`), published through `DOMAIN_EVENT_PUBLISHER` from `service/cost-centers.transport.ts`. A payload carries the id and the server time, never the name. After each publish the service writes one `LoggerService.log` line, `cost center created|updated|deleted` with `{ id }`, which carries `requestId` and `staffId` from the request context (D-08, BE-10).

## Events subscribed

None. Listed in `events/subscribed.ts` (`COST_CENTERS_SUBSCRIBED_EVENTS`).

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound HTTP, no vendor call; the settings facade is an in-process call.
- **Retry policy:** none on writes: an unkeyed `POST` retried could create two rows, and the events are in-process.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`, asserted by `check:db`); a list page costs the page, two counts, the probe, one statement per present candidate (six at most) in one `Promise.all` and the `default_timezone` read; no extra DB or Redis client.

## Layers

| File                                          | Responsibility                                                                                                                                                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cost-centers.module.ts`                      | Wires every layer as a provider; imports `SettingsModule`; exports `CostCentersFacade` only; not global                                                                                                              |
| `cost-centers.routes.ts`                      | `COST_CENTERS_ROUTES` (`base`, `list`, `export`, `record`), `COST_CENTERS_EXPORT_COLUMNS`, `COST_CENTERS_EXPORT_FILE_STEM`; no permission map                                                                        |
| `controller/cost-centers.controller.ts`       | The six handlers, each `@UseGuards(JwtAuthGuard, PermissionGuard)` with no permission code, `@CurrentUser()` and `@ApiZod`; the DELETE answers 204                                                                   |
| `service/cost-centers.service.ts`             | `assertAdministrator` first in `list`, `get`, `create`, `update`, `remove` and `exportCsv`; D-31's two columns; the 409; the event after a write, then the `log` line; the facade reads                              |
| `service/cost-centers.validator.ts`           | `parseListQuery` (one sort from `COST_CENTERS_SORT_FIELDS`, default `-id`), `parseExportList`, `parseParams`, `parseCreateBody`, `parseUpdateBody`                                                                   |
| `service/cost-centers.transformer.ts`         | `companyZone`, `wallClockAt`, `instantOf` (D-31), `toResponse`, `toExportRow`, `COST_CENTERS_EXPORT_CELLS`, `toCostCenter`; the list envelope with `exportLimit` and `printLimit`                                    |
| `service/cost-centers.transport.ts`           | Domain events to the publisher port; `companyTimeZone()` through `SettingsFacade` (the one file that reaches another module)                                                                                         |
| `repository/cost-centers.repository.ts`       | The only Prisma caller: the keyset list, `count`, `findById`, `create`, `update` (the name only), `remove`, `presentReferences`, `usageByCostCenter`, `listAll`, `findByIds`                                         |
| `model/cost-centers.model.ts`                 | `CostCenterRow`, `NewCostCenter`, `CostCenterUsage`, `CostCenter`, `CostCenterId`, `CostCentersSortField`, `CostCentersListRequest`, `CostCentersPage`, `COST_CENTERS_FACADE_MAX_ROWS`                               |
| `dto/cost-centers.dto.ts`                     | The list, export and params schemas, the strict body, the response and envelope schemas (`COST_CENTERS_NAME_MAX`, `COST_CENTERS_SEARCH_MAX`)                                                                         |
| `events/published.ts`, `events/subscribed.ts` | `CostCentersCreatedV1`, `CostCentersUpdatedV1`, `CostCentersDeletedV1` / none                                                                                                                                        |
| `facade/cost-centers.facade.ts`               | The only surface other modules may import; `describe()`, `findById`, `listAll`, `findByIds`                                                                                                                          |
| `index.ts`                                    | Public re-exports: `CostCentersFacade` and the `CostCenter`, `CostCenterId` types                                                                                                                                    |
| `__tests__/`                                  | One spec per layer; `cost-centers.repository.spec.ts` (D-28 over a stub client) and `cost-centers.repository.int.spec.ts` (the local database); `route-gates.spec.ts`; `fakes.ts`; `create-cost-centers-test-app.ts` |

## Legacy parity

Perfex's `admin/cost_centers` screen, rebuilt from its views. Business outcomes are kept 1:1 (D-29); each workflow simplification is listed:

| Perfex                                                              | Node                                                                             | Notes                                                                                                                           |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Cost_centers::index`, `create`, `edit` pages                       | `GET`, `POST`, `PATCH` behind the `/setup/cost-centers`, `/new` and `/:id` pages | Perfex already used pages for the list, create and edit, so D-04 changes nothing                                                |
| the inline table, ordered `[0, 'desc']` (`assets/js/app.js:693`)    | the list, the id descending by default                                           | the same order                                                                                                                  |
| the inline table's search over every cell's text, the date included | `q`: the name contains it; an all-digit `q` also matches the id exactly          | the date text is not searched                                                                                                   |
| the Date Created column, sortable                                   | shown, not sortable                                                              | the column is nullable and the keyset admits only NOT NULL columns; the id order is the creation order                          |
| `Cost_centers_model::add` saves every posted field                  | only `name` (D-26); any other key is a 400                                       | `created_by` and `datecreated` are written as Perfex writes them (D-31; the wall clock of `default_timezone`, `UTC` when empty) |
| `Cost_centers_model::update` saves every posted field               | the name only; `created_by` and `datecreated` never change                       | D-31                                                                                                                            |
| no uniqueness check                                                 | none either: a duplicate name is accepted                                        | D-29                                                                                                                            |
| a rename leaves a fixed asset's stored text naming the old name     | the same                                                                         | D-29: fixed_equipment stores the name as text, and Node does not rewrite another module's rows                                  |
| the success alert after a save or delete                            | a toast                                                                          | the screens (plan 04.1-19)                                                                                                      |
| the delete link (a GET) with a browser confirm, no in-use check     | a dialog, then `DELETE`; refused with 409 while in use (D-07, a lead decision)   | Perfex deleted it and left its purchase, expense, shipping and asset rows naming nothing                                        |
| no administrator check on the controller (D-26)                     | administrators only on every endpoint                                            | Perfex's menu item was already administrator-only (`menu_helper.php:155-163`)                                                   |
| no activity-log line for a cost center change                       | none either (D-18)                                                               | the domain event and the service `log` line are Node's record                                                                   |

## How to run its tests

```bash
corepack yarn test src/v1/cost-centers          # unit, the repository over a stub client (D-28), the gates and the in-process controller e2e spec (no network, no database)
corepack yarn test:int src/v1/cost-centers      # the repository against the local stack (node ../erp-infra/scripts/local-up.mjs first)
```

The int spec writes only `tblcost_centers` rows whose name starts with `int-spec-04.1-18-cc` and deletes them before and after the run; it never writes a Perfex-owned table and never reads a local value into an assertion message.
