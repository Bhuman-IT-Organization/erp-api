# announcements

## Purpose

Announcements is the Perfex `Utilities > Announcements` screen, migrated: the list at
`/setup/announcements`, the create form at `/setup/announcements/new` and the edit form at
`/setup/announcements/:id`, backed by Perfex's own `tblannouncements` table through
`src/v1/announcements`.

The Node screens and API handlers are administrators-only. Perfex's `Announcements.php::index()`
has no admin check; only its menu item, the form and delete are admin-only. The three routes
are marked `'admin'` in `@erp/contracts`' `ROUTE_GATES`; the menu item reads the same gate through
`navGateOf`, and the screens sit behind
`withAuth(withPermission(...))`: a non-administrator sees the kit's "no access" state once `/me`
has answered, and the screen asks the api for nothing. The page gate is presentation only: the api
refuses every handler to anyone but an administrator with 403 `ERP-AUTH-0005` regardless.

## Owned tables

| Table              | Columns used                                                                                         | Notes                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `tblannouncements` | `announcementid`, `name`, `message`, `dateadded`, `showtousers`, `showtostaff`, `showname`, `userid` | Switches are booleans on the wire and 0/1 in Perfex; `userid` stores the actor's full name, resolved through Identity |

`tbldismissed_announcements` stays owned by perfex-core (ADR-0029); Node does not otherwise read or
write it. **Difference.** Perfex's delete also removes the matching dismissal rows; Node's delete does
not. _Why:_ Node's announcement repository deliberately owns and deletes only `tblannouncements`.

## Facade surface

`facade/announcements.facade.ts` is the only surface other modules may import (ADR-0001),
re-exported from `index.ts` as `AnnouncementsFacade`. It is read-only and asserts no administrator
flag, because a module-to-module read has no actor.

| Method           | Returns                                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `describe()`     | The module's description                                                                   |
| `findById(id)`   | One `Announcement`, or `null` when the id is missing                                       |
| `listAll()`      | Every announcement, date descending then id; refused above `ANNOUNCEMENTS_FACADE_MAX_ROWS` |
| `findByIds(ids)` | The announcements with these ids, in the order given, each once; an absent id is skipped   |

## Endpoints

All six handlers sit behind `JwtAuthGuard` and `PermissionGuard`, and every one is administrators
only.

