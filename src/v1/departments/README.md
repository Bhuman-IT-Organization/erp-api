# departments

## Purpose

The read-only departments layer identity depends on (W2A-06): list, read and the four-format export of the client's departments, with the manager and parent pickers, over six columns of `tbldepartments`, with the manager and the parent of hr_profile's org chart (D-49), plus the facade identity uses for its department picker, its member-save check and its registrations. Departments are created, edited and deleted only on Perfex's `admin/departments` screen (`controllers/admin/Departments.php`, `models/Departments_model.php`), which is the only writer of `tbldepartments`: this module has no create, update or delete route and writes nothing. Started as a copy of erp-docs `05-templates/backend-module` (forms: singular `department`, plural `departments`) and reshaped by hand on the Currencies shape: the data layer over one column allow-list (D-47, D-48), the one reference register discovered at runtime (D-51, D-28), and the registry where other modules register what counts a department and the staff directory (D-51, D-49). The api is under `api/v1/departments`. This module imports no other v1 module, so identity may import it with no cycle (D-55).

## Owned tables

None. `tbldepartments` is Perfex's (the legacy owner); Node only reads it:

- `tbldepartments`: Perfex's. Written by Perfex's `admin/departments` screen (`Departments_model`) and hr_profile's org chart (the manager and the parent). Node selects six columns only, `departmentid`, `name`, `hidefromclient`, `calendar_id`, `manager_id`, `parent_id` (`DEPARTMENT_COLUMNS` in `repository/departments.repository.ts`, the `select` of every row-returning call), for the list, the export, the record, the two pickers and the facade, and counts child departments through `parent_id` for the register.
- The eight ticket-mailbox columns of the same row (`imap_username`, `email`, `email_from_header`, `host`, `password`, `encryption`, `folder`, `delete_after_import`): Node never reads, returns or logs them (D-47).

Nothing in erp-api writes `tbldepartments`: the repository has no create, update or delete, and `__tests__/department-columns.spec.ts` is the guard over every non-test file of `src/`: no `tbldepartments` delegate write method and no raw statement naming the table with a write keyword; the allow-list is exactly the six columns; every call that returns rows selects it; no file of this module names a mailbox column; no file outside this repository names `tbldepartments`. Each rule is proven red on a planted copy.

## Read-only sources

`DEPARTMENT_REFERENCES` in `repository/departments.repository.ts`, the one register (D-51): every column that refers to a department, read only, each line one group of the record's `usage` count. Every read probes `information_schema.COLUMNS` first (D-28, never cached), so an absent line counts 0 with no error (`tblacc_approval_setting` is absent locally).

| Group                      | Table and column                             | Owner (register) | Kind                                    |
| -------------------------- | -------------------------------------------- | ---------------- | --------------------------------------- |
| `tickets`                  | `tbltickets.department`                      | perfex-core      | integer id                              |
| `purchaseRequests`         | `tblpur_request.department`                  | purchase         | integer id                              |
| `purchaseOrders`           | `tblpur_orders.department`                   | purchase         | integer id                              |
| `purchaseContracts`        | `tblpur_contracts.department`                | purchase         | integer id                              |
| `fafRequests`              | `tblpur_faf_requests.department`             | purchase         | integer id                              |
| `goodsReceipts`            | `tblgoods_receipt.department`                | warehouse        | integer id                              |
| `goodsDeliveries`          | `tblgoods_delivery.department`               | warehouse        | integer id                              |
| `fixedEquipmentDeliveries` | `tblfe_goods_delivery.department`            | fixed_equipment  | integer id (by column type only)        |
| `assetCodeRequests`        | `tblasset_code_requests.department`          | fixed_equipment  | integer id                              |
| `childDepartments`         | `tbldepartments.parent_id`                   | perfex-core      | integer id (a self-parent never counts) |
| `purchaseApprovals`        | `tblpur_approval_setting.department`         | purchase         | integer id                              |
| `fixedEquipmentApprovals`  | `tblfe_approval_setting.departments`         | fixed_equipment  | comma list of ids                       |
| `timesheetsApprovals`      | `tbltimesheets_approval_setting.departments` | timesheets       | comma list of ids                       |
| `accountingApprovals`      | `tblacc_approval_setting.departments`        | no record        | comma list of ids (absent locally)      |
| `payslipTemplates`         | `tblhrp_payslip_templates.department_id`     | hr_payroll       | comma list of ids                       |
| `workShifts`               | `tblwork_shift.department`                   | timesheets       | comma list of ids                       |
| `daysOff`                  | `tblday_off.department`                      | timesheets       | comma list of ids                       |
| `retirementProcedures`     | `tblhr_procedure_retire_manage.department`   | hr_profile       | JSON list of ids                        |

