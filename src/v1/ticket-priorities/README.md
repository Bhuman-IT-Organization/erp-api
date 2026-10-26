# ticket-priorities

## Purpose

<One paragraph: the Setup list of ticket priorities, which operations it has (list, read, create, update, delete), what it replaces in Perfex, where the screens and the api live (`/setup/ticket-priorities` in erp-web, `api/v1/ticket-priorities`).>

## Owned tables

- `tbltickets_priorities`: <how it is claimed in the ownership register and written through Prisma; `name` is the only column Node writes, `priorityid` is assigned by the database>.

Read only, never written:

- <any table the delete check reads, for example the tickets that use a priority, or "none">.

## Facade surface

- `describe(): { module: 'ticket-priorities'; version: 1 }`
- <one line per facade method, copied from `facade/ticket-priorities.facade.ts`>

**Who uses it:** <which modules, or "no module in this copy yet">. Other modules import only `src/v1/ticket-priorities/index.ts`.

## Endpoints

Under `api/v1/ticket-priorities` (`TICKET_PRIORITIES_ROUTES` in `ticket-priorities.routes.ts`). <Who may call them: administrators only, or which permission codes.> Every failure is an RFC 9457 problem with an `ERP-*` code.

| Method   | Path  | Success              | Errors beyond the standard ones |
| -------- | ----- | -------------------- | ------------------------------- |
| `GET`    | ``    | 200 `{ data, meta }` | none                            |
| `GET`    | `:id` | 200 the priority     | 404 `ERP-CORE-0004`             |
| `POST`   | ``    | 201 the priority     | <409 duplicate name, if any>    |
| `PATCH`  | `:id` | 200 the priority     | 404 `ERP-CORE-0004`             |
| `DELETE` | `:id` | 204, no body         | 404 `ERP-CORE-0004`             |

## Events published

| Event                              | When                      | Payload      |
| ---------------------------------- | ------------------------- | ------------ |
| `ticket-priorities.record.created` | after `POST` stores it    | `{ id, at }` |
| `ticket-priorities.record.updated` | after `PATCH` saves it    | `{ id, at }` |
| `ticket-priorities.record.deleted` | after `DELETE` removes it | `{ id, at }` |

<Use the exact event names from `events/published.ts`.>

## Events subscribed

None.

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound HTTP, no vendor call.
- **Retry policy:** none on writes: an unkeyed `POST` retried could create two rows, and the events are in-process.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`); <what one list page costs>; no extra DB or Redis client.

## Layers

| File                                                                                                                            | Responsibility              |
| ------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| `ticket-priorities.module.ts`                                                                                                   | <...>                       |
| `ticket-priorities.routes.ts`                                                                                                   | <...>                       |
| `controller/...`, `service/...`, `repository/...`, `model/...`, `dto/...`, `events/...`, `facade/...`, `index.ts`, `__tests__/` | <one row each, as in taxes> |

## Legacy parity

| Perfex                              | Node                            | Notes |
| ----------------------------------- | ------------------------------- | ----- |
| <Perfex's ticket priorities screen> | `GET /api/v1/ticket-priorities` | <...> |

## How to run its tests

```bash
corepack yarn test src/v1/ticket-priorities
```
