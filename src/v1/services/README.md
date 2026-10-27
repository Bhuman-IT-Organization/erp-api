# services

## Purpose

The Services (tickets) list (Setup > Support > Services): list, read, create, update, delete and the four-format export of the services a ticket can be filed under, replacing Perfex's `admin/tickets/services` screen (`controllers/admin/Tickets.php` functions `services`, `service` and `delete_service`, `views/admin/tickets/services/manage.php` and `service.php`, `models/Tickets_model.php`). The screens live under `/setup/services` in erp-web, the api under `api/v1/services`.

## Owned tables

- `tblservices`: claimed for `node` in the ownership register, written here through Prisma's typed delegate, which the ownership guard admits because the register names `node`. Node writes `name` (`VARCHAR(50)`); `serviceid` is assigned by the database. An update writes the name and nothing else. Perfex's own screen was its primary writer before this migration. Node now writes `tblservices` through this module, and Perfex's quick add on the ticket form (`/admin/tickets/service`) remains an additional writer and stays on Perfex.

Read only, never written (DB-03):

- `tbltickets.service` (perfex-core): counted for the delete refusal (Perfex's `is_referenced`). One `count` per delete; an error rejects the whole delete (fail closed).

## Facade surface

- `describe(): { module: 'services'; version: 1 }`
- `findById(id: number): Promise<Service | null>`
- `listAll(): Promise<readonly Service[]>`: every service, the name ascending, then the id; refused loudly (`ERP-INTERNAL-0001`) above `SERVICES_FACADE_MAX_ROWS` (1,000), never truncated
- `findByIds(ids: readonly number[]): Promise<readonly Service[]>`: in the order given, each id once, absent ids skipped

`Service` is `{ id: number; name: string }`, never the wire DTO. No facade method writes or asserts the administrator flag: a module-to-module read has no actor. Other modules import only `src/v1/services/index.ts` (the facade and the `Service` / `ServiceId` types) and `ServicesModule`.

## Endpoints

Under `api/v1/services` (`SERVICES_ROUTES` in `services.routes.ts`). All six are administrators only (D-06, D-26): every handler carries `JwtAuthGuard, PermissionGuard` and declares no permission code, and the service asserts the administrator flag as the first statement of every use case. `@erp/contracts`' `ROUTE_GATES` declares the three screens `'admin'` and `__tests__/route-gates.spec.ts` compares every handler with it. Every failure is an RFC 9457 problem (`application/problem+json`) with an `ERP-*` code: 400 `ERP-VALIDATION-0001` (+ `issues`), 401 `ERP-AUTH-0004`, 403 `ERP-AUTH-0005` (not an administrator).

| Method   | Path     | Success                                                                                                                                                                            | Errors beyond the three                                            |
| -------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET`    | ``       | 200 `{ data, meta: { nextCursor, prevCursor, total, rangeStart, exportLimit, printLimit } }`, each row `{ id, name }`; `?limit&cursor&q&sort` (`-id` default, `id`, `name`)        | none                                                               |
| `GET`    | `export` | 200 by `?format=`: `csv` (absent), `xlsx`, `pdf` (each `attachment; filename="services-YYYY-MM-DD.<ext>"`) or `print` (JSON rows, no attachment); `no-store`; columns `id`, `name` | 400 on `export` over the format's cap; on `key` (no row selection) |
| `GET`    | `:id`    | 200 `{ id, name }`                                                                                                                                                                 | 404 `ERP-CORE-0004`                                                |
| `POST`   | ``       | 201 the service                                                                                                                                                                    | none                                                               |
| `PATCH`  | `:id`    | 200 the service                                                                                                                                                                    | 404 `ERP-CORE-0004`                                                |
| `DELETE` | `:id`    | 204, no body                                                                                                                                                                       | 404 `ERP-CORE-0004`; 409 `ERP-SERVICES-0001`                       |

The body is `{ name }`, strict: the name is required, trimmed, 1 to 50 characters (`SERVICES_NAME_MAX`), every character accepted and stored as text (`<` and `>` included, rendered as text), and a name another service holds is accepted (Perfex has no uniqueness check); any other key (`serviceid`, `id`, ...) is a 400 naming it, and `{}` on `PATCH` is a 400 on `['name']`. `q` matches the name (contains, under the column's collation) and, when `q` is all digits up to 2147483647, the id. The export runs on the shared core (`shared/http/export.ts`), administrators first for every format, and CSV and Excel escape a leading formula character in every cell and header label.

`ERP-SERVICES-0001` (DELETE): a ticket still uses the service (`used by 2 ticket(s)`). Nothing is deleted and no event is published. The detail names a count only, never a name.

## Events published

| Event                     | When                      | Payload                           |
| ------------------------- | ------------------------- | --------------------------------- |
| `services.record.created` | after `POST` stores it    | `{ id, at }`, `ServicesCreatedV1` |
| `services.record.updated` | after `PATCH` saves it    | `{ id, at }`, `ServicesUpdatedV1` |
| `services.record.deleted` | after `DELETE` removes it | `{ id, at }`, `ServicesDeletedV1` |

Declared in `events/published.ts` (`SERVICES_PUBLISHED_EVENTS`), published through `DOMAIN_EVENT_PUBLISHER` from `service/services.transport.ts`. A payload carries the id and the server time, never the name. After each publish the service writes one `LoggerService.log` line, `service created|updated|deleted` with `{ id }`, which carries `requestId` and `staffId` from the request context (D-08, BE-10).

## Events subscribed

None. Listed in `events/subscribed.ts` (`SERVICES_SUBSCRIBED_EVENTS`).

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound HTTP, no vendor call, no other module read; the events are an in-process call.
- **Retry policy:** none on writes: an unkeyed `POST` retried could create two rows, and the events are in-process.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`, asserted by `check:db`); a list page costs the page and two counts, a delete one read, one ticket count and the delete; no extra DB or Redis client.