| Method   | Path                           | Purpose                                           |
| -------- | ------------------------------ | ------------------------------------------------- |
| `GET`    | `/api/v1/announcements`        | The list: search, sort and paging                 |
| `GET`    | `/api/v1/announcements/export` | The export rows (CSV, Excel, PDF, Print)          |
| `GET`    | `/api/v1/announcements/:id`    | One announcement                                  |
| `POST`   | `/api/v1/announcements`        | Create (stores the actor's full name in `userid`) |
| `PATCH`  | `/api/v1/announcements/:id`    | Update                                            |
| `DELETE` | `/api/v1/announcements/:id`    | Delete (204)                                      |

## Events published

| Event                          | When                      | Payload                                |
| ------------------------------ | ------------------------- | -------------------------------------- |
| `announcements.record.created` | after `POST` stores it    | `{ id, at }`, `AnnouncementsCreatedV1` |
| `announcements.record.updated` | after `PATCH` saves it    | `{ id, at }`, `AnnouncementsUpdatedV1` |
| `announcements.record.deleted` | after `DELETE` removes it | `{ id, at }`, `AnnouncementsDeletedV1` |

Declared in `events/published.ts` and published through `DOMAIN_EVENT_PUBLISHER` from
`service/announcements.transport.ts`. A payload carries the id and the server time, never the
name. After each publish the service writes one `LoggerService.log` line (D-18).

## Events subscribed

None. Listed in `events/subscribed.ts`.

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound HTTP, no vendor call.
- **Retry policy:** none on writes: an unkeyed `POST` retried could create two rows, and the events are in-process.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`, asserted by `check:db`); no extra DB or Redis client.

## Layers

| File                                          | Responsibility                                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `announcements.module.ts`                     | Wires every layer as a provider; exports `AnnouncementsFacade` only; not global                                                                                              |
| `announcements.routes.ts`                     | `ANNOUNCEMENTS_ROUTES` (`base`, `list`, `export`, `record`), `ANNOUNCEMENTS_EXPORT_COLUMNS` (`id`, `name`, `dateadded`), `ANNOUNCEMENTS_EXPORT_FILE_STEM`; no permission map |
| `controller/announcements.controller.ts`      | The six handlers, each behind `JwtAuthGuard` and `PermissionGuard`                                                                                                           |
| `service/announcements.service.ts`            | The administrator check, the business rules, the event after a write, then the `log` line                                                                                    |
| `service/announcements.validator.ts`          | Parses the list query, export query, params and bodies                                                                                                                       |
| `service/announcements-html.ts`               | Converts and validates announcement HTML content                                                                                                                             |
| `service/announcements-zone.ts`               | Converts between company-zone wall-clock values and instants, matching Perfex date handling                                                                                  |
| `service/announcements.transformer.ts`        | Maps rows to responses and export rows                                                                                                                                       |
| `service/announcements.transport.ts`          | Identity name lookup and domain events to the publisher port                                                                                                                 |
| `repository/announcements.repository.ts`      | The only Prisma caller                                                                                                                                                       |
| `model/announcements.model.ts`                | Row, request and page types                                                                                                                                                  |
| `dto/announcements.dto.ts`                    | The request and response schemas                                                                                                                                             |
| `events/published.ts`, `events/subscribed.ts` | The three published event types / none                                                                                                                                       |
| `facade/announcements.facade.ts`              | The only surface other modules may import; read only                                                                                                                         |
| `index.ts`                                    | Public re-exports                                                                                                                                                            |
| `__tests__/`                                  | One spec per layer                                                                                                                                                           |

## Legacy parity

Flow parity (FE-18, D-29): someone who used the Perfex screen does the same job in the same order,
with the same business outcome.

| Perfex announcements screen (`admin/announcements`, `controllers/admin/Announcements.php`) | Node step                                                                                                      |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| the list: Name, Date Added; search; paging                                                 | the same list and pager; **Difference.** search is by name or id, not date, and the export also includes ID    |
| Add Announcement opens the create form (name required, message, switches)                  | `/setup/announcements/new`: same fields > Create > save returns to the list; **Difference.** not the view page |
| Edit prefills the same fields; Save updates                                                | `/:id` prefilled > Save > saved and returned to the list; **Difference.** not the view page                    |
| Delete asks in the browser then removes                                                    | Confirmation sends DELETE; **Difference.** dismissal rows are not removed                                      |
| Export buttons over the table                                                              | the kit's Export menu: CSV, Excel, PDF or Print of Id, Name, Date Added                                        |

### Differences

- Non-admin staff who enter `/admin/announcements` do not get the Node list; the dashboard tab still works for them. **Difference.** _Why:_ the migrated management screen is administrator-only, while Perfex's `index()` has no admin check.
- Perfex's delete also removes the matching dismissal rows (`Announcements_model.php:152-154`), but Node's delete does not. **Difference.** _Why:_ `tbldismissed_announcements` remains owned by perfex-core.
- The Node export includes an ID column; Perfex's visible list/export columns are Name and Date only. **Difference.** _Why:_ the shared export includes the record id so exported rows can be matched to records.
- Search covers name and ID, not date. **Difference.** _Why:_ the Node list query supports name substring and numeric id matching only.
- Saving returns to the Node list rather than Perfex's view page. **Difference.** _Why:_ the view page remains on Perfex, so the migrated flow uses the list as its landing page.
- The message is trimmed before storage. **Difference.** _Why:_ the API's Zod body schema trims the message.
- Perfex's activity-log line is replaced by the domain event and service log line (D-18). **Difference.** _Why:_ Node publishes the module event and logs the write rather than creating a Perfex activity-log row.

### Dropped on purpose

- View and Dismiss actions remain on Perfex. _Why:_ dashboard dismissal state is owned by perfex-core and only Perfex implements per-user dismissal.
- Perfex's TinyMCE editor remains on Perfex; Node uses a plain text field. _Why:_ this wave stores and renders the message as text, not markup.

## How to run its tests

```bash
corepack yarn test src/v1/announcements          # unit specs, the gates and the in-process controller e2e spec (no network, no database)
corepack yarn test:int src/v1/announcements      # the repository against the local stack (node ../erp-infra/scripts/local-up.mjs first)
```
