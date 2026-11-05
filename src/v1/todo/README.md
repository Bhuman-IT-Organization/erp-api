# Todo Module

## Purpose

The Todo module provides APIs to create, list, read, update, finish, reopen and delete staff todo items.

Each todo belongs to one staff member. Every authenticated staff member can manage only their own todos. The module scopes all database operations using the authenticated user's `staffId`.

## Owned tables

- `tbltodos`: Todo records are accessed through Prisma's typed delegate in `repository/todo.repository.ts`. The repository reads and writes `todoid`, `description`, `staffid`, `dateadded`, `finished`, `datefinished` and `item_order`.
- Every list, read, update, finish, reopen, delete and unfinished-count query is scoped to the relevant `staffid`.
- New todos are created unfinished. The repository assigns the next `item_order` for the staff member.

## Facade surface

- `describe(): { module: 'todo'; version: 1 }`
- `countUnfinished(staffId: number): Promise<number>`: returns the number of unfinished todos belonging to the specified staff member.

Other modules import `TodoFacade` through `src/v1/todo/index.ts` and `TodoModule`. The facade exposes read-only access; it does not expose create, update or delete operations.

## Endpoints

Base path: `/api/v1/todo`.

All endpoints require authentication. Every authenticated staff member can manage their own todos; there is no administrator-only restriction. The service scopes records by `actor.staffId`.

| Method   | Path           | Success                                     | Description                                  |
| -------- | -------------- | ------------------------------------------- | -------------------------------------------- |
| `GET`    | ``             | 200 `{ data, meta: { nextCursor, total } }` | List todos using the required `status` query |
| `GET`    | `:id`          | 200 todo response                           | Read one of the caller's todos               |
| `POST`   | ``             | 201 todo response                           | Create a todo                                |
| `PATCH`  | `:id`          | 200 todo response                           | Update the description                       |
| `PATCH`  | `:id/finished` | 200 todo response                           | Finish or reopen a todo                      |
| `DELETE` | `:id`          | 204, no body                                | Delete a todo                                |

List query parameters:

- `status`: required; `unfinished` or `finished`.
- `limit`: optional page size; defaults to `1`, within the shared pagination limits.
- `cursor`: optional opaque pagination cursor. An invalid cursor returns `400 ERP-VALIDATION-0001`.

Request bodies:

- `POST`: `{ "description": "Complete the assigned task" }`
- `PATCH :id`: `{ "description": "Updated task description" }`
- `PATCH :id/finished`: `{ "finished": true }` or `{ "finished": false }`

Create and update bodies are strict. Additional properties such as `staffid` or `finished` are rejected. Description is trimmed and must contain 1 to 10,000 characters.

The response contains `id`, `description`, `finished`, `dateAdded` and `dateFinished`. The list response contains `data` and `meta` with `nextCursor` and `total`.

A missing todo and a todo owned by another staff member both return `404 ERP-CORE-0004`. Invalid input returns `400 ERP-VALIDATION-0001`. Authentication is required.

## Events published

| Event                 | When                                         | Payload                                |
| --------------------- | -------------------------------------------- | -------------------------------------- |
| `todo.record.created` | after a todo is created                      | `{ id, staffId, at }`, `TodoCreatedV1` |
| `todo.record.updated` | after a todo is edited, finished or reopened | `{ id, staffId, at }`, `TodoUpdatedV1` |
| `todo.record.deleted` | after a todo is deleted                      | `{ id, staffId, at }`, `TodoDeletedV1` |

Declared in `events/published.ts` (`TODO_PUBLISHED_EVENTS`) and published through `DOMAIN_EVENT_PUBLISHER` from `service/todo.transport.ts`. Events carry the todo id, staff id and server timestamp.

After publishing, the service writes a log entry for the corresponding create, update, finish, reopen or delete operation.

## Events subscribed

None. The module has no subscribed domain events.

## Jobs

None. The module does not define background jobs.

## Resilience

- **Breaker:** none: no outbound HTTP or vendor calls; domain events use the in-process publisher.
- **Retry policy:** none on writes: retrying an unkeyed create could create duplicate todos; event publishing is an in-process call.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`, asserted by `check:db`); todo reads and writes use the shared Prisma client, with no extra DB or Redis client.

## Layers

| File                            | Responsibility                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `todo.module.ts`                | Registers Todo providers and controller; imports SettingsModule and exports TodoFacade             |
| `todo.routes.ts`                | Defines the base, list, record and finished route constants                                        |
| `controller/todo.controller.ts` | Authenticated HTTP handlers for list, read, create, update, finish/reopen and delete               |
| `service/todo.service.ts`       | Use cases, staff scoping, validation orchestration, event publishing and logging                   |
| `service/todo.validator.ts`     | Validates list query, params, create, update and finish request bodies                             |
| `service/todo.transformer.ts`   | Converts repository records into response DTOs and handles company timezone conversion             |
| `service/todo.transport.ts`     | Publishes domain events and retrieves the company timezone through SettingsFacade                  |
| `repository/todo.repository.ts` | Prisma operations for listing, finding, creating, updating, finishing, deleting and counting todos |
| `repository/todo.cursor.ts`     | Encodes and decodes todo pagination cursors and builds cursor conditions                           |
| `model/todo.model.ts`           | Todo row, create input, status, list request and page types                                        |
| `dto/todo.dto.ts`               | Request and response schemas, validation limits and DTO types                                      |
| `events/published.ts`           | TodoCreatedV1, TodoUpdatedV1 and TodoDeletedV1 event definitions                                   |
| `events/subscribed.ts`          | Subscribed event definitions                                                                       |
| `facade/todo.facade.ts`         | Public module-to-module read surface                                                               |
| `index.ts`                      | Public module exports                                                                              |
| `__tests__/`                    | Unit, controller, transport and repository integration specs                                       |

## Legacy parity

The module provides the staff Todo functionality through the new `/api/v1/todo` API.

- Staff members can view and manage their own todo records.
- Creating, editing, finishing, reopening and deleting todos are supported.
- Todos belonging to another staff member cannot be accessed or modified.
- The completion timestamp is set when a todo is finished and cleared when it is reopened.
- Todo ordering is maintained using `item_order` and `todoid`.
- Pagination uses an opaque cursor and the requested status.

## How to run its tests

```bash
corepack yarn test src/v1/todo
```

Run the individual specs:

```bash
corepack yarn test src/v1/todo/__tests__/todo.controller.spec.ts
corepack yarn test src/v1/todo/__tests__/todo.service.spec.ts
corepack yarn test src/v1/todo/__tests__/todo.repository.spec.ts
corepack yarn test src/v1/todo/__tests__/todo.validator.spec.ts
corepack yarn test src/v1/todo/__tests__/todo.transformer.spec.ts
corepack yarn test src/v1/todo/__tests__/todo.facade.spec.ts
```
