import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { CustomerGroupRow } from '../model/customer-groups.model.js';
import {
  CUSTOMER_GROUPS_EXPORT_CELLS,
  CustomerGroupsTransformer,
  toCustomerGroup,
  toExportRow,
  toResponse,
} from '../service/customer-groups.transformer.js';

const ROW: CustomerGroupRow = { id: 1, name: 'VIP' };
const OTHER: CustomerGroupRow = { id: 2, name: 'Gold' };

describe('toResponse', () => {
  it('writes the id as text and the name as stored', () => {
    expect(toResponse(ROW)).toEqual({ id: '1', name: 'VIP' });
  });

  it('answers nothing the wire shape does not name', () => {
    const row = { ...ROW, secret: 'x' } as CustomerGroupRow;
    expect(Object.keys(toResponse(row)).sort()).toEqual(['id', 'name']);
  });
});

describe('CustomerGroupsTransformer.toListResponse', () => {
  const transformer = new CustomerGroupsTransformer();

  it('wraps the rows and copies the page fields plus the export and print limits', () => {
    const response = transformer.toListResponse([OTHER, ROW], {
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
    });
    expect(response.data).toEqual([
      { id: '2', name: 'Gold' },
      { id: '1', name: 'VIP' },
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

  it('keeps the cursors it is given', () => {
    const response = transformer.toListResponse([ROW], {
      nextCursor: 'next',
      prevCursor: 'prev',
      total: 5,
      rangeStart: 3,
    });
    expect(response.meta.nextCursor).toBe('next');
    expect(response.meta.prevCursor).toBe('prev');
    expect(response.meta.rangeStart).toBe(3);
  });
});

describe('export rows', () => {
  it('toExportRow writes the id as text and the name', () => {
    expect(toExportRow(ROW)).toEqual({ id: '1', name: 'VIP' });
  });

  it('each export cell reads its own column of the exported row', () => {
    const exported = toExportRow(ROW);
    expect(CUSTOMER_GROUPS_EXPORT_CELLS.id.value(exported)).toBe('1');
    expect(CUSTOMER_GROUPS_EXPORT_CELLS.name.value(exported)).toBe('VIP');
  });
});

describe('toCustomerGroup', () => {
  it('is the facade shape: the numeric id and the name', () => {
    expect(toCustomerGroup(ROW)).toEqual({ id: 1, name: 'VIP' });
  });
});
