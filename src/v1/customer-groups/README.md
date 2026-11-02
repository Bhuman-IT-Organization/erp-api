# customer-groups

## Purpose

The Customer Groups list: list, read, create, update, delete and export the customer groups Perfex's customer profile assigns customers to, replacing Perfex's `admin/clients/groups` screen. The screens live under `/setup/customer-groups` in erp-web, the api under `api/v1/customer-groups`. Started as a copy of erp-docs `05-templates/backend-module` and reshaped to the table's one column (the name). The quick add on the customer profile stays on Perfex and is not touched.

## Owned tables

- `tblcustomers_groups`: the groups. Node writes `name` (`VARCHAR(191)`, `CUSTOMER_GROUPS_NAME_MAX`); `id` is assigned by the database. An update writes the name and nothing else.

## Read-only tables

- `tblcustomer_groups`: the links between customers and groups. Owned by `perfex-core`: Perfex keeps writing it from the customer screens (customer create, profile save, customer delete, bulk actions), so Node must not own it. Node only counts the rows of a group (read only) to refuse a group delete while any customer is in it. It never creates, changes or deletes a link.

## Facade surface

- `describe(): { module: 'customer-groups'; version: 1 }`
- `findById(id: number): Promise<CustomerGroup | null>`
- `listAll(): Promise<readonly CustomerGroup[]>`: every customer group, the name ascending, then the id
- `findByIds(ids: readonly number[]): Promise<readonly CustomerGroup[]>`: in the order given, each id once, absent ids skipped

No facade method writes or asserts the administrator flag: a module-to-module read has no actor. Other modules import only `src/v1/customer-groups/index.ts`.

## Endpoints

Under `api/v1/customer-groups` (`CUSTOMER_GROUPS_ROUTES` in `customer-groups.routes.ts`). All six are administrators only: the service asserts the administrator flag as the first statement of every use case, and `@erp/contracts`' `ROUTE_GATES` declares the three screens `'admin'`. Every failure is an RFC 9457 problem (`application/problem+json`) with an `ERP-*` code: 400 `ERP-VALIDATION-0001` (+ `issues`), 401 `ERP-AUTH-0004`, 403 `ERP-AUTH-0005` (not an administrator).

| Method   | Path     | Success                                                                                                                          | Errors beyond the three                                                      |
| -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `GET`    | ``       | 200 `{ data, meta }`, each row `{ id, name }`; `?limit&cursor&q&sort` (`-name` default, `id`, `name`)                            | none                                                                         |
| `GET`    | `export` | 200, the groups the list query matches as a file: `?format=` csv, xlsx, pdf or print (`format`, `column`, `header`, `q`, `sort`) | none                                                                         |     |
| `GET`    | `:id`    | 200 `{ id, name }`                                                                                                               | 404 `ERP-CORE-0004`                                                          |
| `POST`   | ``       | 201 the customer group                                                                                                           | none                                                                         |
| `PATCH`  | `:id`    | 200 the customer group                                                                                                           | 404 `ERP-CORE-0004`                                                          |
| `DELETE` | `:id`    | 204, no body                                                                                                                     | 404 `ERP-CORE-0004`; 409 `ERP-CUSTOMERGROUPS-0001` ("used by N customer(s)") |

The body is `{ name }`, strict: the name is required, trimmed, 1 to 191 characters; any other key is a 400 naming it, and `{}` on `PATCH` is a 400 on `['name']`. A name another group holds is accepted (no duplicate check, as in Perfex). `q` matches the name (contains) and, when `q` is all digits, the id. With no `sort` the list reads the name descending (`-name`), Perfex's order.

`GET export` answers every group the list's query (`q`, `sort`) matches as csv, xlsx, pdf or print, the way Perfex's groups table has its export buttons. The columns are ID and Name; a CSV or Excel cell that starts with a formula character is escaped; a `key`, `limit` or `cursor` is a 400. Administrators only, like the list.

A `DELETE` counts the customers in the group (`tblcustomer_groups`, read only). While any customer is in the group it answers 409 `ERP-CUSTOMERGROUPS-0001` (`used by N customer(s)`), deletes nothing and publishes no event; an empty group is deleted (204). Node never deletes the links: the customers are moved out of the group on the Perfex side.

## Events published

