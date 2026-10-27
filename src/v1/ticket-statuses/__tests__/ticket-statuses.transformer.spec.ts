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
  ticket_count: 0,
};

describe('TicketStatusesTransformer', () => {
  const transformer = new TicketStatusesTransformer();

  it('stringifies the primary key and preserves stored Perfex fields', () => {
    expect(transformer.toResponse(row)).toEqual({
      ticketstatusid: '7',
      name: 'In progress',
      isdefault: 0,
      statuscolor: '#12abEF',
      statusorder: 2,
      ticket_count: 0,
    });
  });

  it('wraps a full list without adding pagination metadata', () => {
    expect(transformer.toListResponse([row])).toEqual({ data: [transformer.toResponse(row)] });
    expect(transformer.toResponse({ ...row, statuscolor: null, statusorder: null })).toMatchObject({
      statuscolor: null,
      statusorder: null,
    });
  });

  it('exports only the Ticket Statuses list columns', () => {
    const exported = transformer.toExportRow(row);
    expect(exported).toEqual({ id: '7', name: 'In progress' });
    expect(TICKET_STATUSES_EXPORT_CELLS.id.value(exported)).toBe('7');
    expect(TICKET_STATUSES_EXPORT_CELLS.name.value(exported)).toBe('In progress');
    expect(Object.keys(TICKET_STATUSES_EXPORT_CELLS)).toEqual(['id', 'name']);
  });
});
