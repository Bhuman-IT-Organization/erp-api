import { Injectable } from '@nestjs/common';

import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';

import type { ExportCell } from '../../../shared/http/export.js';

import { LEAD_STATUSES_EXPORT_COLUMNS } from '../lead-statuses.routes.js';

import {
  leadStatusesListResponseSchema,
  leadStatusesResponseSchema,
  type LeadStatusesListResponseDto,
  type LeadStatusesResponseDto,
} from '../dto/lead-statuses.dto.js';

import type { LeadStatus, LeadStatusRow, LeadStatusUsage } from '../model/lead-statuses.model.js';

export interface LeadStatusExportRow {
  readonly id: string;
  readonly name: string;
  readonly statusorder: number | null;
  readonly color: string | null;
  readonly isdefault: number;
}

export const LEAD_STATUSES_EXPORT_CELLS = {
  id: {
    value: (row) => row.id,
  },
  name: {
    value: (row) => row.name,
  },
  statusorder: {
    value: (row) => row.statusorder,
  },
  color: {
    value: (row) => row.color,
  },
  isdefault: {
    value: (row) => row.isdefault,
  },
} as const satisfies Record<
  (typeof LEAD_STATUSES_EXPORT_COLUMNS)[number],
  ExportCell<LeadStatusExportRow>
>;

export function toExportRow(row: LeadStatusRow): LeadStatusExportRow {
  return {
    id: String(row.id),
    name: row.name,
    statusorder: row.statusorder,
    color: row.color,
    isdefault: row.isdefault,
  };
}

/** Default usage when a status has no references. */
export const NO_LEAD_STATUS_USAGE: LeadStatusUsage = {
  leads: 0,
  emailIntegration: 0,
};

/** Convert one database record into an API response. */
export function toResponse(
  row: LeadStatusRow,
  usage: LeadStatusUsage,
  configuredDefaultId: number | null,
): LeadStatusesResponseDto {
  return leadStatusesResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    statusorder: row.statusorder,
    color: row.color,
    isdefault: row.isdefault,
    usage,
    isConfiguredDefault: configuredDefaultId === row.id,
  });
}

/** Convert a database record into a public facade entity. */
export function toLeadStatus(row: LeadStatusRow): LeadStatus {
  return {
    id: row.id,
    name: row.name,
    statusorder: row.statusorder,
    color: row.color,
    isdefault: row.isdefault,
  };
}

@Injectable()
export class LeadStatusesTransformer {
  /** Convert one record for the API. */
  toResponse(
    row: LeadStatusRow,
    usage: ReadonlyMap<number, LeadStatusUsage>,
    configuredDefaultId: number | null,
  ): LeadStatusesResponseDto {
    return toResponse(row, usage.get(row.id) ?? NO_LEAD_STATUS_USAGE, configuredDefaultId);
  }

  /** Convert a page of records into the API list response. */
  toListResponse(
    rows: readonly LeadStatusRow[],
    usage: ReadonlyMap<number, LeadStatusUsage>,
    configuredDefaultId: number | null,
    meta: ListPageMeta,
  ): LeadStatusesListResponseDto {
    return leadStatusesListResponseSchema.parse({
      data: rows.map((row) => this.toResponse(row, usage, configuredDefaultId)),
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
