/**
 * Domain entity types of the module; nothing here is a DTO. The entity is one `tbldepartments` row
 * (Perfex's table; Node only reads it) in its STORED form, read through six columns (D-47): `departmentid` (`INT`,
 * assigned by the database), `name` (`VARCHAR(100)`), `hidefromclient` (`TINYINT(1)`, a `Boolean`
 * in the Prisma mirror), `calendar_id` (`LONGTEXT`, nullable), `manager_id` and `parent_id` (`INT`,
 * nullable, default 0). The eight ticket-mailbox columns of the same row are Perfex's and never
 * appear here (D-47, D-48).
 */
import type { DecodedCursor, ListPageMeta } from '../../../shared/http/keyset.js';

/** One `tbldepartments` row through the six read columns, stored form. */
export interface DepartmentRow {
  /** `departmentid`; `String(id)` on the wire. */
  readonly id: number;
  readonly name: string;
  readonly hideFromClient: boolean;
  /** `calendar_id` as stored; `NULL` in the column is `null` here. */
  readonly calendarId: string | null;
  /** `manager_id`, a staff id; a stored 0 or `NULL` (none) is `null` here. */
  readonly managerId: number | null;
  /** `parent_id`, a department id; a stored 0 or `NULL` (none) is `null` here. */
  readonly parentId: number | null;
}

/**
 * What refers to a department: one count per group of `DEPARTMENT_REFERENCES` (the repository's
 * docblock; D-51), shown on the list and record reads.
 */
export interface DepartmentUsage {
  readonly tickets: number;
  readonly purchaseRequests: number;
  readonly purchaseOrders: number;
  readonly purchaseContracts: number;
  readonly fafRequests: number;
  readonly goodsReceipts: number;
  readonly goodsDeliveries: number;
  readonly fixedEquipmentDeliveries: number;
  readonly assetCodeRequests: number;
  readonly childDepartments: number;
  readonly purchaseApprovals: number;
  readonly fixedEquipmentApprovals: number;
  readonly timesheetsApprovals: number;
  readonly accountingApprovals: number;
  readonly payslipTemplates: number;
  readonly workShifts: number;
  readonly daysOff: number;
  readonly retirementProcedures: number;
}

/** The facade's picker shape (D-55): what identity's department picker answers. */
export interface DepartmentName {
  readonly departmentId: number;
  readonly name: string;
}

export type DepartmentId = DepartmentRow['id'];

/**
 * The columns `?sort=` accepts. `name` and `id` are NOT NULL; `calendarId` is nullable, so its
 * keyset reads a `NULL` as the lowest value (MySQL's order) and its cursor carries `false` for it.
 */
export type DepartmentsSortField = 'name' | 'id' | 'calendarId';

/** One checked list request: `?q`, the one sort, the cursor decoded for it, the page size. */
export interface DepartmentsListRequest {
  readonly search: string | null;
  readonly sortField: DepartmentsSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<DepartmentsSortField> | null;
  readonly limit: number;
}

/** One keyset page and its pager meta (`shared/http/keyset.ts`). */
export interface DepartmentsPage extends ListPageMeta {
  readonly items: readonly DepartmentRow[];
}

/**
 * The most rows `findAll` (the parent picker and the facade's picker) answers.
 * Perfex installs hold a handful of departments; above this the read is refused loudly
 * (`ERP-INTERNAL-0001`), never truncated.
 */
export const DEPARTMENTS_FACADE_MAX_ROWS = 1000;
