# fixed-equipment-depreciations

## Purpose

Manages the Fixed Equipment depreciation settings: the list of depreciation terms (a name and a number of months) that assets and asset models refer to. It replaces Perfex's Fixed Equipment → Settings → Depreciations tab (`admin/fixed_equipment/settings?tab=depreciations`), with the screen at `/setup/fixed-equipment-depreciations` in `erp-web` and the API at `api/v1/fixed-equipment-depreciations`.

## Owned tables

- `tblfe_depreciations`: claimed in the ownership register and written through Prisma. Node writes `name`, `term` and, on create, `creator_id` (the signed-in member); `id` and `date_creator` are set by the database. An edit changes `name` and `term` only.

## Facade surface

- `findAll()`: every depreciation as `{ id, name, term, creatorId }`, by name ascending.
- `findById(id)`: one depreciation or `null`, whoever created it.
  **Who uses it:** No module in this copy yet. Other modules import only `src/v1/fixed-equipment-depreciations/index.ts`.

## Endpoints

Under `api/v1/fixed-equipment-depreciations` (`FIXED_EQUIPMENT_DEPRECIATIONS_ROUTES` in `fixed-equipment-depreciations.routes.ts`). Every handler carries `JwtAuthGuard` and `PermissionGuard` and declares its codes from `PERMISSIONS.fixedEquipment.settingDepreciation` (mapped from Perfex's `fixed_equipment_setting_depreciation`): no bearer is 401 `ERP-AUTH-0004`, a missing code 403 `ERP-AUTH-0005`. The reads admit `view` (every row) or `viewOwn` (only the rows the member created). Every failure is an RFC 9457 problem with an `ERP-*` code.

| Method                     | Path                                                                 | Code            | Success                                                                     | Errors beyond the standard ones                |
| -------------------------- | -------------------------------------------------------------------- | --------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| `GET`                      | ``                                                                   | view or viewOwn | 200 `{ data, meta }`                                                        | 400 `ERP-VALIDATION-0001`                      |
| `GET`                      | `export`                                                             | view or viewOwn | 200 the file (`csv`, `xlsx`, `pdf`) or `print` rows of `id`, `name`, `term` | 400 `ERP-VALIDATION-0001`                      |
| `GET`                      | `:id`                                                                | view or viewOwn | 200 the depreciation                                                        | 404 `ERP-CORE-0004`, 400 `ERP-VALIDATION-0001` |
| `POST`                     | ``                                                                   | create          | 201 the depreciation                                                        | 400 `ERP-VALIDATION-0001`                      |
| `PATCH`                    | `:id`                                                                | edit            | 200 the depreciation                                                        | 404 `ERP-CORE-0004`, 400 `ERP-VALIDATION-0001` |
| `DELETE`                   | `:id`                                                                | delete          | 204, no body                                                                | 404 `ERP-CORE-0004`, 400 `ERP-VALIDATION-0001` |
| `ERP-FEDEPRECIATIONS-0001` | 409: an asset model or an asset uses it; the detail names each count |
| `ERP-FEDEPRECIATIONS-0002` | 409: its use could not be counted                                    |

Under `viewOwn`, another member's row is the same 404 as a missing one.

## Events published

| Event                                          | When                      | Payload                                              |
| ---------------------------------------------- | ------------------------- | ---------------------------------------------------- |
| `fixed-equipment-depreciations.record.created` | after `POST` stores it    | `{ id, at }`, `FixedEquipmentDepreciationsCreatedV1` |
| `fixed-equipment-depreciations.record.updated` | after `PATCH` saves it    | `{ id, at }`, `FixedEquipmentDepreciationsUpdatedV1` |
| `fixed-equipment-depreciations.record.deleted` | after `DELETE` removes it | `{ id, at }`, `FixedEquipmentDepreciationsDeletedV1` |

Declared in `events/published.ts` (`FIXED_EQUIPMENT_DEPRECIATIONS_PUBLISHED_EVENTS`), published through `DOMAIN_EVENT_PUBLISHER` from `service/fixed-equipment-depreciations.transport.ts`. A payload carries the id and the server time, never the name. After each publish the service writes one `LoggerService.log` line, `depreciation created|updated|deleted` with `{ id }`.

## Events subscribed

None. Listed in `events/subscribed.ts` (`FIXED_EQUIPMENT_DEPRECIATIONS_SUBSCRIBED_EVENTS`, empty).

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound HTTP, no vendor call.
- **Retry policy:** none on writes: an unkeyed `POST` retried could create two rows, and the events are in-process.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`); One list page costs three queries: the page itself and two counts (the total, and the rows before the page for the range start).

## Layers

| File                                      | Responsibility                                                                                                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fixed-equipment-depreciations.module.ts` | Wires the controller, the service and its parts, and the repository.                                                                                                                                     |
| `fixed-equipment-depreciations.routes.ts` | The route constants, the permission codes and the export columns.                                                                                                                                        |
| `controller/`                             | The HTTP handlers: guards, permission codes, the row scope; no logic.                                                                                                                                    |
| `dto/`                                    | Zod schemas and types for requests and responses, and the name and search limits.                                                                                                                        |
| `service/`                                | The rules (`fixed-equipment-depreciations.service.ts`), request parsing (`.validator.ts`), the row-to-response mapping and the export cells (`.transformer.ts`), and event publishing (`.transport.ts`). |
| `repository/`                             | The Prisma queries on `tblfe_depreciations`, with the `own` narrowing on `creator_id`.                                                                                                                   |
| `model/`                                  | The model other modules see and the list request and page shapes.                                                                                                                                        |
| `events/`                                 | Events published (`published.ts`) and subscribed (`subscribed.ts`, none).                                                                                                                                |
| `facade/`                                 | The read surface for other modules.                                                                                                                                                                      |
| `index.ts`                                | The module's public entry point and exports.                                                                                                                                                             |
| `__tests__/`                              | Unit specs, the in-process e2e spec over the real guards, and the int spec against the local mirror.                                                                                                     |

## Legacy parity

| Perfex                                                                                                                                                                                                                                                                                                                                                                                                      | Node                                                                                                    | Notes                                                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| List (`depreciations_table`): ID, Name, Term (`<term> months`), the id descending                                                                                                                                                                                                                                                                                                                           | `GET /api/v1/fixed-equipment-depreciations`, and `GET export`                                           | Same columns and order; server search on the name or the id; sort by id or name.                                                                                                                                         |
| View own: a member with only `view_own` sees the rows they created (`creator_id`)                                                                                                                                                                                                                                                                                                                           | `viewOwn` narrows every read to `creator_id = staffId`                                                  | **Difference**: Perfex narrows to the member's own rows for anyone holding `view_own`, even when they also hold `view`; Node shows every row whenever `view` is held, and narrows only a member holding `viewOwn` alone. |
| Add (`add_depreciations` with no id): name and number of months; `creator_id` = the member                                                                                                                                                                                                                                                                                                                  | `POST`                                                                                                  | Both fields required; the name at most 200 characters (the column's length); a whole number of months greater than 0.                                                                                                    |
| Edit (`add_depreciations` with the id): the name and the number of months                                                                                                                                                                                                                                                                                                                                   | `PATCH /:id`                                                                                            | The creator stays. Perfex answers "no data changes" when nothing changed; Node saves and answers the record.                                                                                                             |
| Delete (`delete_depreciations/<id>`): Delete refuses with 409 `ERP-FEDEPRECIATIONS-0001` while `tblfe_models.depreciation` or `tblfe_assets.depreciation` holds the id (the detail names both counts); each column is checked in `information_schema` first, and a missing one counts 0; 409 `ERP-FEDEPRECIATIONS-0002` when its use could not be counted. **Difference**: Perfex deleted without checking. | `DELETE /:id`                                                                                           | Same: no in-use check, so an asset or model may keep pointing at a deleted depreciation, as in Perfex.                                                                                                                   |
| Access: `fixed_equipment_setting_depreciation`, and also the assets, licenses, accessories and consumables permissions                                                                                                                                                                                                                                                                                      | `fixedEquipment.settingDepreciation.*` only                                                             | **Difference:** only this screen's own codes open it; the other Fixed Equipment permissions no longer do.                                                                                                                |
| Perfex searches and sorts by the term too                                                                                                                                                                                                                                                                                                                                                                   | **Difference**: Node searches the name (and the id for an all-digit query) and sorts by ID or name only |
| Perfex accepted 0, negative and decimal months                                                                                                                                                                                                                                                                                                                                                              | **Difference**: Node requires a whole number of months greater than 0 (the form and the api agree)      |                                                                                                                                                                                                                          |

## How to run its tests

```bash
corepack yarn test src/v1/fixed-equipment-depreciations
corepack yarn test:int src/v1/fixed-equipment-depreciations
```

The int spec needs the local database running and skips without `DATABASE_URL`.