Matching is exact: integers as integers (a text column compared as bytes), list and JSON elements whole, never a trim, a substring or a numeric cast. Not counted: the name snapshots `tblhr_list_staff_quitting_work.department_name`, `tblhrp_payslip_details.dept_name` and `tblfe_asset_creation.department` (D-51, D-52), and `tbltimesheets_kteco_attendance_logs.department`, a device's own label. `tblstaff_departments` is identity's table: identity counts it through the `staffMembers` counter it registers (D-51), so this module never names it. The managers' names come from the staff directory identity registers (D-49).

## Facade surface

- `describe(): { module: 'departments'; version: 1 }`
- `registerUsage(counter: DepartmentUsageCounter): void`: another module's read-only count of its own rows naming a department, `{ key, module, noun, count(departmentId) }`, from its own `onModuleInit` (D-51); a malformed or duplicate counter throws at boot. Every registered counter is asked for each id on a list page and a record read, and its answer is shown under its key in `registeredUsage`; a counter that fails fails that read closed. Identity is its caller (`staffMembers`, noun `staff member`, distinct staff in `tblstaff_departments`).
- `registerStaffDirectory(directory: DepartmentStaffDirectory): void`: the one staff directory, `{ listActive(), namesOf(staffIds) }` (D-49); a second throws at boot. Identity registers it, wrapping `IdentityFacade.listActiveMembers` and `namesOf`; the manager picker reads `listActive`, the manager's name reads `namesOf`.
- `listForPicker(): Promise<readonly DepartmentName[]>`: every department `{ departmentId, name }` by name then id; refused loudly (`ERP-INTERNAL-0001`) above 1000, never truncated (D-55; identity's department picker).
- `existingIds(ids: readonly number[]): Promise<ReadonlySet<number>>`: which ids are departments today; `[]` answers an empty set with no read (D-55; identity's member save).

No facade method asserts the administrator flag: a module-to-module call has no actor, and the caller authorises. The handlers keep `assertAdministrator` as their first statement. Other modules import only `src/v1/departments/index.ts` (the facade and the `DepartmentName`, `DepartmentUsageCounter`, `DepartmentStaffDirectory` types) and `DepartmentsModule`.

## Endpoints

Under `api/v1/departments` (`DEPARTMENTS_ROUTES` in `departments.routes.ts`). Five reads, no write: a `POST`, `PATCH` or `DELETE` there is a 404. All five are administrators only (D-06, D-45): every handler carries `JwtAuthGuard, PermissionGuard` and declares no permission code, and the service asserts the administrator flag as the first statement of every use case, so a member holding every catalogue code is still refused (403 `ERP-AUTH-0005`, detail `departments are managed by administrators only`) before any read. Perfex's own controller was administrator-only too (`Departments.php:16`). Every failure is an RFC 9457 problem (`application/problem+json`) with an `ERP-*` code: 400 `ERP-VALIDATION-0001` (+ `issues`), 401 `ERP-AUTH-0004`, 403 `ERP-AUTH-0005`. No route answers an `ERP-DEPARTMENTS-*` code.

| Method | Path       | Success                                                                                                                                                                                                       | Errors beyond the three                                    |
| ------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `GET`  | ``         | 200 `{ data, meta: { nextCursor, prevCursor, total, rangeStart, exportLimit, printLimit } }`, each row the record; `?limit&cursor&q&sort` (`name` default, `-name`, `id`, `-id`, `calendarId`, `-calendarId`) | none                                                       |
| `GET`  | `export`   | 200 by `?format=`: `csv` (absent), `xlsx`, `pdf` (each `attachment; filename="departments-YYYY-MM-DD.<ext>"`) or `print`; `no-store`; columns `id`, `name`, `calendarId`                                      | 400 on `export` over the format's cap; on `key`; on `font` |
| `GET`  | `managers` | 200 `{ data: [{ id, name }] }`: the staff directory's active members, in its order (the name, then the id)                                                                                                    | 500 `ERP-INTERNAL-0001` with no directory registered       |
| `GET`  | `options`  | 200 `{ data: [{ id, name, parentId }] }`: every department by name then id                                                                                                                                    | 500 `ERP-INTERNAL-0001` above 1000 departments             |
| `GET`  | `:id`      | 200 the record                                                                                                                                                                                                | 404 `ERP-CORE-0004`                                        |

The record is exactly `{ id, name, hideFromClient, calendarId, managerId, managerName, parentId, parentName, usage, registeredUsage }`: the id, the manager and the parent as decimal text (the manager and the parent `null` for a stored 0 or NULL), the calendar id `''` for NULL, the manager's name from the staff directory and the parent's name (`null` when none or unknown), `usage` one count per register group (the eighteen above, in that order) and `registeredUsage` each registered counter's answer by key (`{ staffMembers }` today). Never a mailbox column (D-47). A count that cannot be read (the probe, a statement or a registered counter fails) fails the list or the record closed rather than showing a wrong number.

## Events published

None. `events/published.ts` declares `DEPARTMENTS_PUBLISHED_EVENTS = []`: the module changes nothing, so it has nothing to announce, and it writes no log line.

## Events subscribed

None. Listed in `events/subscribed.ts` (`DEPARTMENTS_SUBSCRIBED_EVENTS`). Other modules' uses reach this one through the registered counters, not through events.

## Jobs

None.

## Resilience

No outbound call: the registered counters and the staff directory are in-process functions other modules hand in.

- **Breaker:** none: no outbound HTTP, no vendor call; a registered counter or the directory is an in-process call into the module that registered it.
- **Retry policy:** none: every route is a read, and the reads fail closed on the first error.
- **Pool budget:** shares `POOL.db.api` (`connection_limit` in `DATABASE_URL`, asserted by `check:db`); a list page costs the page, two counts, the probe and one statement per present register line (18 at most) in one `Promise.all`, the parents' names (one `findMany`) and each registered counter per page id; the parent picker and the facade's picker read every department once (`findAll`, at most 1000); no extra DB or Redis client.

## Layers

| File                                          | Responsibility                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `departments.module.ts`                       | Wires every layer as a provider; imports no v1 module; provides `DepartmentLinksRegistry`; exports `DepartmentsFacade` only; not global; no transport (nothing is published)                                                                                                                                                                                             |
| `departments.routes.ts`                       | `DEPARTMENTS_ROUTES` (`base`, `list`, `export`, `managers`, `options`, `record`), `DEPARTMENTS_EXPORT_COLUMNS` (`id`, `name`, `calendarId`), `DEPARTMENTS_EXPORT_FILE_STEM`; no permission map                                                                                                                                                                           |
| `controller/departments.controller.ts`        | The five `GET` handlers, each `@UseGuards(JwtAuthGuard, PermissionGuard)` with no permission code, `@CurrentUser()` and `@ApiZod`; the two pickers before `:id`                                                                                                                                                                                                          |
| `service/departments.service.ts`              | `assertAdministrator` first in `list`, `exportCsv`, `managers`, `options` and `get`; the register's counts, the registered counters and the names, read in one `Promise.all` and failing closed; the facade paths                                                                                                                                                        |
| `service/departments.validator.ts`            | `parseListQuery` (one sort from `DEPARTMENTS_SORT_FIELDS`, the name ascending by default, the cursor bound to it, `q`, no filter), `parseExportList`, `parseParams`; never a Nest exception                                                                                                                                                                              |
| `service/departments.transformer.ts`          | The record and the list envelope built field by field from the six columns; the export cells; the picker shape and the two picker answers                                                                                                                                                                                                                                |
| `service/department-links.registry.ts`        | `DepartmentLinksRegistry`: the usage counters and the one staff directory other modules register from their own `onModuleInit`; a malformed or duplicate registration throws at boot; `counters()` sorted by key                                                                                                                                                         |
| `repository/departments.repository.ts`        | `tbldepartments` read through Prisma on `DEPARTMENT_COLUMNS`; `DEPARTMENT_REFERENCES` with its runtime probe; the keyset list, `count`, `findById`, `findAll`, `findByIds`; no write, no DDL                                                                                                                                                                             |
| `model/departments.model.ts`                  | `DepartmentRow`, `DepartmentUsage`, `DepartmentName`, `DepartmentId`, `DepartmentsSortField`, `DepartmentsListRequest`, `DepartmentsPage`, `DEPARTMENTS_FACADE_MAX_ROWS`                                                                                                                                                                                                 |
| `dto/departments.dto.ts`                      | The list, export and params schemas, the record and list envelope, the two picker answers (`DEPARTMENTS_SEARCH_MAX`); no request body                                                                                                                                                                                                                                    |
| `events/published.ts`, `events/subscribed.ts` | none / none                                                                                                                                                                                                                                                                                                                                                              |
| `facade/departments.facade.ts`                | The only surface other modules may import; `describe()`, `registerUsage`, `registerStaffDirectory`, `listForPicker`, `existingIds`                                                                                                                                                                                                                                       |
| `index.ts`                                    | Public re-exports: the facade and its public types                                                                                                                                                                                                                                                                                                                       |
| `__tests__/`                                  | One spec per layer; `department-columns.spec.ts` (the credential guard and the no-write rule), `department-references.spec.ts` (the register against the schema, the module boundary), `department-links.registry.spec.ts`, the read-only int spec; `fakes.ts` (the read-only store, `FakeDepartmentsFacade`, `stubDepartmentsModule`), `create-departments-test-app.ts` |

## Legacy parity

The list of Perfex's `admin/departments` screen, read from its views, plus hr_profile's manager and parent. Every change stays on Perfex:

| Perfex                                                                                            | Node                                                                      | Notes          |
| ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | -------------- |
| the default order `[1, 'asc']`, the name (`manage.php:153`)                                       | the list, the name ascending by default (ties on the id)                  | the same order |
| the list's Email column and the DataTable search over it                                          | dropped: the column, the export and `q` never touch a mailbox column      | D-47           |
| add, edit and delete a department (`Departments.php`, `Departments_model.php`)                    | not served here: they stay on Perfex, the only writer of `tbldepartments` | read-only      |
| the manager and the parent edited on hr_profile's org chart                                       | shown on the record with their names; edited on Perfex only               | D-49           |
| the mailbox fields (the ticket import's address, server, credentials and folder) on the same form | never read: they stay on Perfex, edited on Perfex's pages                 | D-46, D-47     |
| `email_exists`, `folders` and `test_imap_connection` (`Departments.php`)                          | not served here: they stay on Perfex                                      | D-45           |

## How to run its tests

```bash
corepack yarn test src/v1/departments                  # unit, the guard, the register, the registry and the in-process controller e2e spec (no network, no database)
corepack yarn test:int src/v1/departments              # the repository against the local stack, read only
```

The int spec writes nothing: it reads the rows the local database already holds, compares every usage count with an independent count, never selects a mailbox column and never prints a value from the data.
