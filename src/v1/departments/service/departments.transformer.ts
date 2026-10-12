/**
 * Transformer: entity to response DTO, the facade's `DepartmentName` and the export rows. Every DTO
 * is built field by field from the six read columns, never by spreading a row, and then parsed
 * through its zod response schema, which strips any key the schema does not name: nothing the wire
 * shape does not declare can ride along, a ticket-mailbox column least of all (D-47, T-4.1-187).
 * The controller never imports this file (BE-08).
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import { DEPARTMENTS_EXPORT_COLUMNS } from '../departments.routes.js';
import {
  departmentsListResponseSchema,
  departmentsManagersResponseSchema,
  departmentsOptionsResponseSchema,
  departmentsResponseSchema,
  type DepartmentsListResponseDto,
  type DepartmentsManagersResponseDto,
  type DepartmentsOptionsResponseDto,
  type DepartmentsResponseDto,
} from '../dto/departments.dto.js';
import type { DepartmentName, DepartmentRow, DepartmentUsage } from '../model/departments.model.js';
import type { DepartmentStaffDirectory } from './department-links.registry.js';

/** The counts a department answers when nothing refers to it. */
export const NO_DEPARTMENT_USAGE: DepartmentUsage = {
  tickets: 0,
  purchaseRequests: 0,
  purchaseOrders: 0,
  purchaseContracts: 0,
  fafRequests: 0,
  goodsReceipts: 0,
  goodsDeliveries: 0,
  fixedEquipmentDeliveries: 0,
  assetCodeRequests: 0,
  childDepartments: 0,
  purchaseApprovals: 0,
  fixedEquipmentApprovals: 0,
  timesheetsApprovals: 0,
  accountingApprovals: 0,
  payslipTemplates: 0,
  workShifts: 0,
  daysOff: 0,
  retirementProcedures: 0,
};

/** One registered counter's answer for one department: its key, its noun and the number. */
export interface RegisteredCount {
  readonly key: string;
  readonly noun: string;
  readonly count: number;
}

/** The names a record shows beside its ids: the manager's and the parent's, `null` when none or unknown. */
export interface DepartmentNames {
  readonly managerName: string | null;
  readonly parentName: string | null;
}

/** No names: what a record shows when it has neither a manager nor a parent. */
export const NO_NAMES: DepartmentNames = { managerName: null, parentName: null };

/** One exported row: the three export columns, as text. */
export interface DepartmentExportRow {
  readonly id: string;
  readonly name: string;
  readonly calendarId: string;
}

/**
 * Each export column's cell over the exported row, keyed by the column name, so the column list in
 * `departments.routes.ts` and what is written under it cannot drift (`satisfies`). All three are text.
 */
export const DEPARTMENTS_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
  calendarId: { value: (row) => row.calendarId },
} as const satisfies Record<
  (typeof DEPARTMENTS_EXPORT_COLUMNS)[number],
  ExportCell<DepartmentExportRow>
>;

/**
 * The registered counters' answers as the wire's `registeredUsage` record, keyed by counter key.
 *
 * @complexity O(r) over the counters
 */
export function registeredRecord(registered: readonly RegisteredCount[]): Record<string, number> {
  return Object.fromEntries(registered.map((entry) => [entry.key, entry.count]));
}

/** An id on the wire: its decimal text, or `null` for none. */
function idText(id: number | null): string | null {
  return id === null ? null : String(id);
}

/**
 * One department on the wire, key by key from the six read columns: the id as text, the calendar
 * id `''` for NULL, the manager and the parent as text or `null`, their names, the counts.
 */
