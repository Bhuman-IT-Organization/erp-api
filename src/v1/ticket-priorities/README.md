# ticket-priorities

## Purpose

Manages the setup list of support ticket priorities. It supports listing, reading, creating, updating, and deleting priorities. It replaces the legacy Perfex ticket priority management screen, migrating the backend logic to Node.js with the frontend residing at `/setup/ticket-priorities` in `erp-web` and the API at `api/v1/ticket-priorities`.

## Owned tables

- `tbltickets_priorities`: Claimed in the ownership register and written through Prisma; `name` is the only column Node writes, `priorityid` is assigned by the database.

Read only, never written:

- `tbltickets`: Read during delete operations to ensure the priority is not currently assigned to any tickets (`is_referenced` check).
- `tbloptions`: Read via `SettingsFacade` to prevent deletion if the priority is set as the `email_piping_default_priority`.

## Facade surface

- `findAll()`: all priorities as `{ id, name }`, newest id first.
- `findById(id)`: one priority or `null`.
  **Who uses it:** No module in this copy yet. Other modules import only `src/v1/ticket-priorities/index.ts`.

## Endpoints

Under `api/v1/ticket-priorities` (`TICKET_PRIORITIES_ROUTES` in `ticket-priorities.routes.ts`). Accessible only by authenticated users with administrative permissions (`JwtAuthGuard`, `PermissionGuard`). Every failure is an RFC 9457 problem with an `ERP-*` code.

| Method   | Path  | Success              | Errors beyond the standard ones                                                                                  |
| -------- | ----- | -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `GET`    | ``    | 200 `{ data, meta }` | none                                                                                                             |
| `GET`    | `:id` | 200 the priority     | 404 `ERP-CORE-0004`, 400 `ERP-VALIDATION-0001`                                                                   |
| `POST`   | ``    | 201 the priority     | 400 `ERP-VALIDATION-0001`                                                                                        |
| `PATCH`  | `:id` | 200 the priority     | 404 `ERP-CORE-0004`, 400 `ERP-VALIDATION-0001`                                                                   |
| `DELETE` | `:id` | 204, no body         | 404 `ERP-CORE-0004`, 400 `ERP-VALIDATION-0001`, 409 `ERP-TICKETPRIORITIES-0001`, 409 `ERP-TICKETPRIORITIES-0002` |

## Events published

| Event                              | When                      | Payload                                   |
| ---------------------------------- | ------------------------- | ----------------------------------------- |
| `ticket-priorities.record.created` | after `POST` stores it    | `{ id, at }`, `TicketPrioritiesCreatedV1` |
| `ticket-priorities.record.updated` | after `PATCH` saves it    | `{ id, at }`, `TicketPrioritiesUpdatedV1` |
| `ticket-priorities.record.deleted` | after `DELETE` removes it | `{ id, at }`, `TicketPrioritiesDeletedV1` |

Declared in `events/published.ts` (`TICKET_PRIORITIES_PUBLISHED_EVENTS`), published through `DOMAIN_EVENT_PUBLISHER` from `service/ticket-priorities.transport.ts`. A payload carries the id and the server time, never the name. After each publish the service writes one `LoggerService.log` line, `ticket priority created|updated|deleted` with `{ id }`, which carries `requestId` and `staffId` from the request context (D-08, BE-10).

## Events subscribed

None. Listed in `events/subscribed.ts` (`TICKET_PRIORITIES_SUBSCRIBED_EVENTS`).

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound HTTP, no vendor call.
- **Retry policy:** none on writes: an unkeyed `POST` retried could create two rows, and the events are in-process.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`); one list page costs 1 connection; no extra DB or Redis client.

## Layers

| File                          | Responsibility                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| `ticket-priorities.module.ts` | Wires controllers, services, repositories, and internal modules like `SettingsModule`.    |
| `ticket-priorities.routes.ts` | Defines route path constants (`TICKET_PRIORITIES_ROUTES`).                                |
| `controller/`                 | Handles HTTP requests, Auth/Permission guards, and Zod validation mappings.               |
| `service/`                    | Business logic, usage validation checks, and SettingsFacade lookups.                      |
| `repository/`                 | Executes Prisma queries for `tbltickets_priorities` and reference checks in `tbltickets`. |
| `model/`                      | Database row types and domain models.                                                     |
| `validator/`                  | Zod schemas and types for requests/responses.                                             |
| `events/`                     | Event constants published by the module.                                                  |
| `facade/`                     | Cross-module boundaries and internal API exposure.                                        |
| `index.ts`                    | Module's public entry point and exports.                                                  |
| `__tests__/`                  | Unit tests for the module.                                                                |

## Legacy parity

| Perfex                       | Node                            | Notes                                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup > Support > Priorities | `GET /api/v1/ticket-priorities` | Migrates the full CRUD interface to Node.js APIs. **Email-piping difference:** Node refuses the delete because it never writes `tbloptions`, so choose another default in Settings first. Perfex deletes that priority and clears the setting. |

## How to run its tests

```bash
corepack yarn test src/v1/ticket-priorities
```
