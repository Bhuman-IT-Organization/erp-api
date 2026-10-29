# contract-types

## Purpose

The Contract Types list: list, read, create, update, delete and the four-format export of the contract types Perfex's contracts name, replacing Perfex's `admin/contracts/types` screen (`controllers/admin/Contracts.php`, `models/Contract_types_model.php`, `views/admin/contracts/manage_types.php` and `contract_type.php`). Started as a copy of erp-docs `05-templates/backend-module` (forms: singular `contract-type`, plural `contract-types`) and reshaped to the table's columns; the screens live under `/setup/contract-types` in erp-web, the api under `api/v1/contract-types`. Staff can add a type straight from the contract form (`/admin/contracts/type`); that quick add stays on Perfex and is not blocked.

## Owned tables

- `tblcontracts_types`: claimed for `node` in the ownership register (`prisma/ownership.json`), written here through Prisma's typed delegate, which the ownership guard admits because the register names `node`. Node writes `name` (`LONGTEXT`, no length limit); `id` is assigned by the database. An update writes the name and nothing else. Perfex's delete is closed at Nginx.

Read only, never written (DB-03):

- `CONTRACT_TYPE_REFERENCES` (the repository's docblock), what refers to a contract type, for each row's usage and the delete refusal. A declared candidate list (D-28); before every usage read ONE `information_schema.COLUMNS` probe answers which candidates the connected schema has, and only those run. A missing candidate counts 0 and raises no error.

| Group       | Owner   | Table and column            | Match  | Notes                                            |
| ----------- | ------- | --------------------------- | ------ | ------------------------------------------------ |
| `contracts` | contracts | `tblcontracts.contract_type` | the id | Active in Perfex core                            |
| `contracts` | goals     | `tblgoals.contract_type`     | the id | Goals module candidate (when active in database) |

## Facade surface

- `describe(): { module: 'contract-types'; version: 1 }`
- `findById(id: number): Promise<ContractType | null>`
- `listAll(): Promise<readonly ContractType[]>`: every contract type, the name ascending, then the id (the order Perfex's pickers read); refused loudly (`ERP-INTERNAL-0001`) above `CONTRACT_TYPES_FACADE_MAX_ROWS` (1,000), never truncated
- `findByIds(ids: readonly number[]): Promise<readonly ContractType[]>`: in the order given, each id once, absent ids skipped

`ContractType` is `{ id: number; name: string }`, never the wire DTO. No facade method writes or asserts the administrator flag: a module-to-module read has no actor. Other modules import only `src/v1/contract-types/index.ts` (the facade and the `ContractType` / `ContractTypeId` types) and `ContractTypesModule`.

## Endpoints

Under `api/v1/contract-types` (`CONTRACT_TYPES_ROUTES` in `contract-types.routes.ts`). All six are administrators only (D-06, D-26): every handler carries `JwtAuthGuard, PermissionGuard` and declares no permission code, and the service asserts the administrator flag as the first statement of every use case, so a member holding every catalogue code is still refused. `@erp/contracts`' `ROUTE_GATES` declares the three screens `'admin'` and `__tests__/route-gates.spec.ts` compares every handler with it. Every failure is an RFC 9457 problem (`application/problem+json`) with an `ERP-*` code: 400 `ERP-VALIDATION-0001` (+ `issues`), 401 `ERP-AUTH-0004`, 403 `ERP-AUTH-0005` (not an administrator).

| Method   | Path     | Success                                                                                                                                                                                                 | Errors beyond the three                                                                 |
| -------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `GET`    | ``       | 200 `{ data, meta: { nextCursor, prevCursor, total, rangeStart, exportLimit, printLimit } }`, each row `{ id, name, usage }`; `?limit&cursor&q&sort` (`-name` default, `name`, `id`, `-id`)             | none                                                                                    |
| `GET`    | `export` | 200 by `?format=`: `csv` (absent), `xlsx`, `pdf` (each `attachment; filename="contract-types-YYYY-MM-DD.<ext>"`) or `print` (JSON rows, no attachment); `no-store`; columns `name`, `contracts`    | 400 on `export` over the format's cap; on `key` (no row selection); on `font` for a PDF |
| `GET`    | `:id`    | 200 `{ id, name, usage }`                                                                                                                                                                               | 404 `ERP-CORE-0004`                                                                     |
| `POST`   | ``       | 201 the contract type                                                                                                                                                                                   | none                                                                                    |
| `PATCH`  | `:id`    | 200 the contract type                                                                                                                                                                                   | 404 `ERP-CORE-0004`                                                                     |
| `DELETE` | `:id`    | 204, no body                                                                                                                                                                                            | 404 `ERP-CORE-0004`; 409 `ERP-CONTRACTTYPES-0001`                                       |

The body is `{ name }`, strict: the name is required, trimmed, min 1 character with no length limit (the column is `LONGTEXT`), every character accepted and stored as text, and a name another contract type holds is accepted (Perfex has no uniqueness check); any other key (`id`, ...) is a 400 naming it, and `{}` on `PATCH` is a 400 on `['name']`. `usage` holds `{ contracts: number }`. `q` matches the name (contains, under the column's collation) and, when `q` is all digits up to 4294967295, the id.

`ERP-CONTRACTTYPES-0001` (DELETE): `contracts` is non-zero, or the usage count fails or does not name the id (`its use could not be counted`). Nothing is deleted and no event is published.

## Events published

| Event                           | When                      | Payload                                |
| ------------------------------- | ------------------------- | -------------------------------------- |
| `contract-types.record.created` | after `POST` stores it    | `{ id, at }`, `ContractTypesCreatedV1` |
| `contract-types.record.updated` | after `PATCH` saves it    | `{ id, at }`, `ContractTypesUpdatedV1` |
| `contract-types.record.deleted` | after `DELETE` removes it | `{ id, at }`, `ContractTypesDeletedV1` |

Declared in `events/published.ts` (`CONTRACT_TYPES_PUBLISHED_EVENTS`), published through `DOMAIN_EVENT_PUBLISHER` from `service/contract-types.transport.ts`. A payload carries the id and the server time, never the name. After each publish the service writes one `LoggerService.log` line with `{ id }`, which carries `requestId` and `staffId` from the request context.

## Events subscribed

None. Listed in `events/subscribed.ts` (`CONTRACT_TYPES_SUBSCRIBED_EVENTS`).

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound HTTP, no vendor call.
- **Retry policy:** none on writes: an unkeyed `POST` retried could create two rows, and the events are in-process.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`, asserted by `check:db`); a list page costs the page, two counts, the probe, one statement per present candidate in one `Promise.all`; no extra DB or Redis client.

## Layers

| File                                          | Responsibility                                                                                                                                                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `contract-types.module.ts`                    | Wires every layer as a provider; exports `ContractTypesFacade` only; not global                                                                                                                                            |
| `contract-types.routes.ts`                    | `CONTRACT_TYPES_ROUTES` (`base`, `list`, `export`, `record`), `CONTRACT_TYPES_EXPORT_COLUMNS`, `CONTRACT_TYPES_EXPORT_FILE_STEM`; no permission map                                                                        |
| `controller/contract-types.controller.ts`     | The six handlers, each `@UseGuards(JwtAuthGuard, PermissionGuard)` with no permission code, `@CurrentUser()` and `@ApiZod`; the DELETE answers 204                                                                         |
| `service/contract-types.service.ts`           | `assertAdministrator` first in `list`, `get`, `create`, `update`, `remove` and `exportCsv`; export columns; the 409; the event after a write, then the `log` line; the facade reads                                     |
| `service/contract-types.validator.ts`         | `parseListQuery` (one sort from `CONTRACT_TYPES_SORT_FIELDS`, default `-name`), `parseExportList`, `parseParams`, `parseCreateBody`, `parseUpdateBody`                                                                     |
| `service/contract-types.transformer.ts`       | `toResponse`, `toExportRow`, `CONTRACT_TYPES_EXPORT_CELLS`, `toContractType`; the list envelope with `exportLimit` and `printLimit`                                                                                        |
| `service/contract-types.transport.ts`         | Domain events to the publisher port                                                                                                                                                                                        |
| `repository/contract-types.repository.ts`     | The only Prisma caller: the keyset list, `count`, `findById`, `create`, `update` (the name only), `remove`, `presentReferences`, `usageByContractType`, `listAll`, `findByIds`                                             |
| `model/contract-types.model.ts`               | `ContractTypeRow`, `NewContractType`, `ContractTypeUsage`, `ContractType`, `ContractTypeId`, `ContractTypesSortField`, `ContractTypesListRequest`, `ContractTypesPage`, `CONTRACT_TYPES_FACADE_MAX_ROWS`                   |
| `dto/contract-types.dto.ts`                   | The list, export and params schemas, the strict body, the response and envelope schemas (`CONTRACT_TYPES_SEARCH_MAX`)                                                                                                     |
| `events/published.ts`, `events/subscribed.ts` | `ContractTypesCreatedV1`, `ContractTypesUpdatedV1`, `ContractTypesDeletedV1` / none                                                                                                                                        |
| `facade/contract-types.facade.ts`             | The only surface other modules may import; `describe()`, `findById`, `listAll`, `findByIds`                                                                                                                                |
| `index.ts`                                    | Public re-exports: `ContractTypesFacade` and the `ContractType`, `ContractTypeId` types                                                                                                                                    |
| `__tests__/`                                  | One spec per layer; `contract-types.repository.spec.ts` (D-28 over a stub client) and `contract-types.repository.int.spec.ts` (the local database); `route-gates.spec.ts`; `fakes.ts`; `create-contract-types-test-app.ts` |

## How to run its tests

```bash
corepack yarn test src/v1/contract-types          # unit, the repository over a stub client (D-28), the gates and the in-process controller e2e spec (no network, no database)
corepack yarn test:int src/v1/contract-types      # the repository against the local stack (node ../erp-infra/scripts/local-up.mjs first)
```

The int spec writes only `tblcontracts_types` rows and deletes them before and after the run; it never writes a Perfex-owned table and never reads a local value into an assertion message.

## Legacy parity

Perfex's `admin/contracts/types` screen, rebuilt from its views. Business outcomes are kept 1:1; each workflow simplification is listed:

- Quick add stays on Perfex: staff can add a type straight from the contract form (`/admin/contracts/type`).
- Delete while in use is refused (`is_referenced`).
- Administrators only: non-admin access is refused.
