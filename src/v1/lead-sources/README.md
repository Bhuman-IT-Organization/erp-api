# lead-sources

## Purpose

The Lead Sources list (W2A-04): list, read, create, update, delete and the four-format export of lead sources replacing Perfex's `admin/leads` lead sources screen (`controllers/admin/Leads.php`, `models/Leads_model.php`, and `views/admin/leads/manage_sources.php`). Started as a copy of erp-docs `05-templates/backend-module` (forms: singular `lead-source`, plural `lead-sources`) and reshaped to the table's columns; the screens live under `/setup/lead-sources` in erp-web (Lead Sources stays a setup item), the API under `api/v1/lead-sources`.

## Owned tables

- `tbllead_sources`: claimed for `node` in the ownership register by plan 04.1-18 (W2A-04), written here through Prisma's typed delegate, which the ownership guard admits because the register names `node`. Node writes `name` (`VARCHAR(255)`) and `orderby` (`INT(11)`); on create only, `dateadded` (Perfex's wall clock, below); `id` is assigned by the database. An update writes the name and order, so `dateadded` never changes after the create (D-31). Perfex's own screen was its one writer (D-27): no co-writer.

`dateadded` (D-31): Perfex's `add` writes PHP's `date('Y-m-d H:i:s')`, and PHP's zone is the `default_timezone` setting when it is set (`application/core/App_Controller.php:59-62`). So the column holds a naive wall clock in the company zone, and Node writes the same: `wallClockAt(now, companyZone(default_timezone))`, stored verbatim. When the setting is empty or not an IANA zone name, the zone is `UTC` (PHP keeps the server's zone, UTC on the client's stack). The wire answers `dateCreated` as the ISO instant that wall clock names in the same zone, or `null` when the column is NULL.

Read only, never written (DB-03):

