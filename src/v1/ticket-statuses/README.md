# ticket-statuses

## Purpose

Moves the administrator-only Ticket Statuses setup list from Perfex to the Node API. It preserves the existing status fields and Perfex's status-order sorting. This API provides the backend surface only; the screen and the Nginx handoff are outside this repository change.

## Owned tables

- `tbltickets_status` is Node-owned for the writes performed by this module. Prisma's existing model is reused; no table or migration is added. `isdefault` is read-only through the API, and new rows use the table's default value.
- `tbltickets.status` is read-only here and checked before a status is deleted.
- `tbloptions.default_ticket_reply_status` is read through `SettingsFacade`; it is never written or returned.

## Facade surface

- `findById(id)` returns a stored `TicketStatus` or `null`.
- `listAll()` returns stored statuses ordered by `statusorder`, then `ticketstatusid`.

The facade is read-only and returns model types, not HTTP DTOs.

## Endpoints

All endpoints are under `/api/v1/ticket-statuses`, require authentication, and assert the administrator flag in the service before validation or I/O.

| Method   | Path   | Success                        | Behavior                                                                            |
| -------- | ------ | ------------------------------ | ----------------------------------------------------------------------------------- |
| `GET`    | `/`    | `200 { data: TicketStatus[] }` | List all statuses ordered by status order                                           |
| `GET`    | `/:id` | `200 TicketStatus`             | Read one status; missing ids return `ERP-CORE-0004`                                 |
| `POST`   | `/`    | `201 TicketStatus`             | Create with `name`, optional `statuscolor`, and optional `statusorder`              |
| `PATCH`  | `/:id` | `200 TicketStatus`             | Update one or more editable fields                                                  |
| `DELETE` | `/:id` | `204`                          | Delete unless built-in, used by a ticket, or configured as the default reply status |

The wire DTO contains `ticketstatusid` (string), `name`, `isdefault`, `statuscolor` (nullable), and `statusorder` (nullable). Names are trimmed and limited to 50 characters. Colors accept an empty string, `null`, or a six-digit `#RRGGBB` value. IDs and order values must fit the signed Prisma `Int`. Request bodies are strict; `ticketstatusid` and `isdefault` cannot be mass-assigned.

Deleting a built-in status returns `ERP-TICKETSTATUSES-0002`. A ticket reference or a matching `default_ticket_reply_status` returns `ERP-TICKETSTATUSES-0001` with detail `is_referenced`. A failed ticket or setting check propagates and never falls through to deletion.

`@erp/contracts` declares `/setup/ticket-statuses`, `/setup/ticket-statuses/new`, and `/setup/ticket-statuses/:id` as `ADMIN_GATE`. The separate route-gate declaration in `erp-web` must be kept in sync when that repository's screen is implemented; it is not changed here.

Pagination, search, export, and writes to `tbltickets` or `tbloptions` are out of scope.

## Events published

| Event                            | When                      |
| -------------------------------- | ------------------------- |
| `ticket-statuses.record.created` | After a status is created |
| `ticket-statuses.record.updated` | After a status is updated |
| `ticket-statuses.record.deleted` | After a status is deleted |

## Events subscribed

None.

## Jobs

None.

## Resilience

- **Breaker:** None; the module makes no outbound HTTP calls.
- **Retry policy:** None; a failed database or settings read is surfaced and a delete is refused.
- **Pool budget:** Uses the shared Prisma connection pool.

## Layers

| Layer         | Responsibility                                                                  |
| ------------- | ------------------------------------------------------------------------------- |
| `controller/` | Guarded HTTP routes and `@ApiZod` contracts                                     |
| `dto/`        | Strict Zod request and response schemas                                         |
| `events/`     | Published domain events; no subscribers                                         |
| `facade/`     | Read-only module boundary                                                       |
| `model/`      | Stored status and write types                                                   |
| `repository/` | The only layer that accesses Prisma                                             |
| `service/`    | Administrator checks, delete rules, orchestration, transformation and transport |

## How to run its tests

Run the focused suite from `erp-api`:

```sh
corepack yarn test --run src/v1/ticket-statuses/__tests__
```

The repository integration spec is skipped unless `DATABASE_URL` is set.
