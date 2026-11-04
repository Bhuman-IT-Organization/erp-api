# Lead statuses

## Purpose

This module provides the administrator API for the lead-status list: list, read, create, edit,
delete and export. The API is under `/api/v1/lead-statuses`; the setup pages live in erp-web under
`/setup/lead-statuses`. Perfex's quick add and the leads kanban keep writing statuses (see
[Legacy parity](#legacy-parity)).

## Owned tables

Node owns `tblleads_status`; the ownership register records that it is written by
`v1/lead-statuses`. Node writes `name` (`VARCHAR(50)`), `color` (`VARCHAR(10)`, database default
`#28B8DA`) and `statusorder` (nullable `INT`); the database assigns `id`. `isdefault` marks the
built-in Customer status: Node creates every status with `isdefault = 0` and never accepts the flag
in a request body.

Before returning usage or deleting a status, the repository counts every reference to it. The two
optional columns are probed in `information_schema` first; a missing column counts zero:

| Table                        | Column             | Present | Count represented by     |
| :--------------------------- | :----------------- | :------ | :----------------------- |
| `tblleads`                   | `status`           | always  | `usage.leads`            |
| `tblleads`                   | `last_lead_status` | probed  | `usage.lastLeadStatus`   |
| `tblleads_email_integration` | `lead_status`      | always  | `usage.emailIntegration` |
| `tblweb_to_lead`             | `lead_status`      | probed  | `usage.webToLead`        |

IDs are bound query parameters. If any probe or count fails, the request is refused with
`ERP-LEADSTATUSES-0004` (409) rather than allowing an unverified delete.

The `leads_default_status` option is read through `SettingsFacade` (it is on the settings
allow-list); this module does not read or write `tbloptions` directly. The value is cast like PHP's
`(int)`, and only a value above 0 counts as the configured default.

## Facade surface

`LeadStatusesFacade` is the module-to-module read surface: `describe`, `findById`, `listAll` and
`findByIds`. It exposes `{ id, name, statusorder, color, isdefault }` lead statuses, not HTTP DTOs,
and performs no writes. `listAll` returns the statuses in `statusorder` order and refuses with
`ERP-INTERNAL-0001` above 1000 rows.

## Endpoints

All endpoints are administrator-only (`ERP-AUTH-0005` for anyone else).

| Method   | Path                           | Success                                                                          | Relevant errors                                |
| :------- | :----------------------------- | :------------------------------------------------------------------------------- | :--------------------------------------------- |
| `GET`    | `/api/v1/lead-statuses`        | Paginated `{ data, meta }`; each row includes `usage` and `isConfiguredDefault`  | 400 invalid query                              |
| `GET`    | `/api/v1/lead-statuses/:id`    | `{ id, name, statusorder, color, isdefault, usage, isConfiguredDefault }`        | 400 invalid id; 404 missing status             |
| `POST`   | `/api/v1/lead-statuses`        | 201 with the new status                                                          | 400 invalid body                               |
| `PATCH`  | `/api/v1/lead-statuses/:id`    | 200 with the saved status                                                        | 400 invalid body; 404 missing status           |
| `DELETE` | `/api/v1/lead-statuses/:id`    | 204, no body                                                                     | 404 missing status; 409 see the refusals below |
| `GET`    | `/api/v1/lead-statuses/export` | CSV, Excel, PDF or print rows: `id`, `name`, `statusorder`, `color`, `isdefault` | 400 invalid export options                     |

`usage` is `{ leads, lastLeadStatus, emailIntegration, webToLead }`.

The list defaults to `name` ascending, with `id` as the tie-breaker. It also accepts `sort=name`,
`sort=-name`, `sort=id` and `sort=-id`; `q` (at most 100 characters) searches the name, and an
all-digit `q` up to 2147483647 also matches the ID.

Create and update take a strict `{ name, color?, statusorder? }` body:

- `name` is trimmed, required, and at most 50 characters.
- `color` is trimmed, any text up to 10 characters (the kanban saves its colour unvalidated), or `null`.
  Create saves an empty or omitted colour as `#757575`, like Perfex's `add_status`; update saves
  what was sent.
- `statusorder` is any whole number in MySQL `INT` range, or `null`. Create sets an omitted order to
  the number of statuses plus one, like Perfex.

The delete refusals, checked in this order:

| Code                    | When                                                                  |
| :---------------------- | :-------------------------------------------------------------------- |
| `ERP-LEADSTATUSES-0002` | the status is the built-in Customer status (`isdefault = 1`)          |
| `ERP-LEADSTATUSES-0003` | the status is the configured `leads_default_status`                   |
| `ERP-LEADSTATUSES-0004` | its use could not be counted                                          |
| `ERP-LEADSTATUSES-0001` | any of the four references above uses it; the detail names each count |

## Legacy parity

| Perfex (`application/controllers/admin/Leads.php`)     | Node behavior                                                          |
| :----------------------------------------------------- | :--------------------------------------------------------------------- |
| `Leads::statuses` lists statuses (`is_admin()`)        | `GET /api/v1/lead-statuses` returns the paginated list with usage.     |
| `Leads::status` adds or edits a status                 | `POST` and `PATCH /api/v1/lead-statuses` create and edit a status.     |
| `Leads::delete_status` deletes a status (`is_admin()`) | `DELETE /api/v1/lead-statuses/:id`; Perfex's route is closed at Nginx. |

Perfex's delete checks only `tblleads.status` and `tblleads_email_integration.lead_status`, and
clears `leads_default_status` after deleting the default. Node also counts `last_lead_status` and
Web-to-Lead forms, refuses the built-in Customer status, and refuses the configured default so the
setting stays valid until an administrator changes it.

These Perfex paths still write `tblleads_status` and stay on Perfex:

- `Leads::status`, the quick add on the lead form (`/admin/leads/status`); open to non-admins when
  `staff_members_create_inline_lead_status` is on.
- `Leads::update_status_order`, the kanban's drag-and-drop column order.
- `Leads::change_status_color`, the kanban's colour picker.

## Events published

| Event                          | When                              | Payload      |
| :----------------------------- | :-------------------------------- | :----------- |
| `lead-statuses.record.created` | after `POST` stores the status    | `{ id, at }` |
| `lead-statuses.record.updated` | after `PATCH` saves the status    | `{ id, at }` |
| `lead-statuses.record.deleted` | after `DELETE` removes the status | `{ id, at }` |

Events are published through `DOMAIN_EVENT_PUBLISHER`; the service logs one line after each
published event.

## Events subscribed

None.

## Jobs

None.

## Resilience

- **Breaker:** none; there is no outbound HTTP or vendor call.
- **Retry policy:** none on writes; retrying an unkeyed `POST` could create duplicate statuses.
- **Pool budget:** a list page reads the page, its two counts, the two column probes, up to four
  reference counts and the default-status setting; no additional DB or Redis client.

## Layers

| Area                                 | Responsibility                                                       |
| :----------------------------------- | :------------------------------------------------------------------- |
| `lead-statuses.module.ts`            | Wires the providers and imports `SettingsModule`; exports the facade |
| `controller/`                        | Administrator-only HTTP routes and documented error codes            |
| `service/`                           | Use cases, the delete refusals, events and logging                   |
| `service/lead-statuses.validator.ts` | Query, path and body parsing                                         |
| `repository/`                        | Prisma access and the probing and counting of all four references    |
| `dto/`, `model/`                     | Wire shapes and domain types                                         |
| `service/lead-statuses.transport.ts` | Domain-event publisher and `SettingsFacade` seam                     |
| `facade/`, `index.ts`                | Read-only module-to-module API                                       |

## How to run its tests

```powershell
corepack yarn test src/v1/lead-statuses
corepack yarn test:int src/v1/lead-statuses
```
