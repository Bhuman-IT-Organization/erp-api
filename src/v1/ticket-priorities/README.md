# ticket-priorities

## Purpose

Manages the setup list of support ticket priorities. It supports listing, reading, creating, updating, and deleting priorities. It replaces the legacy Perfex ticket priority management screen, migrating the backend logic to Node.js with the frontend residing at `/setup/ticket-priorities` in `erp-web` and the API at `api/v1/ticket-priorities`.

## Owned tables

- `tbltickets_priorities`: Claimed in the ownership register and written through Prisma; `name` is the only column Node writes, `priorityid` is assigned by the database.

Read only, never written:

- `tbltickets`: Read during delete operations to ensure the priority is not currently assigned to any tickets (`is_referenced` check).
- `tbloptions`: Read via `SettingsFacade` to prevent deletion if the priority is set as the `email_piping_default_priority`.

## Facade surface

- `describe(): { module: 'ticket-priorities'; version: 1 }`
- `getPriority(id: number): Promise<{ id: number; name: string } | null>`

**Who uses it:** No module in this copy yet. Other modules import only `src/v1/ticket-priorities/index.ts`.

## Endpoints

Under `api/v1/ticket-priorities` (`TICKET_PRIORITIES_ROUTES` in `ticket-priorities.routes.ts`). Accessible only by authenticated users with administrative permissions (`JwtAuthGuard`, `PermissionGuard`). Every failure is an RFC 9457 problem with an `ERP-*` code.

| Method   | Path  | Success              | Errors beyond the standard ones                                                  |
| -------- | ----- | -------------------- | -------------------------------------------------------------------------------- |
| `GET`    | ``    | 200 `{ data, meta }` | none                                                                             |
| `GET`    | `:id` | 200 the priority     | 404 `ERP-CORE-0004`                                                              |
| `POST`   | ``    | 201 the priority     | none                                                                             |
| `PATCH`  | `:id` | 200 the priority     | 404 `ERP-CORE-0004`                                                              |
| `DELETE` | `:id` | 204, no body         | 404 `ERP-CORE-0004`, 400 `ERP-VALIDATION-0001` (if referenced or set as default) |

## Events published

| Event                              | When                      | Payload      |
| ---------------------------------- | ------------------------- | ------------ |
| `ticket-priorities.record.created` | after `POST` stores it    | `{ id, at }` |
| `ticket-priorities.record.updated` | after `PATCH` saves it    | `{ id, at }` |
| `ticket-priorities.record.deleted` | after `DELETE` removes it | `{ id, at }` |

## Events subscribed

None.

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
| `dto/`                        | Zod schemas and types for requests/responses.                                             |
| `events/`                     | Event constants published by the module.                                                  |
| `facade/`                     | Cross-module boundaries and internal API exposure.                                        |
| `index.ts`                    | Module's public entry point and exports.                                                  |
| `__tests__/`                  | Unit tests for the module.                                                                |

## Legacy parity

| Perfex                       | Node                            | Notes                                             |
| ---------------------------- | ------------------------------- | ------------------------------------------------- |
| Setup > Support > Priorities | `GET /api/v1/ticket-priorities` | Migrates the full CRUD interface to Node.js APIs. |

## How to run its tests

```bash
corepack yarn test src/v1/ticket-priorities
```
