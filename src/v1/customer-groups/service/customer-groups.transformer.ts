/**
 * Transformer: entity to response DTO and the export rows. Every DTO is built field by field and
 * then parsed through its zod response schema, which strips any key the schema does not name. The
 * controller never imports this file (BE-08).
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import { CUSTOMER_GROUPS_EXPORT_COLUMNS } from '../customer-groups.routes.js';
import {
  customerGroupsListResponseSchema,
  customerGroupsResponseSchema,
  type CustomerGroupsListResponseDto,
  type CustomerGroupsResponseDto,
} from '../dto/customer-groups.dto.js';
import type { CustomerGroup, CustomerGroupRow } from '../model/customer-groups.model.js';

/** One customer group on the wire: the id as text and the stored name. */
export function toResponse(row: CustomerGroupRow): CustomerGroupsResponseDto {
  return customerGroupsResponseSchema.parse({
    id: String(row.id),
    name: row.name,
  });
}

/** One exported row: the id as text and the name. */
export interface CustomerGroupExportRow {
  readonly id: string;
  readonly name: string;
}

/**
 * Each export column's cell over the exported row, keyed by the column name, so the column list in
 * `customer-groups.routes.ts` and what is written under it cannot drift (`satisfies`).
 */
export const CUSTOMER_GROUPS_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
} as const satisfies Record<
  (typeof CUSTOMER_GROUPS_EXPORT_COLUMNS)[number],
  ExportCell<CustomerGroupExportRow>
>;

/** One exported row: the id as text and the name. */
export function toExportRow(row: CustomerGroupRow): CustomerGroupExportRow {
  return { id: String(row.id), name: row.name };
}

/** The facade's shape: `{ id, name }`, never the wire DTO. */
export function toCustomerGroup(row: CustomerGroupRow): CustomerGroup {
  return { id: row.id, name: row.name };
}

@Injectable()
export class CustomerGroupsTransformer {
  /** One record. */
  toResponse(row: CustomerGroupRow): CustomerGroupsResponseDto {
    return toResponse(row);
  }

  /**
   * The list envelope: each row, the four page fields copied one by one, and `exportLimit` and
   * `printLimit` from their one definition.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(
    rows: readonly CustomerGroupRow[],
    meta: ListPageMeta,
  ): CustomerGroupsListResponseDto {
    return customerGroupsListResponseSchema.parse({
      data: rows.map((row) => this.toResponse(row)),
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
