# customer-groups

## Purpose

The Customer Groups list: list, read, create, update and delete the customer groups Perfex's customer profile assigns customers to, replacing Perfex's `admin/clients/groups` screen. The screens live under `/setup/customer-groups` in erp-web, the api under `api/v1/customer-groups`. Started as a copy of erp-docs `05-templates/backend-module` and reshaped to the table's one column (the name). The quick add on the customer profile stays on Perfex and is not touched.

## Owned tables

- `tblcustomers_groups`: the groups. Node writes `name` (`VARCHAR(191)`, `CUSTOMER_GROUPS_NAME_MAX`); `id` is assigned by the database. An update writes the name and nothing else.
- `tblcustomer_groups`: the links between customers and groups. Node only deletes the rows of a deleted group, in the same transaction as the group (the repository). It never creates or changes a link.

## Facade surface

- `describe(): { module: 'customer-groups'; version: 1 }`
- `findById(id: number): Promise<CustomerGroup | null>`
- `listAll(): Promise<readonly CustomerGroup[]>`: every customer group, the name ascending, then the id
- `findByIds(ids: readonly number[]): Promise<readonly CustomerGroup[]>`: in the order given, each id once, absent ids skipped

No facade method writes or asserts the administrator flag: a module-to-module read has no actor. Other modules import only `src/v1/customer-groups/index.ts`.

## Endpoints

Under `api/v1/customer-groups` (`CUSTOMER_GROUPS_ROUTES` in `customer-groups.routes.ts`). All five are administrators only: the service asserts the administrator flag as the first statement of every use case, and `@erp/contracts`' `ROUTE_GATES` declares the three screens `'admin'`. Every failure is an RFC 9457 problem (`application/problem+json`) with an `ERP-*` code: 400 `ERP-VALIDATION-0001` (+ `issues`), 401 `ERP-AUTH-0004`, 403 `ERP-AUTH-0005` (not an administrator).

| Method   | Path  | Success                                                                                             | Errors beyond the three |
| -------- | ----- | --------------------------------------------------------------------------------------------------- | ----------------------- |
| `GET`    | ``    | 200 `{ data, meta }`, each row `{ id, name }`; `?limit&cursor&q&sort` (`-id` default, `id`, `name`) | none                    |
| `GET`    | `:id` | 200 `{ id, name }`                                                                                  | 404 `ERP-CORE-0004`     |
| `POST`   | ``    | 201 the customer group                                                                              | none                    |
| `PATCH`  | `:id` | 200 the customer group                                                                              | 404 `ERP-CORE-0004`     |
| `DELETE` | `:id` | 204, no body                                                                                        | 404 `ERP-CORE-0004`     |

The body is `{ name }`, strict: the name is required, trimmed, 1 to 191 characters; any other key is a 400 naming it, and `{}` on `PATCH` is a 400 on `['name']`. A name another group holds is accepted (no duplicate check, as in Perfex). `q` matches the name (contains) and, when `q` is all digits, the id. There is no export and no delete refusal: a group is deleted together with its customer links.

## Events published

None.

## Events subscribed

None. Listed in `events/subscribed.ts`.

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound HTTP, no vendor call.
- **Retry policy:** none on writes: an unkeyed `POST` retried could create two rows.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`); a delete is one transaction; no extra DB or Redis client.

## Layers

| File                                          | Responsibility                                                                                            |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `customer-groups.module.ts`                   | Wires every layer as a provider; exports `CustomerGroupsFacade` only; not global                          |
| `customer-groups.routes.ts`                   | `CUSTOMER_GROUPS_ROUTES` (`base`, `list`, `record`); no permission map                                    |
| `controller/customer-groups.controller.ts`    | The five handlers                                                                                         |
| `service/customer-groups.service.ts`          | `assertAdministrator` first in every use case; the log lines; the facade reads                            |
| `service/customer-groups.validator.ts`        | `parseListQuery` (one sort, default `-id`), `parseParams`, `parseCreateBody`, `parseUpdateBody`           |
| `service/customer-groups.transformer.ts`      | `toResponse`, `toListResponse`, `toCustomerGroup`                                                         |
| `repository/customer-groups.repository.ts`    | The only Prisma caller: the keyset list, `findById`, `create`, `update`, `remove`, `listAll`, `findByIds` |
| `model/customer-groups.model.ts`              | Row, list request and facade types                                                                        |
| `dto/customer-groups.dto.ts`                  | The list, params and strict body schemas, the response and envelope schemas                               |
| `events/published.ts`, `events/subscribed.ts` | None / none                                                                                               |
| `facade/customer-groups.facade.ts`            | The only surface other modules may import                                                                 |
| `index.ts`                                    | Public re-exports                                                                                         |
| `__tests__/`                                  | One spec per layer; `route-gates.spec.ts`; `fakes.ts`; `create-customer-groups-test-app.ts`               |

## Legacy parity

Perfex's `admin/clients/groups` screen. Business outcomes are kept 1:1; each simplification is listed:

| Perfex                                   | Node                                                                            | Notes                        |
| ---------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------- |
| the groups list and its modal form       | the list, `POST` and `PATCH` behind `/setup/customer-groups`, `/new` and `/:id` | pages instead of a modal     |
| a delete removes the group and its links | the same, in ONE transaction                                                    | no in-use refusal            |
| no duplicate-name check                  | none either                                                                     | a duplicate name is accepted |
| the success alert after a save or delete | a toast                                                                         | the screens                  |

## How to run its tests

```bash
corepack yarn test src/v1/customer-groups
```
