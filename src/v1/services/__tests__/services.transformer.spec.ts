import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import {
  SERVICES_EXPORT_CELLS,
  ServicesTransformer,
  toExportRow,
  toResponse,
  toService,
} from '../service/services.transformer.js';

describe('services transformer', () => {
  it('answers the id as text and the stored name', () => {
    expect(toResponse({ id: 5, name: 'Support' })).toEqual({ id: '5', name: 'Support' });
  });

  it('hands the facade { id, name } with a numeric id', () => {
    expect(toService({ id: 5, name: 'Support' })).toEqual({ id: 5, name: 'Support' });
  });

  it('builds an export row: the id as text and the name', () => {
    expect(toExportRow({ id: 9, name: 'Gold' })).toEqual({ id: '9', name: 'Gold' });
  });

  it('has one export cell per export column, reading the exported row', () => {
    const row = { id: '9', name: 'Gold' };
    expect(Object.keys(SERVICES_EXPORT_CELLS)).toEqual(['id', 'name']);
    expect(SERVICES_EXPORT_CELLS.id.value(row)).toBe('9');
    expect(SERVICES_EXPORT_CELLS.name.value(row)).toBe('Gold');
  });

  it('builds the list envelope: data, the four page fields and both export limits', () => {
    const response = new ServicesTransformer().toListResponse(
      [
        { id: 2, name: 'B' },
        { id: 1, name: 'A' },
      ],
      { nextCursor: null, prevCursor: null, total: 2, rangeStart: 1 },
    );
    expect(response.data).toEqual([
      { id: '2', name: 'B' },
      { id: '1', name: 'A' },
    ]);
    expect(response.meta).toEqual({
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });

  it('answers an empty page as an empty data array', () => {
    const response = new ServicesTransformer().toListResponse([], {
      nextCursor: null,
      prevCursor: null,
      total: 0,
      rangeStart: 0,
    });
    expect(response.data).toEqual([]);
    expect(response.meta.total).toBe(0);
  });
});
