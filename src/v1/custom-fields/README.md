# custom-fields

## Purpose

A read and facade module over Perfex's custom fields, for every entity Perfex's Setup offers (D-04): the list, the export and the record, administrators only, and a values facade other modules may use to read the definitions of their entity and the custom-field values of their records. Read-only: Perfex's Setup > Custom Fields page stays the screen and the only place a field is created, edited, switched or deleted, and Perfex's `handle_custom_fields_post` stays the only writer of the values. This copy has no Node Custom Fields screen and no write route.

## Owned tables

None. Both tables are Perfex's; Node only reads them:

- `tblcustomfields`: Perfex's. Written by Setup > Custom Fields (`Custom_fields_model`) and by warehouse's `wh_convert_to_customer`. Node reads the definitions for the list, the export, the record and the facade.
- `tblcustomfieldsvalues`: Perfex's. Written by Perfex core's `handle_custom_fields_post` for every core entity (including the `items_pr` values of sales-document lines), purchase (`clone_item`, `delete_commodity`, `delete_estimate`, `delete_vendor`, `reset_data`) and warehouse (its item form, `delete_packing_list`, `delete_warehouse`). Node reads the values for the facade and counts them per field for the list and the record.

Every read goes through the typed delegates; the module issues no create, update, delete or raw statement against either table.

## Facade surface

`CustomFieldsFacade` (exported from `index.ts` with `CustomFieldEntity`, `CustomFieldType`, `CustomFieldDefinition`, `CustomFieldValue`), reads only:

- `describe()`: the module's name and version.
- `definitionsFor(fieldto, { activeOnly? })`: the fields of an entity, by `fieldOrder` then id; a stored entity or type Perfex's Setup does not offer is skipped.
- `valuesFor(fieldto, relIds)`: `relId -> fieldId -> value`, read back through the codec (a textarea without its `<br />` tags; checkbox and multiselect as arrays); values of fields the entity does not define are skipped.

The calling module's own permission decides who may read a record's values; the facade asserts nothing about the caller. No module calls the facade yet.

## Endpoints

Under `api/v1/custom-fields` (`CUSTOM_FIELDS_ROUTES`). Every handler carries `JwtAuthGuard, PermissionGuard` and declares no code; the service's first statement answers 403 `ERP-AUTH-0005` (`custom fields are managed by administrators only`) to anyone without the administrator flag, as Perfex's `is_admin()`-only controller does.

| Method | Path     | Success                                                                                                                                                                                                                 | Errors beyond 400, 401, 403            |
| ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `GET`  | ``       | 200 `{ data: [{ id, name, fieldto, type, slug, active, fieldOrder, valuesCount }], meta }`; `?q` (name or slug) `&sort` (`id` default, `name`, `fieldto`, `type`, `fieldOrder`) `&limit&cursor&filter[fieldto][in]=a,b` | none                                   |
| `GET`  | `export` | the shared export (ADR-0043, `keys: 'refuse'`): csv, xlsx, pdf or print of `id`, `name`, `fieldto`, `type`, `slug`, `active`                                                                                            | 400 on the format's cap, `key`, `font` |
| `GET`  | `:id`    | 200 the record with `valuesCount` and `etag` (also the `ETag` header)                                                                                                                                                   | 404 `ERP-CORE-0004`                    |

No `POST`, `PATCH` or `DELETE`: a field is created, edited, switched and deleted on Perfex's Setup > Custom Fields page. The module throws no module-specific error code.

The 22 entities (`CUSTOM_FIELD_ENTITIES`, Perfex's select order): core's fifteen, purchase's `vendors`, `pur_order`, `vendor_contacts`, `pur_invoice`, warehouse's `warehouse_name`, `iv_delivery`, `iv_packing_list`. The ten types: `CUSTOM_FIELD_TYPES`.

## Parity

What Node reads, as Perfex stores it (`Custom_fields_model`, `custom_fields_helper.php`):

| Perfex                                                                                   | Node                                                                                    |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| the flag columns are tinyints 0 and 1                                                    | read as booleans; the record's `disabled` is the negation of `active`, as Perfex's form |
| `options` is one comma-joined column                                                     | split into trimmed chips, empty ones dropped (`splitOptions`)                           |
| `fieldto` and `field_order` may be NULL                                                  | read as `''` and `0`; the keyset follows MySQL's NULLS FIRST ascending                  |
| `handle_custom_fields_post` stores a textarea through `nl2br`, a multi value joined `, ` | `fromStoredValue` removes the break tags and splits a checkbox or multiselect value     |
| the form lists an entity's fields by `field_order`                                       | `definitionsFor` orders by `fieldOrder`, then id                                        |

The values of sales-document lines (`items_pr`) are Perfex's like every other value. Markup in a value is answered exactly as Perfex stored it; Node renders text (T-4.2-16).

## Events published

None. The module writes nothing, so it has no change to announce (`CUSTOM_FIELDS_PUBLISHED_EVENTS` is empty).

## Events subscribed

None.

## Jobs

None.

## Resilience

- **Breaker:** none: no outbound call.
- **Retry policy:** none: reads only; a failing read is not caught (fail closed).
- **Pool budget:** shares `POOL.db.api`; no extra client.

## Layers

| File                                          | Responsibility                                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `custom-fields.module.ts`                     | Wires every layer; exports the facade only                                                               |
| `custom-fields.routes.ts`                     | `CUSTOM_FIELDS_ROUTES`, `CUSTOM_FIELD_ENTITIES`, `CUSTOM_FIELD_TYPES`, the export columns and stem       |
| `controller/custom-fields.controller.ts`      | The three read handlers; the `ETag` header on the record answer                                          |
| `service/custom-fields.service.ts`            | The read use cases, `assertAdministrator` first in each handler's method, the export, the facade's reads |
| `service/custom-fields.validator.ts`          | The list grammar (one sort, `filter[fieldto][in]`), the export's list request, `:id`                     |
| `service/custom-fields.transformer.ts`        | Record, list and definition shapes; `shownOf`, what the fingerprint covers                               |
| `service/custom-field-values.ts`              | The read codec (`fromStoredValue`) and the options column (`splitOptions`)                               |
| `repository/custom-fields.repository.ts`      | Typed reads of both Perfex tables, the NULL-aware keyset, the grouped value counts; no write             |
| `model/custom-fields.model.ts`                | `CustomField`, `CustomFieldDefinition`, `CustomFieldValue`, the list request and page                    |
| `dto/custom-fields.dto.ts`                    | The wire schemas (queries, `:id`, the record and the list); no body                                      |
| `events/published.ts`, `events/subscribed.ts` | None / none                                                                                              |
| `facade/custom-fields.facade.ts`              | The ONLY surface other modules import                                                                    |
| `index.ts`                                    | Public re-exports                                                                                        |

## How to run its tests

`corepack yarn test src/v1/custom-fields` (unit and e2e with the in-memory fake) and `corepack yarn test:int src/v1/custom-fields` (the repository against the local MySQL, reads only: every case compares the repository with a direct read and writes nothing).
