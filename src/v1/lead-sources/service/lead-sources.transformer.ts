/**
 * Transformer: the export rows and entity to response DTO. Every DTO is built field by field and
 * then parsed through its zod response schema, which strips any key the schema does not name, so
 * nothing the wire shape does not declare can ride along (T-2-14). The controller never imports
 * this file (BE-08).
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import type { ListPageMeta } from '../../../shared/http/keyset.js';
import { LEAD_SOURCES_EXPORT_COLUMNS } from '../lead-sources.routes.js';
import {
  leadSourcesListResponseSchema,
  leadSourcesResponseSchema,
  type LeadSourcesListResponseDto,
  type LeadSourcesResponseDto,
} from '../dto/lead-sources.dto.js';
import type { LeadSource, LeadSourceRow, LeadSourceUsage } from '../model/lead-sources.model.js';

/** The counts a lead source answers when the usage map has no entry for its id. */
export const NO_LEAD_SOURCE_USAGE: LeadSourceUsage = {
  leads: 0,
  emailIntegrations: 0,
  webToLeadForms: 0,
};

/** One exported row: the export columns. */
export interface LeadSourceExportRow {
  readonly id: string;
  readonly name: string;
  readonly totalLeads: number;
}

/**
 * Each export column's cell over the exported row, keyed by the column name, so the column list in
 * `lead-sources.routes.ts` and what is written under it cannot drift (`satisfies`).
 */
export const LEAD_SOURCES_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
  totalLeads: { value: (row) => row.totalLeads },
} as const satisfies Record<
  (typeof LEAD_SOURCES_EXPORT_COLUMNS)[number],
  ExportCell<LeadSourceExportRow>
>;

/** One lead source on the wire: the id as text, the stored name, its usage. */
export function toResponse(row: LeadSourceRow, usage: LeadSourceUsage): LeadSourcesResponseDto {
  return leadSourcesResponseSchema.parse({
    id: String(row.id),
    name: row.name,
    usage,
  });
}

/** One exported row: the id as text, the name, and its total lead usage. */
export function toExportRow(
  row: LeadSourceRow,
  usage: LeadSourceUsage = NO_LEAD_SOURCE_USAGE,
): LeadSourceExportRow {
  return {
    id: String(row.id),
    name: row.name,
    totalLeads: usage.leads + usage.emailIntegrations + usage.webToLeadForms,
  };
}

/** The facade's shape: `{ id, name }`. */
export function toLeadSource(row: LeadSourceRow): LeadSource {
  return { id: row.id, name: row.name };
}

@Injectable()
export class LeadSourcesTransformer {
  /** One record: `toResponse` with the usage the map holds for it (zeros when none). */
  toResponse(
    row: LeadSourceRow,
    usage: ReadonlyMap<number, LeadSourceUsage>,
  ): LeadSourcesResponseDto {
    return toResponse(row, usage.get(row.id) ?? NO_LEAD_SOURCE_USAGE);
  }

  /**
   * The list envelope: each row with its usage (zeros when the map has no entry for the id), the
   * four page fields copied one by one, `exportLimit` and `printLimit` from their one definition.
   *
   * @complexity O(n) over the page's rows
   */
  toListResponse(
    rows: readonly LeadSourceRow[],
    usage: ReadonlyMap<number, LeadSourceUsage>,
    meta: ListPageMeta,
  ): LeadSourcesListResponseDto {
    return leadSourcesListResponseSchema.parse({
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
