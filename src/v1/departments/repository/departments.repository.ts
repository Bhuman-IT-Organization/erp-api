/**
 * Repository: the module's data seam (BE-08) and the only file in `src/` that names
 * `tbldepartments` (DB-04; `__tests__/department-columns.spec.ts` holds every non-test file to it).
 *
 * Reader of one table it does not own (ADR-0029): `tbldepartments` is Perfex's (the legacy owner;
 * Perfex's `admin/departments` screen is its only writer). Node READS six columns only (D-47):
 * `departmentid`, `name` (`VARCHAR(100)`), `hidefromclient` (0 or 1), `calendar_id` (`LONGTEXT`),
 * `manager_id` and `parent_id` (`INT`, 0 meaning none; hr_profile's org chart, D-49), and writes
 * nothing: this file holds no create, update or delete, and nothing in erp-api may write the table.
 *
 * The other eight columns of the row are Perfex's ticket-mailbox settings (`imap_username`,
 * `email`, `email_from_header`, `host`, `password`, `encryption`, `folder`,
 * `delete_after_import`), the password among them. Node never selects, returns or logs them (D-47).
 * Mechanically (D-48): `DEPARTMENT_COLUMNS` below is the `select` of EVERY delegate call that
 * returns rows; the one raw statement naming the table (the child count of the register) selects
 * `parent_id` and a count of the key, never `*`.
 *
 * `DEPARTMENT_REFERENCES`: the ONE reference register (D-51, the Currencies precedent). Every column
 * that refers to a department is listed once, with its group and its match kind; every line is a
 * count shown on the list and record reads. Each is a Perfex or Perfex-module column, read only and
 * never written. Every kind is confirmed from the code that writes the column, read-only, except
 * the two marked:
 *
 *   group                     owner (register)  table.column                          kind
 *   tickets                   perfex-core       tbltickets.department                 integerId
 *   purchaseRequests          purchase          tblpur_request.department             integerId
 *   purchaseOrders            purchase          tblpur_orders.department              integerId
 *   purchaseContracts         purchase          tblpur_contracts.department           integerId
 *   fafRequests               purchase          tblpur_faf_requests.department        integerId
 *   goodsReceipts             warehouse         tblgoods_receipt.department           integerId
 *   goodsDeliveries           warehouse         tblgoods_delivery.department          integerId
 *   fixedEquipmentDeliveries  fixed_equipment   tblfe_goods_delivery.department       integerId (1)
 *   assetCodeRequests         fixed_equipment   tblasset_code_requests.department     integerId
 *   childDepartments          perfex-core       tbldepartments.parent_id              integerId
 *   purchaseApprovals         purchase          tblpur_approval_setting.department    integerId
 *   fixedEquipmentApprovals   fixed_equipment   tblfe_approval_setting.departments    idList
 *   timesheetsApprovals       timesheets        tbltimesheets_approval_setting        idList
 *                                               .departments
 *   accountingApprovals       (no record)       tblacc_approval_setting.departments   idList (2)
 *   payslipTemplates          hr_payroll        tblhrp_payslip_templates.department_id idList
 *   workShifts                timesheets        tblwork_shift.department              idList
 *   daysOff                   timesheets        tblday_off.department                 idList
 *   retirementProcedures      hr_profile        tblhr_procedure_retire_manage         idJson
 *                                               .department
 *
 * (1) an integer id by its column type only: no fixed_equipment writer or form names it (row 446);
 * counting it is harmless. (2) no DDL anywhere in `modules/accounting` and no register record; the
 * column name comes from its writer, an `implode` (`Accounting_model.php:34689`); the table is
 * absent from the local database and the Prisma mirror, so the probe decides (row 444).
 *
 * The kinds. `integerId`: the column holds the id as an integer. `idList`: a text column holding a
 * comma-joined list of ids (each written by an `implode` of the posted department ids). `idJson`: a
 * text column holding a JSON list of ids (`json_encode`, hr_profile's resignation procedure).
 * Approval settings and child departments count, because an orphaned approval route fails
 * silently and an orphaned child breaks the org tree (D-51, a lead decision). Not in the register:
 * the name snapshots (`tblhr_list_staff_quitting_work.department_name`,
 * `tblhrp_payslip_details.dept_name`, `tblfe_asset_creation.department`), which a rename does not
 * change and a delete does not orphan (D-51, D-52: the rename stays allowed);
 * `tbltimesheets_kteco_attendance_logs.department`, a device's own label; and
 * `tblstaff_departments`, which identity counts through the counter it registers (D-51), so this
 * module never names identity's table.
 *
 * Exact matching (T-4.1-193). An integer line on an integer column binds the page ids as numbers;
 * on any other type it compares the bytes with `CAST(r.<c> AS BINARY) IN (...)` against each id's
 * decimal text, so `'07'`, `'7 '` or `' 7'` never count as 7. A list line is ONE statement reading
 * the column's non-empty values (never one per id, never `FIND_IN_SET`), then in memory each value
 * is split on `,` and every element compared `===` with an id's decimal text: never a trim, a LIKE or
 * a numeric cast, and a row naming the id twice counts once. A JSON line reads the same way, then
 * `JSON.parse` in a try (invalid JSON counts 0): only a TOP-LEVEL array counts, and only an element
 * `=== id` (a number) or `=== String(id)` (a string); nested arrays, objects and a JSON string are
 * never searched, and no SQL JSON function is used. A child counts only when its `parent_id` is a
 * page id and is not its own id (a department naming itself as parent is not its own child). An
 * answer counts only when it is exactly a page id; a stored 0 never counts.
 *
 * The runtime probe (D-28, applied by D-51): before every usage read, ONE statement over
 * `information_schema.COLUMNS` (every register table and column name BOUND, never SQL text) answers
 * which lines exist in the connected schema and with which `DATA_TYPE`; only those run, and a missing
 * one counts 0 and raises no error. It is never cached: a module's table may be absent from one
 * install and present in another (`tblacc_approval_setting` is absent locally), and when a later
 * slice adds or migrates a column this module counts it with no code change. This module never adds
 * or drops a column anywhere (D-28).
 *
 * Each present line is ONE tagged `$queryRaw`, the table and column literal SQL text and the values
 * bound with `Prisma.join` (no unsafe or raw-text variant, and no write keyword: the ownership guard
 * reads one as a write), all in one `Promise.all`.
 *
 * Fail closed: an error from the probe or from any statement is not caught, so `usageByDepartment`
 * rejects, and a list or a record read then answers its retryable error rather than a count nobody
 * could read.
 *
 * Every row is re-parsed through its zod schema, never trusted from the generic (BE-11).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { Prisma } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import {
  encodeCursor,
  keysetWhere,
  type DecodedCursor,
  type KeyValue,
} from '../../../shared/http/keyset.js';
import {
  DEPARTMENTS_FACADE_MAX_ROWS,
  type DepartmentRow,
  type DepartmentsListRequest,
  type DepartmentsPage,
  type DepartmentsSortField,
  type DepartmentUsage,
} from '../model/departments.model.js';
import { NO_DEPARTMENT_USAGE } from '../service/departments.transformer.js';

/** The largest value of MySQL's signed `INT` (the id column): a longer all-digit `q` is not an id. */
const MAX_INT_ID = 2_147_483_647;

