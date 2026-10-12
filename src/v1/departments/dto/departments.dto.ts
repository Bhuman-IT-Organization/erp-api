/**
 * Request and response DTOs. Types are `z.infer` of the schemas. Every field is written inline
 * (`name: z.string()...`), so each one can be compared field by field with the frontend template's
 * schemas.
 *
 * The list response is BE-19's envelope on the superset meta: `{ data, meta: { nextCursor,
 * prevCursor, total, rangeStart, exportLimit, printLimit } }`. A single resource is a bare body; the
 * request id is never in a body (it travels in the `x-request-id` header). The id is a STRING on the
 * wire; the transformer writes `String(row.id)`.
 *
 * Read only: there is no request body. `tbldepartments` is Perfex's table and Perfex's
 * `admin/departments` screen is its only writer; Node never reads or answers the eight
 * ticket-mailbox columns (D-47).
 */
import { z } from 'zod';
import {
  exportBlankField,
  exportColumnField,
  exportDateFormatField,
  exportFormatField,
  exportHeaderField,
  exportNoField,
  exportTimeFormatField,
  exportTimeZoneField,
  exportTitleField,
  exportYesField,
} from '../../../shared/http/export.js';
import { listPageMetaSchema } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS } from '../../../shared/http/pagination.js';

/** The longest `?q=`; a longer one is a 400 on `q`. */
export const DEPARTMENTS_SEARCH_MAX = 100;

/**
 * `GET /api/v1/departments?limit&cursor&q&sort`: the documented surface. `parseListQuery` in the
 * validator enforces it (the BE-19 grammar, one keyset sort, the cursor bound to that sort).
 */
export const listDepartmentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(LIST_QUERY_LIMITS.min).max(LIST_QUERY_LIMITS.max).optional(),
  /** The previous page's opaque `meta.nextCursor` or `meta.prevCursor`, sent with the same `sort`. */
  cursor: z.string().min(1).optional(),
  /**
   * Search: the name or the calendar id contains `q` (case per the columns' collation); when `q` is
   * all digits and fits the INT id column, also the id equal to it. The mailbox columns are never
   * searched (Perfex's DataTable searched the email: a README parity row).
   */
  q: z.string().max(DEPARTMENTS_SEARCH_MAX).optional(),
  /** `name` (default, Perfex's `[1, 'asc']`), `-name`, `id`, `-id`, `calendarId` or `-calendarId`. */
  sort: z.string().optional(),
});

/**
 * `GET export`: the list query minus `limit` and `cursor` (an export is every row), plus the export
 * parameters of ADR-0043 as literal keys. Documentation only: `parseExportOptions` in
 * `shared/http/export.ts` is the gate. No `key`: the list has no row selection.
 */
export const exportDepartmentsQuerySchema = listDepartmentsQuerySchema
  .omit({ limit: true, cursor: true })
  .extend({
    header: exportHeaderField,
    format: exportFormatField,
    column: exportColumnField,
    title: exportTitleField,
    yes: exportYesField,
    no: exportNoField,
    blank: exportBlankField,
    dateFormat: exportDateFormatField,
    timeFormat: exportTimeFormatField,
    timeZone: exportTimeZoneField,
  });

/** `:id` of the record routes: a non-numeric or non-positive id is a 400, never a 404 probe. */
export const departmentsParamsSchema = z.object({ id: z.coerce.number().int().positive() });

const count = () => z.number().int().nonnegative();

/** What refers to the department, per group of the repository's register (D-51). */
export const departmentUsageSchema = z.object({
  tickets: count(),
  purchaseRequests: count(),
  purchaseOrders: count(),
  purchaseContracts: count(),
  fafRequests: count(),
  goodsReceipts: count(),
  goodsDeliveries: count(),
  fixedEquipmentDeliveries: count(),
  assetCodeRequests: count(),
  childDepartments: count(),
  purchaseApprovals: count(),
  fixedEquipmentApprovals: count(),
  timesheetsApprovals: count(),
  accountingApprovals: count(),
  payslipTemplates: count(),
  workShifts: count(),
  daysOff: count(),
  retirementProcedures: count(),
});

/**
 * One department: the six read columns on the wire (the calendar id `''` for a NULL column, the
 * manager and the parent `null` for a stored 0 or NULL), the manager's name from the staff
 * directory and the parent's name (each `null` when none or unknown), what uses it (`usage`, the
 * register) and what other modules registered (`registeredUsage`, keyed by the counter's key:
 * `staffMembers` today). Exactly these keys: never a mailbox column (D-47).
 */
export const departmentsResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    hideFromClient: z.boolean(),
    calendarId: z.string(),
    managerId: z.string().nullable(),
    managerName: z.string().nullable(),
    parentId: z.string().nullable(),
    parentName: z.string().nullable(),
    usage: departmentUsageSchema,
    registeredUsage: z.record(z.string(), count()),
  })
  .readonly();

/** One list row: the same shape as the record. */
export const departmentsListRowSchema = departmentsResponseSchema;

export const departmentsListResponseSchema = z
  .object({
    data: z.array(departmentsListRowSchema),
    /** The pager's meta, `exportLimit` (CSV and Excel, `EXPORT_MAX_ROWS`) and `printLimit` (PDF and print, `PRINT_MAX_ROWS`). */
    meta: listPageMetaSchema.extend({
      exportLimit: z.number().int().positive(),
      printLimit: z.number().int().positive(),
    }),
  })
  .readonly();

/** `GET managers`: the staff directory's active members, by name then id (D-49, the manager picker). */
export const departmentsManagersResponseSchema = z
  .object({ data: z.array(z.object({ id: z.string(), name: z.string() })) })
  .readonly();

/** `GET options`: every department by name then id, with its parent (the parent picker). */
export const departmentsOptionsResponseSchema = z
  .object({
    data: z.array(z.object({ id: z.string(), name: z.string(), parentId: z.string().nullable() })),
  })
  .readonly();

export type ListDepartmentsQuery = z.infer<typeof listDepartmentsQuerySchema>;
export type DepartmentsParams = z.infer<typeof departmentsParamsSchema>;
export type DepartmentUsageDto = z.infer<typeof departmentUsageSchema>;
export type DepartmentsResponseDto = z.infer<typeof departmentsResponseSchema>;
export type DepartmentsListRowDto = z.infer<typeof departmentsListRowSchema>;
export type DepartmentsListResponseDto = z.infer<typeof departmentsListResponseSchema>;
export type DepartmentsManagersResponseDto = z.infer<typeof departmentsManagersResponseSchema>;
export type DepartmentsOptionsResponseDto = z.infer<typeof departmentsOptionsResponseSchema>;
