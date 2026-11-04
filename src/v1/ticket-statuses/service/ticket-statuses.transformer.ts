import { Injectable } from '@nestjs/common';
import type {
  TicketStatusResponseDto,
  TicketStatusesListResponseDto,
} from '../dto/ticket-statuses.dto.js';
import { TICKET_STATUSES_EXPORT_COLUMNS } from '../ticket-statuses.routes.js';
import type { TicketStatus, TicketStatusesPage } from '../model/ticket-statuses.model.js';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS, type ExportCell } from '../../../shared/http/export.js';

export interface TicketStatusExportRow {
  readonly id: string;
  readonly name: string;
  readonly ticket_count: number;
}

export const TICKET_STATUSES_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
  ticket_count: { value: (row) => row.ticket_count },
} as const satisfies Record<
  (typeof TICKET_STATUSES_EXPORT_COLUMNS)[number],
  ExportCell<TicketStatusExportRow>
>;

@Injectable()
export class TicketStatusesTransformer {
  toResponse(row: TicketStatus): TicketStatusResponseDto {
    return {
      ticketstatusid: String(row.ticketstatusid),
      name: row.name,
      isdefault: row.isdefault,
      statuscolor: row.statuscolor,
      statusorder: row.statusorder,
      ticket_count: row.ticket_count,
    };
  }

  toListResponse(page: TicketStatusesPage): TicketStatusesListResponseDto {
    return {
      data: page.items.map((row) => this.toResponse(row)),
      meta: {
        nextCursor: page.nextCursor,
        prevCursor: page.prevCursor,
        total: page.total,
        rangeStart: page.rangeStart,
        exportLimit: EXPORT_MAX_ROWS,
        printLimit: PRINT_MAX_ROWS,
      },
    };
  }

  toExportRow(row: TicketStatus): TicketStatusExportRow {
    return { id: String(row.ticketstatusid), name: row.name, ticket_count: row.ticket_count };
  }
}
