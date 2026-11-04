# estimate-request-statuses

## Purpose

Administrator-only API for the Estimate Request Statuses Setup screen. API routes are under
`/api/v1/estimate-request-statuses`; the corresponding screen routes are under
`/setup/estimate-request-statuses`.

## Owned tables

- `tblestimate_request_status` is claimed by this module in `prisma/ownership.json`. Prisma writes
  only `name`, `color`, and `statusorder`; `id` is database-generated and `flag` is never writable.
  Perfex remains a co-writer during coexistence.
- `tblestimate_requests.status` and `tblestimate_request_forms.status` are discovered from
  `information_schema.COLUMNS` and read to refuse deleting a referenced status. Missing columns are
  skipped; a probe/count error refuses deletion with `ERP-ESTIMATEREQUESTSTATUSES-0001`.
- The request count returned to the screen counts `tblestimate_requests.status` only.

## Facade surface

- `findById(id)` returns the stored status or `null`.
- `listAll()` returns all statuses with estimate-request counts.

The facade is read-only and has no actor; it does not assert an administrator flag.

## Endpoints

Every endpoint requires authentication and the administrator flag. The controller applies
`JwtAuthGuard` and `PermissionGuard`; the service checks `isAdmin` before parsing or data access.
The three setup screen routes are `ADMIN_GATE`s in `@erp/contracts`.

| Method   | Path                                                     | Success                     | Behavior                                                                             |
| -------- | -------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------ |
| `GET`    | `/api/v1/estimate-request-statuses?limit&cursor&q&sort`  | `200 { data, meta }`        | Keyset list; default sort is `name` ascending, with `id` ascending as a tie-breaker. |
| `GET`    | `/api/v1/estimate-request-statuses/export?format&q&sort` | `200` export                | CSV, XLSX, PDF, or print rows; columns are `id`, `name`, and `total_request`.        |
| `GET`    | `/api/v1/estimate-request-statuses/:id`                  | `200 EstimateRequestStatus` | Read one status; missing ids return `ERP-CORE-0004`.                                 |
| `POST`   | `/api/v1/estimate-request-statuses`                      | `201 EstimateRequestStatus` | Create from `name`, `color`, and `statusorder`.                                      |
| `PATCH`  | `/api/v1/estimate-request-statuses/:id`                  | `200 EstimateRequestStatus` | Update supplied writable fields.                                                     |
| `DELETE` | `/api/v1/estimate-request-statuses/:id`                  | `204`                       | Refuse referenced statuses with `-0001`, then refuse flagged statuses with `-0002`.  |

Responses preserve the web contract: `id` is a string and each record contains `name`, `color`,
`statusorder`, `flag`, and `total_request`. Request bodies are strict; `flag`, `id`, and all other
undeclared fields are rejected. Names are trimmed and limited to 50 characters, colors are limited
to 10 characters, and order accepts a whole number or blank/null (`null` is stored). On create only,
a blank color is stored as `#757575`.

Delete checks both reference columns discovered in `information_schema.COLUMNS`. **Difference:**
Perfex checks only `tblestimate_requests.status`; this API also checks `tblestimate_request_forms.status`.
The reference check runs before the built-in `flag` check, so a referenced flagged status returns
`ERP-ESTIMATEREQUESTSTATUSES-0001`.

## Events published

| Event                                      | When                       | Payload      |
| ------------------------------------------ | -------------------------- | ------------ |
| `estimate-request-statuses.record.created` | After a status is created. | `{ id, at }` |
| `estimate-request-statuses.record.updated` | After a status is updated. | `{ id, at }` |
| `estimate-request-statuses.record.deleted` | After a status is deleted. | `{ id, at }` |

Events are declared in `events/published.ts` and published through the shared domain-event port.
The payload contains the status id and server timestamp.

## Events subscribed

None.

## Jobs

None.

## Resilience

- **Breaker:** None; the module makes no outbound HTTP calls.
- **Retry policy:** None; database errors surface, and failed reference checks refuse deletion.
- **Pool budget:** Uses the shared Prisma connection pool.

## Layers

| Layer         | Responsibility                                                            |
| ------------- | ------------------------------------------------------------------------- |
| `controller/` | Guarded HTTP routes and API contracts.                                    |
| `dto/`        | Strict request and response schemas.                                      |
| `events/`     | Published domain events.                                                  |
| `facade/`     | Read-only module boundary.                                                |
| `model/`      | Stored status and list request/page types.                                |
| `repository/` | Prisma reads/writes, reference probes, counts, and keyset pagination.     |
| `service/`    | Administrator checks, validation orchestration, delete rules, and export. |

## How to run its tests

```sh
corepack yarn vitest run src/v1/estimate-request-statuses/__tests__
```

The focused route-gate drift test is in `route-gates.spec.ts`; the repository integration spec
requires the local API database environment.
