# fixed-equipment-depreciations

## Purpose

Manages the Fixed Equipment depreciation settings: the list of depreciation terms that assets and asset models refer to. It replaces Perfex's Fixed Equipment → Settings → Depreciations tab (`admin/fixed_equipment/settings?tab=depreciations`), with the screen at `/setup/fixed-equipment-depreciations` in `erp-web` and the API at `api/v1/fixed-equipment-depreciations`.

## Owned tables

- `tblfe_depreciations`: claimed in the ownership register. Node writes `name`, `term` and, on create, `creator_id`; `id` and `date_creator` are set by the database.

## The Perfex screen

- **List:** ID, Name and Term (shown as `<term> months`), newest ID first, with search, the pager and the Export menu. Each row has Edit and Delete.
- **Form:** Depreciation Name and Number of Months, both required. One action saves both add and edit (`add_depreciations`); delete is `delete_depreciations/<id>`.
- **Who can use it:** the `fixed_equipment_setting_depreciation` permission: view, view_own, create, edit, delete. With view_own only, a user sees only the rows they created (`creator_id`).

## Rules kept

- Access through `fixedEquipment.settingDepreciation.view`, `.viewOwn`, `.create`, `.edit` and `.delete`.
- View own: only the rows whose `creator_id` is the user's staff id.
- Create saves `creator_id` as the signed-in staff member; edit changes `name` and `term` only.
- Name: required, trimmed, at most 200 characters (the column's length). Term: required, a number of months.
- List order: the id descending by default.

## Planned endpoints

Under `api/v1/fixed-equipment-depreciations`: `GET` (list), `GET export`, `GET :id`, `POST`, `PATCH :id`, `DELETE :id`.

## Proposed differences from Perfex

- **Delete while in use:** Perfex deletes a depreciation even when an asset or model refers to it. The plan is to keep that behaviour (no 409).
- **Extra permissions:** Perfex also lets the assets, licenses, accessories and consumables permissions see, edit and delete depreciations. Node checks only `fixedEquipment.settingDepreciation.*`.
- **No change made:** Perfex shows "no data changes" when an edit saves the same values; Node saves and answers the record.