export function toResponse(
  row: DepartmentRow,
  usage: DepartmentUsage,
  registered: readonly RegisteredCount[],
  names: DepartmentNames,
): DepartmentsResponseDto {
  return departmentsResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    hideFromClient: row.hideFromClient,
    calendarId: row.calendarId ?? '',
    managerId: idText(row.managerId),
    managerName: row.managerId === null ? null : names.managerName,
    parentId: idText(row.parentId),
    parentName: row.parentId === null ? null : names.parentName,
    usage: {
      tickets: usage.tickets,
      purchaseRequests: usage.purchaseRequests,
      purchaseOrders: usage.purchaseOrders,
      purchaseContracts: usage.purchaseContracts,
      fafRequests: usage.fafRequests,
      goodsReceipts: usage.goodsReceipts,
      goodsDeliveries: usage.goodsDeliveries,
      fixedEquipmentDeliveries: usage.fixedEquipmentDeliveries,
      assetCodeRequests: usage.assetCodeRequests,
      childDepartments: usage.childDepartments,
      purchaseApprovals: usage.purchaseApprovals,
      fixedEquipmentApprovals: usage.fixedEquipmentApprovals,
      timesheetsApprovals: usage.timesheetsApprovals,
      accountingApprovals: usage.accountingApprovals,
      payslipTemplates: usage.payslipTemplates,
      workShifts: usage.workShifts,
      daysOff: usage.daysOff,
      retirementProcedures: usage.retirementProcedures,
    },
    registeredUsage: registeredRecord(registered),
  });
}

/** One exported row: the id, the name and the calendar id (`''` for NULL); never a count. */
export function toExportRow(row: DepartmentRow): DepartmentExportRow {
  return { id: String(row.id), name: row.name, calendarId: row.calendarId ?? '' };
}

/** The facade's picker shape (D-55): the id and the name, nothing else. */
export function toDepartmentName(row: DepartmentRow): DepartmentName {
  return { departmentId: row.id, name: row.name };
}

/** One member of the staff directory, as the directory answers it. */
type StaffMember = Awaited<ReturnType<DepartmentStaffDirectory['listActive']>>[number];

/**
 * `GET managers` (D-49, the manager picker): the directory's active members in the order it answers
 * them (identity's: the name, then the id), each `{ id, name }` with the staff id as text.
 *
 * @complexity O(n) over the members
 */
export function toManagersResponse(
  members: readonly StaffMember[],
): DepartmentsManagersResponseDto {
  return departmentsManagersResponseSchema.parse({
    data: members.map((member) => ({ id: String(member.staffId), name: member.name })),
  });
}

/**
 * `GET options` (the parent picker): every department in `findAll`'s order (the name, then the
 * id), each `{ id, name, parentId }`; the caller removes the record and its descendants itself.
 *
 * @complexity O(n) over the rows
 */
export function toOptionsResponse(rows: readonly DepartmentRow[]): DepartmentsOptionsResponseDto {
  return departmentsOptionsResponseSchema.parse({
    data: rows.map((row) => ({
      id: String(row.id),
      name: row.name,
      parentId: idText(row.parentId),
    })),
  });
}

@Injectable()
export class DepartmentsTransformer {
  /**
   * The list envelope: each row with its counts (zeros when the map has no entry for the id), the
   * registered counters' answers and the names for its id; the four page fields copied one by one,
   * `exportLimit` and `printLimit` from their one definition.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(
    rows: readonly DepartmentRow[],
    usage: ReadonlyMap<number, DepartmentUsage>,
    registered: ReadonlyMap<number, readonly RegisteredCount[]>,
    names: ReadonlyMap<number, DepartmentNames>,
    meta: ListPageMeta,
  ): DepartmentsListResponseDto {
    return departmentsListResponseSchema.parse({
      data: rows.map((row) =>
        toResponse(
          row,
          usage.get(row.id) ?? NO_DEPARTMENT_USAGE,
          registered.get(row.id) ?? [],
          names.get(row.id) ?? NO_NAMES,
        ),
      ),
      meta: {
        nextCursor: meta.nextCursor,
        prevCursor: meta.prevCursor,
        total: meta.total,
        rangeStart: meta.rangeStart,
        exportLimit: EXPORT_MAX_ROWS,
        printLimit: PRINT_MAX_ROWS,
      },
    });
  }
}
