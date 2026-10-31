/**
 * Transformer: entity to response DTO and the export rows. Every DTO is built field by field and
 * parsed through its zod schema, so nothing the wire shape does not declare can ride along. The
 * controller never imports this file (BE-08).
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import {
  fixedEquipmentDepreciationsListResponseSchema,
  fixedEquipmentDepreciationsResponseSchema,
  type FixedEquipmentDepreciationsListResponseDto,
  type FixedEquipmentDepreciationsResponseDto,
} from '../dto/fixed-equipment-depreciations.dto.js';
import { FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_COLUMNS } from '../fixed-equipment-depreciations.routes.js';
import type {
  FixedEquipmentDepreciation,
  FixedEquipmentDepreciationsPage,
} from '../model/fixed-equipment-depreciations.model.js';

export interface FixedEquipmentDepreciationExportRow {
  readonly id: string;
  readonly name: string;
  /** The number of months as text; empty for a row stored without one. */
  readonly term: string;
}

export const FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
  term: { value: (row) => row.term },
} as const satisfies Record<
  (typeof FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_COLUMNS)[number],
  ExportCell<FixedEquipmentDepreciationExportRow>
>;

/** The creator never reaches the wire: it only scopes the reads. */
export function toResponse(
  row: FixedEquipmentDepreciation,
): FixedEquipmentDepreciationsResponseDto {
  return fixedEquipmentDepreciationsResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    term: row.term,
  });
}

export function toExportRow(row: FixedEquipmentDepreciation): FixedEquipmentDepreciationExportRow {
  return { id: String(row.id), name: row.name, term: row.term === null ? '' : String(row.term) };
}

@Injectable()
export class FixedEquipmentDepreciationsTransformer {
  toResponse(row: FixedEquipmentDepreciation): FixedEquipmentDepreciationsResponseDto {
    return toResponse(row);
  }

  /** The list envelope: the four page fields copied one by one, plus the two limits. */
  toListResponse(
    page: FixedEquipmentDepreciationsPage,
  ): FixedEquipmentDepreciationsListResponseDto {
    return fixedEquipmentDepreciationsListResponseSchema.parse({
      data: page.items.map((row) => toResponse(row)),
      meta: {
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor,
        total: page.total,
        rangeStart: page.rangeStart,
        exportLimit: EXPORT_MAX_ROWS,
        printLimit: PRINT_MAX_ROWS,
      },
    });
  }
}
