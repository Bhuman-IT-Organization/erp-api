import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import { ESTIMATE_REQUEST_STATUSES_EXPORT_COLUMNS } from '../estimate-request-statuses.routes.js';
import {
  estimateRequestStatusResponseSchema,
  estimateRequestStatusesListResponseSchema,
  type EstimateRequestStatusResponseDto,
  type EstimateRequestStatusesListResponseDto,
} from '../dto/estimate-request-statuses.dto.js';
import type { EstimateRequestStatusRow } from '../model/estimate-request-statuses.model.js';

export interface EstimateRequestStatusExportRow {
  readonly id: string;
  readonly name: string;
  readonly total_request: number;
}

export const ESTIMATE_REQUEST_STATUSES_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
  total_request: { value: (row) => row.total_request },
} as const satisfies Record<
  (typeof ESTIMATE_REQUEST_STATUSES_EXPORT_COLUMNS)[number],
  ExportCell<EstimateRequestStatusExportRow>
>;

export function toEstimateRequestStatusResponse(
  row: EstimateRequestStatusRow,
): EstimateRequestStatusResponseDto {
  return estimateRequestStatusResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    color: row.color,
    statusorder: row.statusorder,
    flag: row.flag,
    total_request: row.total_request,
  });
}

@Injectable()
export class EstimateRequestStatusesTransformer {
  toResponse(row: EstimateRequestStatusRow): EstimateRequestStatusResponseDto {
    return toEstimateRequestStatusResponse(row);
  }

  toListResponse(
    rows: readonly EstimateRequestStatusRow[],
    meta: ListPageMeta,
  ): EstimateRequestStatusesListResponseDto {
    return estimateRequestStatusesListResponseSchema.parse({
      data: rows.map((row) => this.toResponse(row)),
      meta: {
        ...meta,
        exportLimit: EXPORT_MAX_ROWS,
        printLimit: PRINT_MAX_ROWS,
      },
    });
  }

  toExportRow(row: EstimateRequestStatusRow): EstimateRequestStatusExportRow {
    return {
      id: String(row.id),
      name: row.name,
      total_request: row.total_request,
    };
  }
}