| Event                            | When                      | Payload                                 |
| -------------------------------- | ------------------------- | --------------------------------------- |
| `customer-groups.record.created` | after `POST` stores it    | `{ id, at }`, `CustomerGroupsCreatedV1` |
| `customer-groups.record.updated` | after `PATCH` saves it    | `{ id, at }`, `CustomerGroupsUpdatedV1` |
| `customer-groups.record.deleted` | after `DELETE` removes it | `{ id, at }`, `CustomerGroupsDeletedV1` |

Declared in `events/published.ts` (`CUSTOMER_GROUPS_PUBLISHED_EVENTS`), published through `DOMAIN_EVENT_PUBLISHER` from `service/customer-groups.transport.ts`. A payload carries the id and the server time, never the name. A refused delete (409) publishes nothing. After each publish the service writes one `LoggerService.log` line, `customer group created|updated|deleted` with `{ id }`.

## Events subscribed

None. Listed in `events/subscribed.ts`.

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound HTTP, no vendor call.
- **Retry policy:** none on writes: an unkeyed `POST` retried could create two rows, and the events are in-process.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`); a delete is one read-only count and then one single-row delete on `tblcustomers_groups`; no extra DB or Redis client.

## Layers

| File                                          | Responsibility                                                                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customer-groups.module.ts`                   | Wires every layer as a provider; exports `CustomerGroupsFacade` only; not global                                                                         |
| `customer-groups.routes.ts`                   | `CUSTOMER_GROUPS_ROUTES` (`base`, `list`, `export`, `record`); no permission map                                                                         |
| `controller/customer-groups.controller.ts`    | The six handlers; the DELETE `@ApiZod` declares 204, 404 and 409; `export` answers the list as a file                                                    |
| `service/customer-groups.service.ts`          | `assertAdministrator` first in every use case, `export` included; the in-use refusal (409); the event after a write, then the log line; the facade reads |
| `service/customer-groups.transport.ts`        | Domain events to the publisher port (`customer-groups.record.*`, id only)                                                                                |
| `service/customer-groups.validator.ts`        | `parseListQuery` (one sort, default `-name`), `parseParams`, `parseCreateBody`, `parseUpdateBody`                                                        |
| `service/customer-groups.transformer.ts`      | `toResponse`, `toListResponse`, `toCustomerGroup`                                                                                                        |
| `repository/customer-groups.repository.ts`    | The only Prisma caller: the keyset list, `findById`, `create`, `update`, `countCustomers` (read only), `remove`, `listAll`, `findByIds`                  |
| `model/customer-groups.model.ts`              | Row, list request and facade types                                                                                                                       |
| `dto/customer-groups.dto.ts`                  | The list, export and params schemas, the strict body schema, the response and envelope schemas                                                           |
| `events/published.ts`, `events/subscribed.ts` | Published events list / none                                                                                                                             |
| `facade/customer-groups.facade.ts`            | The only surface other modules may import                                                                                                                |
| `index.ts`                                    | Public re-exports                                                                                                                                        |
| `__tests__/`                                  | One spec per layer; `route-gates.spec.ts`; `fakes.ts`; `create-customer-groups-test-app.ts`                                                              |

## Legacy parity

Perfex's `admin/clients/groups` screen. Business outcomes are kept 1:1; each simplification or change is listed:

| Perfex                                   | Node                                                                                                     | Notes                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| the groups list and its modal form       | the list, `POST` and `PATCH` behind `/setup/customer-groups`, `/new` and `/:id`                          | pages instead of a modal                                                  |
| the groups table, ordered by name        | the list, the name descending by default (`-name`)                                                       | Perfex's order                                                            |
| the table's export buttons               | `GET export` (csv, xlsx, pdf, print)                                                                     | the same four outputs                                                     |
| a delete removes the group and its links | a delete is refused with 409 `ERP-CUSTOMERGROUPS-0001` while any customer is in the group; otherwise 204 | deliberate change: Perfex owns `tblcustomer_groups`, Node never writes it |
| no duplicate-name check                  | none either                                                                                              | a duplicate name is accepted                                              |
| the success alert after a save or delete | a toast                                                                                                  | the screens                                                               |

## How to run its tests

```bash
corepack yarn test src/v1/customer-groups
```
