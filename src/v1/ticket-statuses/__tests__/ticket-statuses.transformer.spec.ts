import { describe, expect, it } from 'vitest';
import type { TicketStatus } from '../model/ticket-statuses.model.js';
import {
  TICKET_STATUSES_EXPORT_CELLS,
  TicketStatusesTransformer,
} from '../service/ticket-statuses.transformer.js';

const row: TicketStatus = {
  ticketstatusid: 7,
  name: 'In progress',
  isdefault: 0,
  statuscolor: '#12abEF',
  statusorder: 2,
  ticket_count: 3,
};

describe('TicketStatusesTransformer', () => {
  const transformer = new TicketStatusesTransformer();

  it('stringifies the primary key and keeps ticket counts on the wire', () => {
    expect(transformer.toResponse(row)).toEqual({
      ticketstatusid: '7',
      name: 'In progress',
      isdefault: 0,
      statuscolor: '#12abEF',
      statusorder: 2,
      ticket_count: 3,
    });
  });

  it('wraps a full list with standard pagination metadata', () => {
    const page = {
      items: [row],
      nextCursor: 'next',
      prevCursor: null,
      total: 12,
      rangeStart: 1,
    };
    expect(transformer.toListResponse(page)).toMatchObject({
      data: [transformer.toResponse(row)],
      meta: {
        nextCursor: 'next',
        prevCursor: null,
        total: 12,
        rangeStart: 1,
      },
    });
    expect(transformer.toListResponse(page).meta.exportLimit).toBeGreaterThan(0);
    expect(transformer.toListResponse(page).meta.printLimit).toBeGreaterThan(0);
  });

  it('exports the ticket count column too', () => {
    const exported = transformer.toExportRow(row);
    expect(exported).toEqual({ id: '7', name: 'In progress', ticket_count: 3 });
    expect(TICKET_STATUSES_EXPORT_CELLS.id.value(exported)).toBe('7');
    expect(TICKET_STATUSES_EXPORT_CELLS.name.value(exported)).toBe('In progress');
    expect(TICKET_STATUSES_EXPORT_CELLS.ticket_count.value(exported)).toBe(3);
  });
});
