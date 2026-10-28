# ticket-statuses

## Purpose

Replaces Perfex's Ticket Statuses setup screen with an administrator-only API and setup screen. The module provides paged listing, search, CRUD, export, and protection against deleting statuses that cannot safely be removed.

The API is under `/api/v1/ticket-statuses`. The erp-web screen is under `/setup/ticket-statuses`; the list, create, and record routes are declared as `ADMIN_GATE` in both `@erp/contracts` and erp-web's route-gate mirror.

## Owned tables

- `tbltickets_status` is owned for writes by this module and registered to `node` in `prisma/ownership.json`. Prisma's existing model is used; this module adds no table or migration.
- `tbltickets.status` is read to calculate `ticket_count` and refuse deletion while a ticket references the status.
- `tbloptions.default_ticket_reply_status` is read through `SettingsFacade` and is never written here.

## Facade surface

- `findById(id)` returns a stored `TicketStatus` or `null`.
- `listAll()` returns all statuses for internal consumers.

The facade is read-only and returns model types rather than HTTP DTOs. It does not assert an administrator because module-to-module reads have no request actor.

## Endpoints

All endpoints require authentication. The service requires the administrator flag before parsing input or accessing data; the real `JwtAuthGuard` and `PermissionGuard` remain on every handler.

| Method   | Path                                           | Success              | Behavior                                                                                                                                                       |
| -------- | ---------------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`    | `/api/v1/ticket-statuses?limit&cursor&q&sort`  | `200 { data, meta }` | BE-19 keyset page; default sort is `-id` (newest first). Metadata contains `nextCursor`, `prevCursor`, `total`, `rangeStart`, `exportLimit`, and `printLimit`. |
| `GET`    | `/api/v1/ticket-statuses/export?format&q&sort` | `200` export         | CSV, XLSX, PDF, or print output using the same search and sort semantics as the list. Columns are `id`, `name`, and `ticket_count`.                            |
| `GET`    | `/api/v1/ticket-statuses/:id`                  | `200 TicketStatus`   | Read a status; a missing id returns `ERP-CORE-0004`.                                                                                                           |
| `POST`   | `/api/v1/ticket-statuses`                      | `201 TicketStatus`   | Create with `name`, optional `statuscolor`, and optional `statusorder`.                                                                                        |
| `PATCH`  | `/api/v1/ticket-statuses/:id`                  | `200 TicketStatus`   | Update editable status fields.                                                                                                                                 |
| `DELETE` | `/api/v1/ticket-statuses/:id`                  | `204`                | Delete only when the status is not built-in, referenced, or configured as the default reply status.                                                            |

List rows, record responses, and export rows include `ticket_count`, computed from matching `tbltickets.status` values. Record fields are `ticketstatusid` (string), `name`, `isdefault`, `statuscolor`, `statusorder`, and `ticket_count`.

Names are trimmed and limited to 50 characters. Colors accept any text up to 7 characters, including empty string and `null`, matching the Perfex `VARCHAR(7)` column. Order accepts empty or `null` values and whole numbers; fractional values are rejected. Request bodies are strict; generated `ticketstatusid` and `isdefault` are not mass assignable.

Delete refusals use `ERP-TICKETSTATUSES-0002` for built-in statuses, `ERP-TICKETSTATUSES-0001` for ticket references or an unavailable ticket count, and `ERP-TICKETSTATUSES-0003` when the status is the configured default reply status. The setting is parsed as an integer before comparison; non-numeric values do not match a status id. Every failed count refuses deletion with the 409 detail `its use could not be counted`.

## Events published

| Event                            | When                       |
| -------------------------------- | -------------------------- |
| `ticket-statuses.record.created` | After a status is created. |
| `ticket-statuses.record.updated` | After a status is updated. |
| `ticket-statuses.record.deleted` | After a status is deleted. |

## Events subscribed

None.

## Jobs

None.

## Resilience

- **Breaker:** None; the module makes no outbound HTTP calls.
- **Retry policy:** None; database and settings failures are surfaced, and a failed ticket-count check refuses deletion.
- **Pool budget:** Uses the shared Prisma connection pool.

## Layers

| Layer         | Responsibility                                                                            |
| ------------- | ----------------------------------------------------------------------------------------- |
| `controller/` | Guarded HTTP routes and API contracts.                                                    |
| `dto/`        | Strict request and response schemas.                                                      |
| `events/`     | Published domain events; no subscribers.                                                  |
| `facade/`     | Read-only module boundary.                                                                |
| `model/`      | Stored status, write types, and list request/page types.                                  |
| `repository/` | Prisma reads, writes, counts, and keyset pagination.                                      |
| `service/`    | Administrator checks, validation orchestration, delete rules, transformation, and export. |

## How to run its tests

Run the complete ERP API suite from `erp-api`:

```sh
corepack yarn test
```

The focused module suite is:

```sh
corepack yarn vitest run src/v1/ticket-statuses/__tests__
```

The repository integration spec inserts a real ticket when `DATABASE_URL` is configured; otherwise Vitest skips that integration test.