- `tbloptions.default_timezone` (perfex-core), through `SettingsFacade` (`settings/index.js`) from the transport; never logged and never answered.
- `LEAD_SOURCE_REFERENCES` (the repository's docblock), what refers to a lead source, for each row's usage and the delete refusal. A declared candidate list (D-28); before every usage read ONE `information_schema.COLUMNS` probe (every table and column name bound) answers which candidates the connected schema has, and only those run. A missing candidate counts 0 and raises no error, and the probe is never cached, so when another slice adds its column with Node's own DDL, this module counts it with no code change. This module never adds a column to any table (never patch Perfex). Each present candidate is one tagged `$queryRaw` over all the ids at once (table and column names literal, ids bound with `Prisma.join`), in one `Promise.all`; an error from the probe or any statement rejects the whole answer (fail closed):

| Group       | Owner   | Table and column         | Match  |
| :---------- | :------ | :----------------------- | :----- |
| `leads`     | leads   | `tblleads.source`        | the id |
| `customers` | clients | `tblclients.lead_source` | the id |

## Facade surface

- `describe(): { module: 'lead-sources'; version: 1 }`
- `findById(id: number): Promise<LeadSource null |>`
- `listAll(): Promise<readonly LeadSource[]>`: every lead source, ordered by `orderby` ascending then name ascending (the order Perfex's pickers read); refused loudly (`ERP-INTERNAL-0001`) above `LEAD_SOURCES_FACADE_MAX_ROWS` (1,000), never truncated
- `findByIds(ids: readonly number[]): Promise<readonly LeadSource[]>`: in the order given, each id once, absent ids skipped

`LeadSource` is `{ id: number; name: string }`, never the wire DTO and never `orderby`. No facade method writes or asserts the administrator flag: a module-to-module read has no actor. **Who uses it:** the leads and clients migrations, `listAll` for a lead source picker and `findByIds` for the names a document's ids point at. Other modules import only `src/v1/lead-sources/index.ts` (the facade and the `LeadSource` / `LeadSourceId` types) and `LeadSourcesModule`.

## Endpoints

Under `api/v1/lead-sources` (`LEAD_SOURCES_ROUTES` in `lead-sources.routes.ts`). All six are administrators only (D-06, D-26): every handler carries `JwtAuthGuard, PermissionGuard` and declares no permission code, and the service asserts the administrator flag as the first statement of every use case, so a member holding every catalogue code is still refused. Perfex's own controller had no check at all (any signed-in staff member could list, add, edit and delete by URL; only the menu item was administrator-only), so this closes D-26's finding. `@erp/contracts`' `ROUTE_GATES` declares the three screens `'admin'` and `__tests__/route-gates.spec.ts` compares every handler with it. Every failure is an RFC 9457 problem (`application/problem+json`) with an `ERP-*` code: 400 `ERP-VALIDATION-0001` (+ `issues`), 401 `ERP-AUTH-0004`, 403 `ERP-AUTH-0005` (not an administrator).

| Method   | Path     | Success                                                                                                                                                                                               | Errors beyond the three                                                                 |
| :------- | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------- |
| `GET`    | ``       | 200 `{ data, meta: { nextCursor, prevCursor, total, rangeStart, exportLimit, printLimit } }`, each row `{ id, name, dateCreated, usage }`; `?limit&cursor&q&sort` (`-id` default, `id`, `name`)       | none                                                                                    |
| `GET`    | `export` | 200 by `?format=`: `csv` (absent), `xlsx`, `pdf` (each `attachment; filename="lead-sources-YYYY-MM-DD.<ext>"`) or `print` (JSON rows, no attachment); `no-store`; columns `id`, `name`, `dateCreated` | 400 on `export` over the format's cap; on `key` (no row selection); on `font` for a PDF |
| `GET`    | `:id`    | 200 `{ id, name, dateCreated, usage }`                                                                                                                                                                | 404 `ERP-CORE-0004`                                                                     |
| `POST`   | ``       | 201 the lead source                                                                                                                                                                                   | none                                                                                    |
| `PATCH`  | `:id`    | 200 the lead source                                                                                                                                                                                   | 404 `ERP-CORE-0004`                                                                     |
| `DELETE` | `:id`    | 204, no body                                                                                                                                                                                          | 404 `ERP-CORE-0004`; 409 `ERP-LEADSOURCES-0001`                                         |

The body is `{ name }`, strict: the name is required, trimmed, 1 to 255 characters (`LEAD_SOURCES_NAME_MAX`), every character accepted and stored as text (`<` and `>` included, rendered as text), and a name another lead source holds is accepted (Perfex has no uniqueness check); any other key (`orderby`, `dateadded`, `id`, ...) is a 400 naming it, and `{}` on `PATCH` is a 400 on `['name']`. `usage` holds two counts (`leads`, `customers`). `q` matches the name (contains, under the column's collation) and, when `q` is all digits up to 4294967295, the id. `dateCreated` is not a sort: the column is nullable and the shared keyset admits only NOT NULL columns; ids rise with creation, so the default id descending is Perfex's creation order. The export runs on the shared core (`shared/http/export.ts`), administrators first for every format; the usage is never exported, `dateCreated` is the ISO instant in a file and the reader's date and time format and zone in PDF and Print (`kind: 'dateTime'`, as Perfex's list prints), and CSV and Excel escape a leading formula character in every cell and header label.

`ERP-LEADSOURCES-0001` (DELETE): any group of `LEAD_SOURCE_REFERENCES` is non-zero (`used by 14 lead(s) and 3 customer(s)`, the non-zero groups only, in the order `lead(s)`, `customer(s)`), or the usage answer does not name the id (`its use could not be counted`). Nothing is deleted and no event is published. The detail names counts only, never a name.

## Events published

| Event                         | When                      | Payload                              |
| :---------------------------- | :------------------------ | :----------------------------------- |
| `lead-sources.record.created` | after `POST` stores it    | `{ id, at }`, `LeadSourcesCreatedV1` |
| `lead-sources.record.updated` | after `PATCH` saves it    | `{ id, at }`, `LeadSourcesUpdatedV1` |
| `lead-sources.record.deleted` | after `DELETE` removes it | `{ id, at }`, `LeadSourcesDeletedV1` |

Declared in `events/published.ts` (`LEAD_SOURCES_PUBLISHED_EVENTS`), published through `DOMAIN_EVENT_PUBLISHER` from `service/lead-sources.transport.ts`. A payload carries the id and the server time, never the name. After each publish the service writes one `LoggerService.log` line, `lead source created|updated|deleted` with `{ id }`, which carries `requestId` and `staffId` from the request context (D-08, BE-10).

## Events subscribed

None. Listed in `events/subscribed.ts` (`LEAD_SOURCES_SUBSCRIBED_EVENTS`).

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound HTTP, no vendor call; the settings facade is an in-process call.
- **Retry policy:** none on writes: an unkeyed `POST` retried could create two rows, and the events are in-process.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`, asserted by `check:db`); a list page costs the page, two counts, the probe, one statement per present candidate (two at most) in one `Promise.all` and the `default_timezone` read; no extra DB or Redis client.

## Layers

| File                                          | Responsibility                                                                                                                                                                                                       |
| :-------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lead-sources.module.ts`                      | Wires every layer as a provider; imports `SettingsModule`; exports `LeadSourcesFacade` only; not global                                                                                                              |
| `lead-sources.routes.ts`                      | `LEAD_SOURCES_ROUTES` (`base`, `list`, `export`, `record`), `LEAD_SOURCES_EXPORT_COLUMNS`, `LEAD_SOURCES_EXPORT_FILE_STEM`; no permission map                                                                        |
| `controller/lead-sources.controller.ts`       | The six handlers, each `@UseGuards(JwtAuthGuard, PermissionGuard)` with no permission code, `@CurrentUser()` and `@ApiZod`; the DELETE answers 204                                                                   |
| `service/lead-sources.service.ts`             | `assertAdministrator` first in `list`, `get`, `create`, `update`, `remove` and `exportCsv`; D-31's two columns; the 409; the event after a write, then the `log` line; the facade reads                              |
| `service/lead-sources.validator.ts`           | `parseListQuery` (one sort from `LEAD_SOURCES_SORT_FIELDS`, default `-id`), `parseExportList`, `parseParams`, `parseCreateBody`, `parseUpdateBody`                                                                   |
| `service/lead-sources.transformer.ts`         | `companyZone`, `wallClockAt`, `instantOf` (D-31), `toResponse`, `toExportRow`, `LEAD_SOURCES_EXPORT_CELLS`, `toLeadSource`; the list envelope with `exportLimit` and `printLimit`                                    |
| `service/lead-sources.transport.ts`           | Domain events to the publisher port; `companyTimeZone()` through `SettingsFacade` (the one file that reaches another module)                                                                                         |
| `repository/lead-sources.repository.ts`       | The only Prisma caller: the keyset list, `count`, `findById`, `create`, `update` (the name and order only), `remove`, `presentReferences`, `usageByLeadSource`, `listAll`, `findByIds`                               |
| `model/lead-sources.model.ts`                 | `LeadSourceRow`, `NewLeadSource`, `LeadSourceUsage`, `LeadSource`, `LeadSourceId`, `LeadSourcesSortField`, `LeadSourcesListRequest`, `LeadSourcesPage`, `LEAD_SOURCES_FACADE_MAX_ROWS`                               |
| `dto/lead-sources.dto.ts`                     | The list, export and params schemas, the strict body, the response and envelope schemas (`LEAD_SOURCES_NAME_MAX`, `LEAD_SOURCES_SEARCH_MAX`)                                                                         |
| `events/published.ts`, `events/subscribed.ts` | `LeadSourcesCreatedV1`, `LeadSourcesUpdatedV1`, `LeadSourcesDeletedV1` / none                                                                                                                                        |
| `facade/lead-sources.facade.ts`               | The only surface other modules may import; `describe()`, `findById`, `listAll`, `findByIds`                                                                                                                          |
| `index.ts`                                    | Public re-exports: `LeadSourcesFacade` and the `LeadSource`, `LeadSourceId` types                                                                                                                                    |
| `__tests__/`                                  | One spec per layer; `lead-sources.repository.spec.ts` (D-28 over a stub client) and `lead-sources.repository.int.spec.ts` (the local database); `route-gates.spec.ts`; `fakes.ts`; `create-lead-sources-test-app.ts` |

## Legacy parity

Perfex's `admin/leads` lead sources screen, rebuilt from its views. Business outcomes are kept 1:1 (D-29); each workflow simplification is listed:

| Perfex                                                  | Node                                                                             | Notes                                                                                                       |
| :------------------------------------------------------ | :------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| `Leads::sources` pages                                  | `GET`, `POST`, `PATCH` behind the `/setup/lead-sources`, `/new` and `/:id` pages | Perfex already used pages for the list, create and edit, so D-04 changes nothing                            |
| the table ordered by `orderby` / name                   | the list, the id descending by default                                           | clean default sorting                                                                                       |
| the table's search over every cell's text               | `q`: the name contains it; an all-digit `q` also matches the id exactly          | search is indexed & performant                                                                              |
| the Date Added column, sortable                         | shown, not sortable                                                              | the column is nullable and the keyset admits only NOT NULL columns; the id order is the creation order      |
| `Leads_model::add_source` saves every posted field      | only `name` (D-26); any other key is a 400                                       | `dateadded` is written as Perfex writes them (D-31; the wall clock of `default_timezone`, `UTC` when empty) |
| `Leads_model::update_source` saves every posted field   | the name and order only; `dateadded` never changes                               | D-31                                                                                                        |
| no uniqueness check                                     | none either: a duplicate name is accepted                                        | D-29                                                                                                        |
| the success alert after a save or delete                | a toast                                                                          | the screens (plan 04.1-19)                                                                                  |
| the delete link with a browser confirm, no in-use check | a dialog, then `DELETE`; refused with 409 while in use (D-07, a lead decision)   | Perfex deleted it and left its lead and client rows pointing to nothing                                     |
| no administrator check on the controller (D-26)         | administrators only on every endpoint                                            | Perfex's menu item was already administrator-only                                                           |
| no activity-log line for a lead source change           | none either (D-18)                                                               | the domain event and the service `log` line are Node's record                                               |

## How to run its tests

```bash
corepack yarn test src/v1/lead-sources         # unit, the repository over a stub client (D-28), the gates and the in-process controller e2e spec (no network, no database)
corepack yarn test:int src/v1/lead-sources     # the repository against the local stack (node ../erp-infra/scripts/local-up.mjs first)
```
