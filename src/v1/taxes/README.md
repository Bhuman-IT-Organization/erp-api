# taxes

## Purpose

The Setup list of taxes (W2A-02): list, read, create, update, delete and the four-format export of the taxes Perfex's items, expenses, subscriptions and modules pick from, replacing Perfex's `admin/taxes` screen. Started as a copy of erp-docs `05-templates/backend-module` (forms: singular `tax`, plural `taxes`) and reshaped to the table's columns; the screens live under `/setup/taxes` in erp-web, the api under `api/v1/taxes`.

## Owned tables

- `tbltaxes`: claimed for `node` in the ownership register by plan 04.1-10 (D-20), written here through Prisma's typed delegate, which the ownership guard admits because the register names `node`. Node writes `name` (`VARCHAR(100)`) and `taxrate` (`DECIMAL(15,2)`, written as two-decimal text); `id` is assigned by the database.

Perfex core Subscriptions also inserts rows (`Subscriptions_model.php`, a Stripe tax rate with no matching row): a recorded coexistence co-writer (D-20). Node lists those rows like any other, and such a row publishes no Node event until Subscriptions moves to Node.

Read only, never written (DB-03):

- `tbloptions.value` where `name = 'default_tax'` (perfex-core): Perfex's default taxes as `<name>|<rate>` text, read with Perfex's own substring match for each row's `isDefault` and for D-21; never logged and never answered on the wire. Node never writes `tbloptions` (D-10).
- `TAX_REFERENCES` (the repository's docblock), what refers to a tax, one tagged `$queryRaw` per table over all the ids at once, the table and column names literal SQL text and the ids bound with `Prisma.join`; 20 statements in one `Promise.all`, a group's count the sum of its tables' counts, and an error from any of them rejects the whole answer (fail closed):

| Group                 | Owner           | Table and column                                                                                                                                                         | Form                  |
| --------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `items`               | perfex-core     | `tblitems` (`tax`, `tax2`)                                                                                                                                               | an id column          |
| `expenses`            | perfex-core     | `tblexpenses` (`tax`, `tax2`)                                                                                                                                            | an id column          |
| `subscriptions`       | perfex-core     | `tblsubscriptions` (`tax_id`, `tax_id_2`)                                                                                                                                | an id column          |
| `vendorItems`         | purchase        | `tblitems_of_vendor` (`tax`, `tax2`)                                                                                                                                     | an id column          |
| `purchaseLines`       | purchase        | `tblpur_order_detail.tax`, `tblpur_request_detail.tax`, `tblpur_estimate_detail.tax`, `tblpur_invoice_details.tax`                                                       | a `\|`-joined id list |
| `warehouseLines`      | warehouse       | `tblgoods_receipt_detail.tax`, `tblgoods_delivery_detail.tax_id`, `tblwh_order_return_details.tax_id`, `tblwh_packing_list_details.tax_id`                               | a `\|`-joined id list |
| `fixedEquipmentLines` | fixed_equipment | `tblfe_cart.tax_id`, `tblfe_cart_detailt.tax` and `.tax_id`, `tblfe_goods_delivery_detail.tax_id`, `tblfe_goods_receipt_detail.tax`, `tblfe_packing_list_details.tax_id` | a `\|`-joined id list |
| `salesReturnLines`    | perfex-core     | `tblsales_return_items.tax_id`                                                                                                                                           | a `\|`-joined id list |
| `accounting`          | accounting      | `tblacc_tax_mappings.tax_id`, `tblacc_account_history.tax`                                                                                                               | an id column          |

An id-list column is matched with `FIND_IN_SET(t.id, REGEXP_REPLACE(r.<c>, '[|]', ','))`, so `12` is found in `3|12` and `2` is not found in `12`; a row naming the id twice counts once. `REGEXP_REPLACE` stands where `REPLACE` would read the same, because the ownership guard refuses a raw statement holding the write keyword `REPLACE`.

## Facade surface

- `describe(): { module: 'taxes'; version: 1 }`
- `findById(id: number): Promise<Tax | null>`
- `listAll(): Promise<readonly Tax[]>`: every tax, the rate ascending, then the id; refused loudly (`ERP-INTERNAL-0001`) above `TAXES_FACADE_MAX_ROWS` (1,000), never truncated
- `findByIds(ids: readonly number[]): Promise<readonly Tax[]>`: in the order given, each id once, absent ids skipped

`Tax` is `{ id: number; name: string; rate: string }` (the rate as stored, two decimals). No facade method writes or asserts the administrator flag: a module-to-module read has no actor. **Who uses it:** no module in this copy yet; a tax picker reads `listAll` for its options and `findByIds([row.tax, row.tax2])` for a row's taxes. Other modules import only `src/v1/taxes/index.ts` (the facade and the `Tax` / `TaxId` types) and `TaxesModule`.

## Endpoints

Under `api/v1/taxes` (`TAXES_ROUTES` in `taxes.routes.ts`). All six are administrators only (D-06): every handler carries `JwtAuthGuard, PermissionGuard` and declares no permission code, and the service asserts the administrator flag as the first statement of every use case, so a member holding every catalogue code is still refused. `@erp/contracts`' `ROUTE_GATES` declares the three screens `'admin'` and `__tests__/route-gates.spec.ts` compares every handler with it. Every failure is an RFC 9457 problem (`application/problem+json`) with an `ERP-*` code: 400 `ERP-VALIDATION-0001` (+ `issues`), 401 `ERP-AUTH-0004`, 403 `ERP-AUTH-0005` (not an administrator).

| Method   | Path     | Success                                                                                                                                                                                              | Errors beyond the three                                                                 |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET`    | ``       | 200 `{ data, meta: { nextCursor, prevCursor, total, rangeStart, exportLimit, printLimit } }`, each row `{ id, name, rate, usage, isDefault }`; `?limit&cursor&q&sort` (`rate` default, `name`, `id`) | none                                                                                    |
| `GET`    | `export` | 200 by `?format=`: `csv` (absent), `xlsx`, `pdf` (each `attachment; filename="taxes-YYYY-MM-DD.<ext>"`) or `print` (JSON rows, no attachment); `no-store` always; columns `id`, `name`, `rate`       | 400 on `export` over the format's cap; on `key` (no row selection); on `font` for a PDF |
| `GET`    | `:id`    | 200 `{ id, name, rate, usage, isDefault }`                                                                                                                                                           | 404 `ERP-CORE-0004`                                                                     |
| `POST`   | ``       | 201 the tax                                                                                                                                                                                          | 409 `ERP-TAXES-0003`                                                                    |
| `PATCH`  | `:id`    | 200 the tax                                                                                                                                                                                          | 404 `ERP-CORE-0004`; 409 `ERP-TAXES-0002`, `ERP-TAXES-0003`, `ERP-TAXES-0004`           |
| `DELETE` | `:id`    | 204, no body                                                                                                                                                                                         | 404 `ERP-CORE-0004`; 409 `ERP-TAXES-0001`                                               |

The bodies accept exactly the input Perfex accepts, made safe as D-19 does: `name` is required, trimmed, 1 to 100 characters (`TAXES_NAME_MAX`), `<` and `>` accepted and rendered as text, `|` refused on `['name']` (it is the separator of Perfex's `name|rate` strings; Perfex's screen strips it); `rate` is decimal text (a JSON number is a 400), rounded half away from zero to two places (`roundRate`, string arithmetic), and a rate with more than 13 integer digits after rounding is a 400 on `rate` (`DECIMAL(15,2)`). Both bodies are strict. `usage` holds nine counts (`items`, `expenses`, `subscriptions`, `vendorItems`, `purchaseLines`, `warehouseLines`, `fixedEquipmentLines`, `salesReturnLines`, `accounting`); `isDefault` says Perfex's `default_tax` names the tax. `q` matches the name (contains, under the column's `utf8mb4_unicode_ci` collation), the id when `q` is all digits, and the rate when `q` is a rate. The export runs on the shared core (`shared/http/export.ts`), administrators first for every format; the usage and `isDefault` are never exported, and CSV and Excel escape a leading formula character in every cell and header label.

The four refusals, in order, with their details (counts or causes only, never a row's text or the setting's):

- `ERP-TAXES-0001` (DELETE): any group of `TAX_REFERENCES` is non-zero (`used by 2 item(s), 1 expense(s) and 4 accounting row(s)`, the non-zero groups only), or the usage answer does not name the id (`its use could not be counted`). Nothing is deleted and no event is published.
- `ERP-TAXES-0002` (PATCH): an expense or a subscription uses the tax (`used by 1 expense(s)`), Perfex's locked edit; or its use could not be counted.
- `ERP-TAXES-0003` (POST, PATCH): another tax has the name under the column's collation (`another tax already has this name`), Perfex's `tax_name_exists`.
- `ERP-TAXES-0004` (PATCH, D-21): the name or the rate changes and Perfex's `default_tax` names the tax (`the tax is a default tax in Perfex's settings: remove it as a default there first`). An update whose name and rate equal the stored ones passes.

## Events published

| Event                  | When                      | Payload                        |
| ---------------------- | ------------------------- | ------------------------------ |
| `taxes.record.created` | after `POST` stores it    | `{ id, at }`, `TaxesCreatedV1` |
| `taxes.record.updated` | after `PATCH` saves it    | `{ id, at }`, `TaxesUpdatedV1` |
| `taxes.record.deleted` | after `DELETE` removes it | `{ id, at }`, `TaxesDeletedV1` |

Declared in `events/published.ts` (`TAXES_PUBLISHED_EVENTS`), published through `DOMAIN_EVENT_PUBLISHER` from `service/taxes.transport.ts`. A payload carries the id and the server time, never the name or the rate. After each publish the service writes one `LoggerService.log` line, `tax created|updated|deleted` with `{ id }`, which carries `requestId` and `staffId` from the request context (D-08, BE-10).

## Events subscribed

None. Listed in `events/subscribed.ts` (`TAXES_SUBSCRIBED_EVENTS`).

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound HTTP, no vendor call.
- **Retry policy:** none on writes: an unkeyed `POST` retried could create two rows, and the events are in-process.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`, asserted by `check:db`); a list page costs the page, two counts, the 20 usage statements in one `Promise.all` and the `default_tax` read; no extra DB or Redis client.

## Layers

| File                                          | Responsibility                                                                                                                                                                                                         |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taxes.module.ts`                             | Wires every layer as a provider; exports `TaxesFacade` only; not global                                                                                                                                                |
| `taxes.routes.ts`                             | `TAXES_ROUTES` (`base`, `list`, `export`, `record`), `TAXES_EXPORT_COLUMNS`, `TAXES_EXPORT_FILE_STEM`; no permission map                                                                                               |
| `controller/taxes.controller.ts`              | The six handlers, each `@UseGuards(JwtAuthGuard, PermissionGuard)` with no permission code, `@CurrentUser()` and `@ApiZod`; the DELETE answers 204                                                                     |
| `service/taxes.service.ts`                    | `assertAdministrator` first in `list`, `get`, `create`, `update`, `remove` and `exportCsv`; the four refusals; the event after a write, then the `log` line; the facade reads; the injectable clock `now`              |
| `service/taxes.validator.ts`                  | `parseListQuery` (one sort from `TAXES_SORT_FIELDS`, rate first), `parseExportList`, `parseParams`, `parseCreateBody`, `parseUpdateBody`                                                                               |
| `service/taxes.transformer.ts`                | `RATE_PATTERN`, `roundRate`, `isNamedInDefaultTaxes`, `toResponse`, `toTax`; the list envelope with `exportLimit` and `printLimit`                                                                                     |
| `service/taxes.transport.ts`                  | Outbound seam: domain events to the publisher port                                                                                                                                                                     |
| `repository/taxes.repository.ts`              | The only Prisma caller: the keyset list (the rate on `taxrate`, a numeric cursor key), `count`, `findById`, `findOtherByName`, `create`, `update`, `remove`, `usageByTax`, `defaultTaxSetting`, `listAll`, `findByIds` |
| `model/taxes.model.ts`                        | `TaxRow`, `NewTax`, `TaxUsage`, `Tax`, `TaxId`, `TaxesSortField`, `TaxesListRequest`, `TaxesPage`, `TAXES_FACADE_MAX_ROWS`                                                                                             |
| `dto/taxes.dto.ts`                            | The list, export and params schemas, the strict bodies, the response and envelope schemas (`TAXES_NAME_MAX`, `TAXES_RATE_INTEGER_DIGITS`, `RATE_PATTERN`)                                                              |
| `events/published.ts`, `events/subscribed.ts` | `TaxesCreatedV1`, `TaxesUpdatedV1`, `TaxesDeletedV1` / none                                                                                                                                                            |
| `facade/taxes.facade.ts`                      | The only surface other modules may import; `describe()`, `findById`, `listAll`, `findByIds`                                                                                                                            |
| `index.ts`                                    | Public re-exports: `TaxesFacade` and the `Tax`, `TaxId` types                                                                                                                                                          |
| `__tests__/`                                  | One spec per layer; `taxes.repository.spec.ts` (the 20 statements over a stub client) and `taxes.repository.int.spec.ts` (the local database); `route-gates.spec.ts`; `fakes.ts`; `create-taxes-test-app.ts`           |

## Legacy parity

Perfex's `admin/taxes` screen (`controllers/admin/Taxes.php`, `models/Taxes_model.php`, `views/admin/taxes/manage.php`), rebuilt from its view:

| Perfex                                                              | Node                                                                                            | Notes                                                                                |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `Taxes::manage` (the table, sorted `[2, 'asc']`)                    | `GET /api/v1/taxes`, the rate ascending by default                                              | the list, with each row's usage and default flag                                     |
| the add and edit modal                                              | `POST` and `PATCH /api/v1/taxes/:id` behind the `/setup/taxes/new` and `/setup/taxes/:id` pages | pages, not a modal (D-04); the same fields                                           |
| `tax_name_exists` (the modal's remote check)                        | 409 `ERP-TAXES-0003` on save                                                                    | the same `where name = ?` under the column's collation                               |
| the locked modal (`tables/taxes.php` lock flags)                    | 409 `ERP-TAXES-0002`; the form opens read-only (plan 04.1-12)                                   | while `tblexpenses.tax`/`tax2` or `tblsubscriptions.tax_id`/`tax_id_2` hold the id   |
| the `\|` stripped from the name by the screen                       | stripped by the form (plan 04.1-12) and refused by the api on `['name']`                        | a `\|` would corrupt Perfex's `name\|rate` strings                                   |
| `Taxes_model::edit` rewrites `default_tax` when a default changes   | 409 `ERP-TAXES-0004` while `default_tax` names the tax                                          | D-21: Node never writes `tbloptions`; lifted once Settings move to Node              |
| `Taxes::delete` refused while items, expenses or subscriptions hold | 409 `ERP-TAXES-0001` while any of the 20 columns of `TAX_REFERENCES` holds the id               | widened to purchase, warehouse, fixed equipment, sales returns and accounting (D-07) |
| DataTable search (a substring of the id, name and rate text)        | `q`: the name contains it; the id and the rate match exactly                                    | an exact id and rate, not a substring of their text                                  |
| an activity-log entry per change                                    | no `tblactivity_log` row (D-18)                                                                 | the domain event and the service `log` line are Node's record                        |
| Subscriptions inserts a row for a Stripe tax rate                   | kept on Perfex (D-20)                                                                           | Node lists the row; it publishes no Node event                                       |

## How to run its tests

```bash
corepack yarn test src/v1/taxes          # unit, the repository over a stub client, the gates and the in-process controller e2e spec (no network, no database)
corepack yarn test:int src/v1/taxes      # the repository against the local stack (node ../erp-infra/scripts/local-up.mjs first)
```

The int spec writes only `tbltaxes` rows whose name starts with `int-spec-04.1-11-tax` and deletes them before and after the run; it never writes a Perfex-owned table and never reads a local value into an assertion.
