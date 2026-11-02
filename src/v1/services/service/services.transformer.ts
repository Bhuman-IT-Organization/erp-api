/**
 * Transformer: entity to response DTO and the export rows. Every DTO is built field by field and
 * parsed through its zod response schema, which strips any key the schema does not name. The
 * controller never imports this file (BE-08).
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import {
  servicesListResponseSchema,
  servicesResponseSchema,
  type ServicesListResponseDto,
  type ServicesResponseDto,
} from '../dto/services.dto.js';
import type { Service, ServiceRow } from '../model/services.model.js';
import { SERVICES_EXPORT_COLUMNS } from '../services.routes.js';

/** One exported row: the two export columns, the id as text. */
export interface ServiceExportRow {
  readonly id: string;
  readonly name: string;
}

/**
 * Each export column's cell over the exported row, keyed by the column name, so the column list in
 * `services.routes.ts` and what is written under it cannot drift (`satisfies`).
 */
export const SERVICES_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
} as const satisfies Record<(typeof SERVICES_EXPORT_COLUMNS)[number], ExportCell<ServiceExportRow>>;

/** One service on the wire: the id as text and the stored name. */
export function toResponse(row: ServiceRow): ServicesResponseDto {
  return servicesResponseSchema.parse({ id: String(row.id), name: row.name });
}

/** One exported row: the id as text and the name. */
export function toExportRow(row: ServiceRow): ServiceExportRow {
  return { id: String(row.id), name: row.name };
}

/** The facade's shape: `{ id, name }`, never the wire DTO. */
export function toService(row: ServiceRow): Service {
  return { id: row.id, name: row.name };
}

@Injectable()
export class ServicesTransformer {
  toResponse(row: ServiceRow): ServicesResponseDto {
    return toResponse(row);
  }

  /**
   * The list envelope: the four page fields copied one by one, `exportLimit` and `printLimit`
   * from their one definition.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(rows: readonly ServiceRow[], meta: ListPageMeta): ServicesListResponseDto {
    return servicesListResponseSchema.parse({
      data: rows.map((row) => toResponse(row)),
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
