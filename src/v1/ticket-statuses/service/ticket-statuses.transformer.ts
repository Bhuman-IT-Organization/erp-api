import { Injectable } from '@nestjs/common';
import type {
  TicketStatusResponseDto,
  TicketStatusesListResponseDto,
} from '../dto/ticket-statuses.dto.js';
import { TICKET_STATUSES_EXPORT_COLUMNS } from '../ticket-statuses.routes.js';
import type { TicketStatus } from '../model/ticket-statuses.model.js';
import type { ExportCell } from '../../../shared/http/export.js';

export interface TicketStatusExportRow {
  readonly id: string;
  readonly name: string;
}

export const TICKET_STATUSES_EXPORT_CELLS = {
  id: { value: (row) => row.id },
  name: { value: (row) => row.name },
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

  toListResponse(rows: readonly TicketStatus[]): TicketStatusesListResponseDto {
    return { data: rows.map((row) => this.toResponse(row)) };
  }

  toExportRow(row: TicketStatus): TicketStatusExportRow {
    return { id: String(row.ticketstatusid), name: row.name };
  }
}
