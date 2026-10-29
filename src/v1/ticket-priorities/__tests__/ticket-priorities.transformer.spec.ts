import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { TicketPrioritiesPage, TicketPriority } from '../model/ticket-priority.model.js';
import {
  TICKET_PRIORITIES_EXPORT_CELLS,
  TicketPrioritiesTransformer,
  toExportRow,
  toResponse,
} from '../service/ticket-priorities.transformer.js';

describe('ticket-priorities transformer', () => {
  const row: TicketPriority = { id: 7, name: 'Urgent' };
  const transformer = new TicketPrioritiesTransformer();

  it('turns the numeric id into a string and keeps the name', () => {
    expect(toResponse(row)).toEqual({ id: '7', name: 'Urgent' });
    expect(transformer.toResponse(row)).toEqual({ id: '7', name: 'Urgent' });
  });

  it('builds an export row with the same two fields', () => {
    expect(toExportRow(row)).toEqual({ id: '7', name: 'Urgent' });
  });

  it('reads each export cell from the export row', () => {
    const exportRow = toExportRow(row);
    expect(TICKET_PRIORITIES_EXPORT_CELLS.id.value(exportRow)).toBe('7');
    expect(TICKET_PRIORITIES_EXPORT_CELLS.name.value(exportRow)).toBe('Urgent');
  });

  it('builds the list envelope with the page fields and both limits', () => {
    const page = {
      items: [row, { id: 8, name: 'Low' }],
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
    } as TicketPrioritiesPage;

    expect(transformer.toListResponse(page)).toEqual({
      data: [
        { id: '7', name: 'Urgent' },
        { id: '8', name: 'Low' },
      ],
      meta: {
        nextCursor: null,
        prevCursor: null,
        total: 2,
        rangeStart: 1,
        exportLimit: EXPORT_MAX_ROWS,
        printLimit: PRINT_MAX_ROWS,
      },
    });
  });

  it('builds an empty envelope for an empty page', () => {
    const page = {
      items: [],
      nextCursor: null,
      prevCursor: null,
      total: 0,
      rangeStart: 0,
    } as TicketPrioritiesPage;

    expect(transformer.toListResponse(page).data).toEqual([]);
  });
});