/** The `information_schema.COLUMNS.DATA_TYPE` values an integer line is compared as numbers on. */
const INTEGER_TYPES: ReadonlySet<string> = new Set([
  'tinyint',
  'smallint',
  'mediumint',
  'int',
  'integer',
  'bigint',
]);

/**
 * The credential guard's allow-list (D-47, D-48): the six columns Node reads, and the `select` of
 * EVERY `tbldepartments` call that returns rows. Never widen it: the mailbox columns stay Perfex's.
 */
export const DEPARTMENT_COLUMNS = {
  departmentid: true,
  name: true,
  hidefromclient: true,
  calendar_id: true,
  manager_id: true,
  parent_id: true,
} as const satisfies Prisma.tbldepartmentsSelect;

/** The Prisma field each `?sort=` value orders on. */
const SORT_COLUMNS = {
  name: 'name',
  id: 'departmentid',
  calendarId: 'calendar_id',
} as const satisfies Record<DepartmentsSortField, string>;

/** A stored 0 or NULL manager or parent is none. */
const optionalId = z
  .number()
  .int()
  .nullable()
  .transform((id) => (id === null || id === 0 ? null : id));

const rowSchema = z
  .object({
    departmentid: z.number().int(),
    name: z.string(),
    hidefromclient: z.boolean(),
    calendar_id: z.string().nullable(),
    manager_id: optionalId,
    parent_id: optionalId,
  })
  .transform((row): DepartmentRow => ({
    id: row.departmentid,
    name: row.name,
    hideFromClient: row.hidefromclient,
    calendarId: row.calendar_id,
    managerId: row.manager_id,
    parentId: row.parent_id,
  }));
