/**
 * Transformer: entity to response DTO and the export rows. Every DTO is built field by field and
 * parsed through its zod schema, so nothing the wire shape does not declare can ride along. The
 * controller never imports this file (BE-08).
 */
import { Injectable } from '@nestjs/common';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';
import { TICKET_PRIORITIES_EXPORT_COLUMNS } from '../ticket-priorities.routes.js';
import {
  ticketPrioritiesListResponseSchema,
  ticketPrioritiesResponseSchema,
  type TicketPrioritiesListResponseDto,
  type TicketPrioritiesResponseDto,
} from '../dto/ticket-priorities.dto.js';
import type { TicketPriority, TicketPrioritiesPage } from '../model/ticket-priorities.model.js';

export interface TicketPriorityExportRow {
  readonly id: string;
  readonly name: string;
}

export const TICKET_PRIORITIES_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
} as const satisfies Record<
  (typeof TICKET_PRIORITIES_EXPORT_COLUMNS)[number],
  ExportCell<TicketPriorityExportRow>
>;

export function toResponse(row: TicketPriority): TicketPrioritiesResponseDto {
  return ticketPrioritiesResponseSchema.parse({ id: String(row.id), name: row.name });
}

export function toExportRow(row: TicketPriority): TicketPriorityExportRow {
  return { id: String(row.id), name: row.name };
}

@Injectable()
export class TicketPrioritiesTransformer {
  toResponse(row: TicketPriority): TicketPrioritiesResponseDto {
    return toResponse(row);
  }

  /** The list envelope: the four page fields copied one by one, plus the two limits. */
  toListResponse(page: TicketPrioritiesPage): TicketPrioritiesListResponseDto {
    return ticketPrioritiesListResponseSchema.parse({
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
