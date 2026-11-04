# Lead sources

## Purpose

This module provides the administrator API for the lead-source list: list, read, create, rename,
delete and export. The API is under `/api/v1/lead-sources`; the setup pages live in erp-web under
`/setup/lead-sources`. Perfex's quick-add remains on the Perfex lead screen.

## Owned tables

Node owns `tblleads_sources` and writes only its `name` column (`VARCHAR(150)`); the database
assigns `id`. The ownership register records that this table is written by `v1/lead-sources`.
Perfex's lead-source delete route is closed at Nginx; the separate quick-add workflow remains on
Perfex.

Before returning usage or deleting a source, the repository discovers which of these references
exist in the connected schema, then counts matching IDs in each present table:

| Table                        | Column        | Count represented by      |
| :--------------------------- | :------------ | :------------------------ |
| `tblleads`                   | `source`      | `usage.leads`             |
| `tblleads_email_integration` | `lead_source` | `usage.emailIntegrations` |
| `tblweb_to_lead`             | `lead_source` | `usage.webToLeadForms`    |

Each reference has its own usage response field. The `totalLeads` export column counts leads only
(`usage.leads`), matching the list's lead count.
The discovered table and column names are selected from this fixed list; IDs are bound query
parameters. A missing reference column contributes zero. If any probe or count fails during delete,
the delete is refused with HTTP 409 rather than allowing an unverified delete.

The delete also refuses the source selected by the `leads_default_source` option. The option is read
through `SettingsFacade`; this module does not read or write `tbloptions` directly.

## Facade surface

`LeadSourcesFacade` is the module-to-module read surface: `describe`, `findById`, `listAll` and
`findByIds`. It exposes `{ id, name }` lead sources, not HTTP DTOs, and performs no writes.

## Endpoints

All endpoints are administrator-only.

| Method   | Path                          | Success                                                                                             | Relevant errors                                                 |
| :------- | :---------------------------- | :-------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| `GET`    | `/api/v1/lead-sources`        | Paginated `{ data, meta }`; each row includes `usage: { leads, emailIntegrations, webToLeadForms }` | 400 invalid query                                               |
| `GET`    | `/api/v1/lead-sources/:id`    | `{ id, name, usage: { leads, emailIntegrations, webToLeadForms } }`                                 | 404 missing source                                              |
| `POST`   | `/api/v1/lead-sources`        | 201 with the new source                                                                             | 400 invalid body                                                |
| `PATCH`  | `/api/v1/lead-sources/:id`    | 200 with the renamed source                                                                         | 400 invalid body; 404 missing source                            |
| `DELETE` | `/api/v1/lead-sources/:id`    | 204, no body                                                                                        | 404 missing source; 409 default or in use / safety check failed |
| `GET`    | `/api/v1/lead-sources/export` | CSV, Excel, PDF, or print rows                                                                      | 400 invalid export options                                      |

The list defaults to `name` ascending, with `id` as the tie-breaker. It also accepts `sort=name`,
`sort=-name`, `sort=id` and `sort=-id`; `q` searches the name and an all-digit query up to
`2147483647` can also match the ID. Create and update bodies are strict `{ name }` objects; names
are trimmed and limited to 150 characters. Duplicate names are allowed.

## Legacy parity

| Perfex (`application/controllers/admin/Leads.php`) | Node behavior                                                                                                                   |
| :------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| `Leads::sources` lists lead sources                | `GET /api/v1/lead-sources` returns the paginated list and usage counts.                                                         |
| `Leads::source` adds a source                      | `POST /api/v1/lead-sources` creates a source.                                                                                   |
| `Leads::source` edits a source                     | `PATCH /api/v1/lead-sources/:id` renames a source.                                                                              |
| `Leads::delete_source` deletes a source            | `DELETE /api/v1/lead-sources/:id` refuses with 409 while any supported reference uses it or while it is the configured default. |

Perfex checks lead and email-integration references and clears the default-source option after
deletion. Node also counts web-to-lead-form references and refuses to delete the configured default
source, preserving the setting and requiring an administrator to change it first.

## Events published

| Event                         | When                              | Payload      |
| :---------------------------- | :-------------------------------- | :----------- |
| `lead-sources.record.created` | after `POST` stores the source    | `{ id, at }` |
| `lead-sources.record.updated` | after `PATCH` saves the source    | `{ id, at }` |
| `lead-sources.record.deleted` | after `DELETE` removes the source | `{ id, at }` |

Events are published through `DOMAIN_EVENT_PUBLISHER`; the service logs one line after each
published event.

## Events subscribed

None.

## Jobs

None.

## Resilience

- **Breaker:** none; there is no outbound HTTP or vendor call.
- **Retry policy:** none on writes; retrying an unkeyed `POST` could create duplicate sources.
- **Pool budget:** a list page reads the page, its two counts, the schema probe, up to three
  reference counts and the default-source setting on delete; no additional DB or Redis client.

## Layers

| Area                                | Responsibility                                                          |
| :---------------------------------- | :---------------------------------------------------------------------- |
| `lead-sources.module.ts`            | Wires the providers and imports `SettingsModule`; exports the facade    |
| `controller/`                       | Administrator-only HTTP routes and documented error codes               |
| `service/`                          | Use cases, default-source and usage delete refusals, events and logging |
| `repository/`                       | Prisma access and discovery/counting of all three reference tables      |
| `dto/`, `model/`                    | Existing wire response shape and domain types                           |
| `service/lead-sources.transport.ts` | Domain-event publisher and `SettingsFacade` seam                        |
| `facade/`, `index.ts`               | Read-only module-to-module API                                          |

## How to run its tests

```powershell
corepack yarn test src/v1/lead-sources
corepack yarn test:int src/v1/lead-sources
```
