/**
 * Transformer: the export rows and entity to response DTO. Every DTO is
 * built field by field and then parsed through its zod response schema, which strips any key the
 * schema does not name, so nothing the wire shape does not declare can ride along (T-2-14): the
 * row's `created_by` is never answered. The controller never imports this file (BE-08).
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import { CONTRACT_TYPES_EXPORT_COLUMNS } from '../contract-types.routes.js';
import {
  contractTypesListResponseSchema,
  contractTypesResponseSchema,
  type ContractTypesListResponseDto,
  type ContractTypesResponseDto,
} from '../dto/contract-types.dto.js';
import type {
  ContractType,
  ContractTypeRow,
  ContractTypeUsage,
} from '../model/contract-types.model.js';

/** The counts a contract type answers when the usage map has no entry for its id. */
export const NO_CONTRACT_TYPE_USAGE: ContractTypeUsage = {
  contracts: 0,
};

/** One exported row: the export columns (name, contracts). */
export interface ContractTypeExportRow {
  readonly name: string;
  readonly contracts: number;
}

/**
 * Each export column's cell over the exported row, keyed by the column name.
 */
export const CONTRACT_TYPES_EXPORT_CELLS = {
  name: { value: (row) => row.name },
  contracts: { value: (row) => row.contracts },
} as const satisfies Record<
  (typeof CONTRACT_TYPES_EXPORT_COLUMNS)[number],
  ExportCell<ContractTypeExportRow>
>;

/** One contract type on the wire: the id as text, the stored name, its usage. */
export function toResponse(
  row: ContractTypeRow,
  usage: ContractTypeUsage,
): ContractTypesResponseDto {
  return contractTypesResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    usage,
  });
}

/** One exported row: the name and contracts count. */
export function toExportRow(row: ContractTypeRow, usage: ContractTypeUsage): ContractTypeExportRow {
  return {
    name: row.name,
    contracts: usage.contracts,
  };
}

/** The facade's shape: `{ id, name }`, never the wire DTO, never `created_by`. */
export function toContractType(row: ContractTypeRow): ContractType {
  return { id: row.id, name: row.name };
}

@Injectable()
export class ContractTypesTransformer {
  /** One record: `toResponse` with the usage the map holds for it (zeros when none). */
  toResponse(
    row: ContractTypeRow,
    usage: ReadonlyMap<number, ContractTypeUsage>,
  ): ContractTypesResponseDto {
    return toResponse(row, usage.get(row.id) ?? NO_CONTRACT_TYPE_USAGE);
  }

  toListResponse(
    rows: readonly ContractTypeRow[],
    usage: ReadonlyMap<number, ContractTypeUsage>,
    meta: ListPageMeta,
  ): ContractTypesListResponseDto {
    return contractTypesListResponseSchema.parse({
      data: rows.map((row) => this.toResponse(row, usage)),
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