## Layers

| File                                          | Responsibility                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services.module.ts`                          | Wires every layer as a provider; exports `ServicesFacade` only; not global                                                                                          |
| `services.routes.ts`                          | `SERVICES_ROUTES` (`base`, `list`, `export`, `record`), `SERVICES_EXPORT_COLUMNS`, `SERVICES_EXPORT_FILE_STEM`; no permission map                                   |
| `controller/services.controller.ts`           | The six handlers, each `@UseGuards(JwtAuthGuard, PermissionGuard)` with no permission code, `@CurrentUser()` and `@ApiZod`; the DELETE answers 204                  |
| `service/services.service.ts`                 | `assertAdministrator` first in `list`, `get`, `create`, `update`, `remove` and `exportCsv`; the 409; the event after a write, then the `log` line; the facade reads |
| `service/services.validator.ts`               | `parseListQuery` (one sort from `SERVICES_SORT_FIELDS`, default `-id`), `parseExportList`, `parseParams`, `parseCreateBody`, `parseUpdateBody`                      |
| `service/services.transformer.ts`             | `toResponse`, `toExportRow`, `SERVICES_EXPORT_CELLS`, `toService`; the list envelope with `exportLimit` and `printLimit`                                            |
| `service/services.transport.ts`               | Domain events to the publisher port                                                                                                                                 |
| `repository/services.repository.ts`           | The only Prisma caller: the keyset list, `count`, `findById`, `create`, `update` (the name only), `remove`, `countTickets`, `listAll`, `findByIds`                  |
| `model/services.model.ts`                     | `ServiceRow`, `NewService`, `Service`, `ServiceId`, `ServicesSortField`, `ServicesListRequest`, `ServicesPage`, `SERVICES_FACADE_MAX_ROWS`                          |
| `dto/services.dto.ts`                         | The list, export and params schemas, the strict body, the response and envelope schemas (`SERVICES_NAME_MAX`, `SERVICES_SEARCH_MAX`)                                |
| `events/published.ts`, `events/subscribed.ts` | `ServicesCreatedV1`, `ServicesUpdatedV1`, `ServicesDeletedV1` / none                                                                                                |
| `facade/services.facade.ts`                   | The only surface other modules may import; `describe()`, `findById`, `listAll`, `findByIds`                                                                         |
| `index.ts`                                    | Public re-exports: `ServicesFacade` and the `Service`, `ServiceId` types                                                                                            |
| `__tests__/`                                  | One spec per layer; `services.repository.int.spec.ts` (the local database); `route-gates.spec.ts`; `fakes.ts`; `create-services-test-app.ts`                        |

## Legacy parity

Perfex's `admin/tickets/services` screen, rebuilt from its views. Business outcomes are kept 1:1; each workflow simplification is listed:

| Perfex                                                                            | Node                                                                         | Notes                                                                                            |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| the list with an add/edit modal                                                   | `GET`, `POST`, `PATCH` behind the `/setup/services`, `/new` and `/:id` pages | the modal becomes a page (D-04)                                                                  |
| the table ordered by name                                                         | the list, the id descending by default                                       | Perfex orders by service name; Node defaults to id descending                                    |
| `Tickets_model::delete_service` refuses a service a ticket uses (`is_referenced`) | `DELETE` refused with 409 `ERP-SERVICES-0001`                                | same outcome, in the feature's words                                                             |
| administrator checks using `is_admin()` in `Tickets.php`                          | administrators only on every endpoint                                        | Perfex checks administration access; Node enforces administrator access on every endpoint (D-26) |
| the quick add on the ticket form (`/admin/tickets/service`)                       | stays on Perfex                                                              | not blocked at Nginx                                                                             |
| no uniqueness check                                                               | none either: a duplicate name is accepted                                    | the same                                                                                         |
| the success alert after a save or delete                                          | a toast                                                                      | the screens                                                                                      |

## How to run its tests

```bash
corepack yarn test src/v1/services          # unit, the gates and the in-process controller e2e spec (no network, no database)
corepack yarn test:int src/v1/services      # the repository against the local stack (node ../erp-infra/scripts/local-up.mjs first)
```

The int spec writes only `tblservices` rows whose name starts with `int-spec-svc` and deletes them before and after the run; it never writes a Perfex-owned table and never reads a local value into an assertion message.