const rowsSchema = z.array(rowSchema);

/** `COUNT(*)` and an integer column arrive from MySQL as a bigint or a number. */
const integerSchema = z.union([z.bigint(), z.number().int()]).transform(Number);
/** An answer of a statement compared as numbers: the column's integer and its count. */
const valueRowsSchema = z.array(z.object({ id: integerSchema, n: integerSchema }));
/** An answer of a statement compared as bytes: the column's stored text and its count. */
const textRowsSchema = z.array(z.object({ id: z.string(), n: integerSchema }));
/** An answer of a list or JSON line: one stored value per row, read as text. */
const listRowsSchema = z.array(
  z.object({ v: z.union([z.string(), z.number(), z.bigint()]).transform(String) }),
);
const presentColumnsSchema = z.array(z.object({ t: z.string(), c: z.string(), d: z.string() }));

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];
type RawClient = PrismaService['client'];

/** How a register line holds the department (the docblock's kinds). */
export type DepartmentMatch = 'integerId' | 'idList' | 'idJson';

/** One line of the register: the group it counts toward, where it lives, how it matches, its statements. */
export interface DepartmentReference {
  readonly group: keyof DepartmentUsage;
  readonly table: string;
  readonly column: string;
  readonly match: DepartmentMatch;
  /** `integerId` lines: `WHERE r.<c> IN (<ids bound as numbers>)`, rows `{ id, n }`. */
  readonly byValue?: (client: RawClient, values: Prisma.Sql) => Promise<unknown>;
  /** `integerId` lines on another type: `WHERE CAST(r.<c> AS BINARY) IN (<texts bound>)`, rows `{ id, n }`. */
  readonly byBytes?: (client: RawClient, values: Prisma.Sql) => Promise<unknown>;
  /** `idList` and `idJson` lines: every non-empty stored value, rows `{ v }`. */
  readonly values?: (client: RawClient) => Promise<unknown>;
}

/**
 * The register (D-51): every line once, in the `usage` record's order. A column a later finding adds
 * joins here in the same shape; the probe decides at every read whether it runs.
 */
export const DEPARTMENT_REFERENCES: readonly DepartmentReference[] = Object.freeze([
  {
    group: 'tickets',
    table: 'tbltickets',
    column: 'department',
    match: 'integerId',
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tbltickets r WHERE r.department IN (${values}) GROUP BY r.department`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tbltickets r WHERE CAST(r.department AS BINARY) IN (${values}) GROUP BY r.department`,
  },
  {
    group: 'purchaseRequests',
    table: 'tblpur_request',
    column: 'department',
    match: 'integerId',
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblpur_request r WHERE r.department IN (${values}) GROUP BY r.department`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblpur_request r WHERE CAST(r.department AS BINARY) IN (${values}) GROUP BY r.department`,
  },
  {
    group: 'purchaseOrders',
    table: 'tblpur_orders',
    column: 'department',
    match: 'integerId',
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblpur_orders r WHERE r.department IN (${values}) GROUP BY r.department`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblpur_orders r WHERE CAST(r.department AS BINARY) IN (${values}) GROUP BY r.department`,
  },
  {
    group: 'purchaseContracts',
    table: 'tblpur_contracts',
    column: 'department',
    match: 'integerId',
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblpur_contracts r WHERE r.department IN (${values}) GROUP BY r.department`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblpur_contracts r WHERE CAST(r.department AS BINARY) IN (${values}) GROUP BY r.department`,
  },
  {
    group: 'fafRequests',
    table: 'tblpur_faf_requests',
    column: 'department',
    match: 'integerId',
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblpur_faf_requests r WHERE r.department IN (${values}) GROUP BY r.department`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblpur_faf_requests r WHERE CAST(r.department AS BINARY) IN (${values}) GROUP BY r.department`,
  },
  {
    group: 'goodsReceipts',
    table: 'tblgoods_receipt',
    column: 'department',
    match: 'integerId',
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblgoods_receipt r WHERE r.department IN (${values}) GROUP BY r.department`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblgoods_receipt r WHERE CAST(r.department AS BINARY) IN (${values}) GROUP BY r.department`,
  },
  {
    group: 'goodsDeliveries',
    table: 'tblgoods_delivery',
    column: 'department',
    match: 'integerId',
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblgoods_delivery r WHERE r.department IN (${values}) GROUP BY r.department`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblgoods_delivery r WHERE CAST(r.department AS BINARY) IN (${values}) GROUP BY r.department`,
  },
  {
    group: 'fixedEquipmentDeliveries',
    table: 'tblfe_goods_delivery',
    column: 'department',
    match: 'integerId',
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblfe_goods_delivery r WHERE r.department IN (${values}) GROUP BY r.department`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblfe_goods_delivery r WHERE CAST(r.department AS BINARY) IN (${values}) GROUP BY r.department`,
  },
  {
    group: 'assetCodeRequests',
    table: 'tblasset_code_requests',
    column: 'department',
    match: 'integerId',
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblasset_code_requests r WHERE r.department IN (${values}) GROUP BY r.department`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblasset_code_requests r WHERE CAST(r.department AS BINARY) IN (${values}) GROUP BY r.department`,
  },
  {
    group: 'childDepartments',
    table: 'tbldepartments',
    column: 'parent_id',
    match: 'integerId',
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.parent_id AS id, COUNT(r.departmentid) AS n FROM tbldepartments r WHERE r.parent_id IN (${values}) AND r.departmentid <> r.parent_id GROUP BY r.parent_id`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.parent_id AS id, COUNT(r.departmentid) AS n FROM tbldepartments r WHERE CAST(r.parent_id AS BINARY) IN (${values}) AND r.departmentid <> r.parent_id GROUP BY r.parent_id`,
  },
  {
    group: 'purchaseApprovals',
    table: 'tblpur_approval_setting',
    column: 'department',
    match: 'integerId',
    byValue: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblpur_approval_setting r WHERE r.department IN (${values}) GROUP BY r.department`,
    byBytes: (client, values) =>
      client.$queryRaw`SELECT r.department AS id, COUNT(*) AS n FROM tblpur_approval_setting r WHERE CAST(r.department AS BINARY) IN (${values}) GROUP BY r.department`,
  },
  {
    group: 'fixedEquipmentApprovals',
    table: 'tblfe_approval_setting',
    column: 'departments',
    match: 'idList',
    values: (client) =>
      client.$queryRaw`SELECT r.departments AS v FROM tblfe_approval_setting r WHERE r.departments IS NOT NULL AND r.departments <> ''`,
  },
  {
    group: 'timesheetsApprovals',
    table: 'tbltimesheets_approval_setting',
    column: 'departments',
    match: 'idList',
    values: (client) =>
      client.$queryRaw`SELECT r.departments AS v FROM tbltimesheets_approval_setting r WHERE r.departments IS NOT NULL AND r.departments <> ''`,
  },
  {
    group: 'accountingApprovals',
    table: 'tblacc_approval_setting',
    column: 'departments',
    match: 'idList',
    values: (client) =>
      client.$queryRaw`SELECT r.departments AS v FROM tblacc_approval_setting r WHERE r.departments IS NOT NULL AND r.departments <> ''`,
  },
  {
    group: 'payslipTemplates',
    table: 'tblhrp_payslip_templates',
    column: 'department_id',
    match: 'idList',
    values: (client) =>
      client.$queryRaw`SELECT r.department_id AS v FROM tblhrp_payslip_templates r WHERE r.department_id IS NOT NULL AND r.department_id <> ''`,
  },
  {
    group: 'workShifts',
    table: 'tblwork_shift',
    column: 'department',
    match: 'idList',
    values: (client) =>
      client.$queryRaw`SELECT r.department AS v FROM tblwork_shift r WHERE r.department IS NOT NULL AND r.department <> ''`,
  },
  {
    group: 'daysOff',
    table: 'tblday_off',
    column: 'department',
    match: 'idList',
    values: (client) =>
      client.$queryRaw`SELECT r.department AS v FROM tblday_off r WHERE r.department IS NOT NULL AND r.department <> ''`,
  },
  {
    group: 'retirementProcedures',
    table: 'tblhr_procedure_retire_manage',
    column: 'department',
    match: 'idJson',
    values: (client) =>
      client.$queryRaw`SELECT r.department AS v FROM tblhr_procedure_retire_manage r WHERE r.department IS NOT NULL AND r.department <> ''`,
  },
]);

/** The key a line answers by: `table.column`, as declared. */
export function referenceKey(reference: Pick<DepartmentReference, 'table' | 'column'>): string {
  return `${reference.table}.${reference.column}`;
}

/** `?q=`: the name or the calendar id contains it; an all-digit `q` that fits the id column also matches the id. */
function matchOf(search: string | null): WhereValue {
  if (search === null) return {};
  const or: WhereValue[] = [{ name: { contains: search } }, { calendar_id: { contains: search } }];
  if (/^\d+$/.test(search) && Number(search) <= MAX_INT_ID)
    or.push({ departmentid: Number(search) });
  return { OR: or };
}

/** A row's keyset key: the sort column's value (a NULL calendar id as `false`) and the id. */
function keyOf(row: DepartmentRow, sortField: DepartmentsSortField): Key {
  if (sortField === 'name') return [row.name, row.id];
  if (sortField === 'calendarId') return [row.calendarId ?? false, row.id];
  return [row.id, row.id];
}

/**
 * The calendar id's keyset, NULL-safe: MySQL orders a `NULL` before every value ascending (and
 * after it descending), and the cursor of a `NULL` row carries `false`. "Greater" (ascending after,
 * descending before) is every row with a larger value, a NULL row only on a NULL cursor with a
 * larger id; "lesser" adds the NULL rows below any value.
 */
function nullableKeyset(
  column: 'calendar_id',
  cursor: DecodedCursor<DepartmentsSortField>,
  order: 'asc' | 'desc',
): WhereValue {
  const greater = (order === 'asc') === (cursor.direction === 'after');
  const op = greater ? 'gt' : 'lt';
  const [stored, id] = cursor.key;
  const value = typeof stored === 'boolean' ? null : stored;
  const tie = { [column]: value, departmentid: { [op]: id } };
  if (value === null) return greater ? { OR: [{ [column]: { not: null } }, tie] } : tie;
  return greater
    ? { OR: [{ [column]: { gt: value } }, tie] }
    : { OR: [{ [column]: null }, { [column]: { lt: value } }, tie] };
}

/** "Rows strictly after (or before) the cursor row in this order", for the sort column. */
function keysetOf(cursor: DecodedCursor<DepartmentsSortField>, order: 'asc' | 'desc'): WhereValue {
  if (cursor.sort === 'calendarId') return nullableKeyset('calendar_id', cursor, order);
  return keysetWhere(SORT_COLUMNS[cursor.sort], 'departmentid', cursor, order);
}

/** A `before` cursor reads the rows just before it in the reversed order, then reverses them back. */
function readDirection(request: {
  readonly cursor: Pick<DecodedCursor<string>, 'direction'> | null;
  readonly order: 'asc' | 'desc';
}): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

/** Next exists while rows remain after the page, Previous while rows exist before it. */
function pageMeta(
  sortField: DepartmentsSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<DepartmentsPage, 'items'> {
  const first = keys[0];
  const last = keys.at(-1);
  if (first === undefined || last === undefined) {
    return { nextCursor: null, prevCursor: null, total, rangeStart: 0 };
  }
  const rangeStart = before + 1;
  return {
    nextCursor:
      rangeStart - 1 + keys.length < total ? encodeCursor(sortField, last, 'after') : null,
    prevCursor: rangeStart > 1 ? encodeCursor(sortField, first, 'before') : null,
    total,
    rangeStart,
  };
}

/** One page's counts while the answers are summed into them, and how an answer finds its id. */
interface PageCounts {
  readonly totals: ReadonlyMap<number, Record<keyof DepartmentUsage, number>>;
  /** A page id's decimal text -> the id. */
  readonly idTexts: ReadonlyMap<string, number>;
}

/** Adds `n` to one group of one department's counts (an id not on the page adds nothing). */
function addTo(
  counts: PageCounts,
  id: number | undefined,
  group: keyof DepartmentUsage,
  n: number,
): void {
  if (id === undefined) return;
  const own = counts.totals.get(id);
  if (own !== undefined) own[group] += n;
}

/**
 * The page ids an `idList` value names: each element compared `===` with a page id's decimal text,
 * no trim; an id named twice is one.
 *
 * @complexity O(e) over the value's elements
 */
export function idsInList(value: string, idTexts: ReadonlyMap<string, number>): Set<number> {
  const found = new Set<number>();
  for (const element of value.split(',')) {
    const id = idTexts.get(element);
    if (id !== undefined) found.add(id);
  }
  return found;
}

/** The page id one JSON element names: a number equal to a page id, or text equal to its decimal text. */
function idOfElement(element: unknown, idTexts: ReadonlyMap<string, number>): number | undefined {
  if (typeof element === 'string') return idTexts.get(element);
  if (typeof element === 'number' && Number.isInteger(element)) {
    return idTexts.get(String(element)) === element ? element : undefined;
  }
  return undefined;
}

/** `JSON.parse`, or `undefined` for invalid JSON (which counts 0). */
function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/**
 * The page ids an `idJson` value names: only a TOP-LEVEL array's elements, each a number `=== id` or
 * a string `=== String(id)`; nested arrays, objects, a JSON string and invalid JSON name none.
 *
 * @complexity O(e) over the array's elements
 */
export function idsInJson(value: string, idTexts: ReadonlyMap<string, number>): Set<number> {
  const parsed = parseJson(value);
  const found = new Set<number>();
  if (!Array.isArray(parsed)) return found;
  for (const element of parsed) {
    const id = idOfElement(element, idTexts);
    if (id !== undefined) found.add(id);
  }
  return found;
}

/**
 * Adds one statement's answer to the line's group: a numeric answer counts only when it is a page
 * id; a byte answer only when it is byte-equal to a page id's decimal text; a list or JSON value
 * once per page id it names.
 *
 * @complexity O(r + e) over the answer's rows and their elements
 */
function addAnswer(
  counts: PageCounts,
  reference: DepartmentReference,
  numeric: boolean,
  answer: unknown,
): void {
  if (reference.match === 'integerId') {
    const rows = numeric
      ? valueRowsSchema.parse(answer)
      : textRowsSchema.parse(answer).map(({ id, n }) => ({ id: counts.idTexts.get(id), n }));
    for (const { id, n } of rows) addTo(counts, id, reference.group, n);
    return;
  }
  const named = reference.match === 'idList' ? idsInList : idsInJson;
  for (const { v } of listRowsSchema.parse(answer)) {
    addOnceEach(counts, named(v, counts.idTexts), reference.group);
  }
}

/** Adds 1 to one group of each page id a stored value names (once per value, however often named). */
function addOnceEach(
  counts: PageCounts,
  ids: ReadonlySet<number>,
  group: keyof DepartmentUsage,
): void {
  ids.forEach((id) => {
    addTo(counts, id, group, 1);
  });
}

/**
 * The page's ids at zero and their decimal texts.
 *
 * @complexity O(n) over the ids
 */
function pageCounts(ids: readonly number[]): PageCounts {
  return {
    totals: new Map(ids.map((id) => [id, { ...NO_DEPARTMENT_USAGE }])),
    idTexts: new Map(ids.map((id) => [String(id), id])),
  };
}

@Injectable()
export class DepartmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One keyset page ordered by `(sort column, id)`, then `total` (the match without the cursor) and
   * the rank of the first row, both through `count`.
   */
  async list(request: DepartmentsListRequest): Promise<DepartmentsPage> {
    const { sortField, order, cursor, limit } = request;
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.prisma.client.tbldepartments.findMany({
      where: cursor === null ? match : { AND: [match, keysetOf(cursor, order)] },
      orderBy: [{ [SORT_COLUMNS[sortField]]: read }, { departmentid: read }],
      take: limit,
      select: DEPARTMENT_COLUMNS,
    });
    const items = rowsSchema.parse(rows);
    if (read !== order) items.reverse();
    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tbldepartments.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tbldepartments.count({
            where: {
              AND: [match, keysetOf({ sort: sortField, key: first, direction: 'before' }, order)],
            },
          }),
    ]);
    return { items, ...pageMeta(sortField, keys, total, before) };
  }

  /** The list's own match without the cursor: what the export counts before it reads a row. */
  count(request: DepartmentsListRequest): Promise<number> {
    return this.prisma.client.tbldepartments.count({ where: matchOf(request.search) });
  }

  /** One row through the six columns, or `null` when the id is missing. */
  async findById(id: number): Promise<DepartmentRow | null> {
    const row = await this.prisma.client.tbldepartments.findFirst({
      where: { departmentid: id },
      select: DEPARTMENT_COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  /**
   * Every department, the name then the id ascending: the parent picker and the facade's picker.
   * Reads one row more than `DEPARTMENTS_FACADE_MAX_ROWS` and refuses loudly when it
   * finds it, never answering a truncated list.
   */
  async findAll(): Promise<readonly DepartmentRow[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tbldepartments.findMany({
        orderBy: [{ name: 'asc' }, { departmentid: 'asc' }],
        take: DEPARTMENTS_FACADE_MAX_ROWS + 1,
        select: DEPARTMENT_COLUMNS,
      }),
    );
    if (rows.length > DEPARTMENTS_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(DEPARTMENTS_FACADE_MAX_ROWS)} departments: the full list was refused, not truncated`,
      );
    }
    return rows;
  }

  /** The rows of `ids` that exist, the id ascending; `[]` reads nothing. */
  async findByIds(ids: readonly number[]): Promise<readonly DepartmentRow[]> {
    if (ids.length === 0) return [];
    return rowsSchema.parse(
      await this.prisma.client.tbldepartments.findMany({
        where: { departmentid: { in: [...ids] } },
        orderBy: { departmentid: 'asc' },
        select: DEPARTMENT_COLUMNS,
      }),
    );
  }

  /**
   * The register's lines the connected schema has right now: `table.column` (as declared) to its
   * `DATA_TYPE` (lower case). ONE `information_schema.COLUMNS` read with every name bound, matched
   * exactly (letter case folded on both sides, as MySQL may answer a name in another case). An absent
   * table or column is simply not in the map. Never cached (D-28).
   *
   * @complexity O(r + c) over the answer's rows and the register's lines
   */
  async presentReferences(): Promise<ReadonlyMap<string, string>> {
    const tables = [...new Set(DEPARTMENT_REFERENCES.map((reference) => reference.table))];
    const columns = [...new Set(DEPARTMENT_REFERENCES.map((reference) => reference.column))];
    const rows = presentColumnsSchema.parse(
      await this.prisma.client
        .$queryRaw`SELECT TABLE_NAME AS t, COLUMN_NAME AS c, DATA_TYPE AS d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${Prisma.join(tables)}) AND COLUMN_NAME IN (${Prisma.join(columns)})`,
    );
    const found = new Map(
      rows.map((row) => [`${row.t}.${row.c}`.toLowerCase(), row.d.toLowerCase()]),
    );
    const present = new Map<string, string>();
    for (const key of DEPARTMENT_REFERENCES.map(referenceKey)) {
      const type = found.get(key.toLowerCase());
      if (type !== undefined) present.set(key, type);
    }
    return present;
  }

  /**
   * What refers to each department of `ids`: the probe first, then one statement per PRESENT line in
   * one `Promise.all` (ids bound as numbers on an integer column, as decimal text otherwise; a list
   * or JSON line reads its values once and matches them in memory), then every id a key, zeros
   * where nothing refers to it and for every missing line. No ids, no query. An error from the probe
   * or any statement rejects the whole answer (fail closed).
   *
   * @complexity O(l + r) over the register's lines and the answers' rows
   */
  async usageByDepartment(ids: readonly number[]): Promise<ReadonlyMap<number, DepartmentUsage>> {
    if (ids.length === 0) return new Map();
    const present = await this.presentReferences();
    const counts = pageCounts(ids);
    const numbers = Prisma.join([...ids]);
    const texts = Prisma.join([...counts.idTexts.keys()]);
    const reads = DEPARTMENT_REFERENCES.flatMap((reference) => {
      const type = present.get(referenceKey(reference));
      if (type === undefined) return [];
      return [{ reference, numeric: reference.match === 'integerId' && INTEGER_TYPES.has(type) }];
    });
    const answers = await Promise.all(
      reads.map(({ reference, numeric }) => this.statementOf(reference, numeric, numbers, texts)),
    );
    reads.forEach(({ reference, numeric }, index) => {
      addAnswer(counts, reference, numeric, answers[index]);
    });
    return counts.totals;
  }

  /** The one statement a present line runs. */
  private statementOf(
    reference: DepartmentReference,
    numeric: boolean,
    numbers: Prisma.Sql,
    texts: Prisma.Sql,
  ): Promise<unknown> {
    const client = this.prisma.client;
    if (numeric && reference.byValue !== undefined) return reference.byValue(client, numbers);
    if (reference.byBytes !== undefined) return reference.byBytes(client, texts);
    if (reference.values !== undefined) return reference.values(client);
    return Promise.reject(
      new Error(`department reference ${referenceKey(reference)} has no statement`),
    );
  }
}
