import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type {
  FixedEquipmentDepreciationRow,
  FixedEquipmentDepreciationsPage,
} from '../model/fixed-equipment-depreciations.model.js';
import {
  FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_CELLS,
  FixedEquipmentDepreciationsTransformer,
  toExportRow,
  toFixedEquipmentDepreciation,
  toResponse,
} from '../service/fixed-equipment-depreciations.transformer.js';

describe('fixed-equipment-depreciations transformer', () => {
  const row: FixedEquipmentDepreciationRow = {
    id: 7,
    name: 'Straight line',
    term: 60,
    creatorId: 3,
  };
  const legacy: FixedEquipmentDepreciationRow = {
    id: 8,
    name: 'Legacy',
    term: null,
    creatorId: null,
  };
  const transformer = new FixedEquipmentDepreciationsTransformer();

  it('turns the id into a string, keeps the name and the term, and never sends the creator', () => {
    expect(toResponse(row)).toEqual({ id: '7', name: 'Straight line', term: 60 });
    expect(transformer.toResponse(row)).toEqual({ id: '7', name: 'Straight line', term: 60 });
    expect(toResponse(legacy)).toEqual({ id: '8', name: 'Legacy', term: null });
  });

  it('maps a stored row to the model other modules see: id, name and term, never the creator', () => {
    expect(toFixedEquipmentDepreciation(row)).toEqual({ id: 7, name: 'Straight line', term: 60 });
    expect(toFixedEquipmentDepreciation(legacy)).toEqual({ id: 8, name: 'Legacy', term: null });
    expect(Object.keys(toFixedEquipmentDepreciation(row)).sort()).toEqual(['id', 'name', 'term']);
  });

  it('builds an export row: the id as text, the name, and the term as stored (null for none, so ?blank= applies)', () => {
    expect(toExportRow(row)).toEqual({ id: '7', name: 'Straight line', term: 60 });
    expect(toExportRow(legacy)).toEqual({ id: '8', name: 'Legacy', term: null });
  });

  it('reads each export cell from the export row; a missing term stays null for the blank label', () => {
    const exportRow = toExportRow(row);
    expect(FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_CELLS.id.value(exportRow)).toBe('7');
    expect(FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_CELLS.name.value(exportRow)).toBe('Straight line');
    expect(FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_CELLS.term.value(exportRow)).toBe(60);
    expect(FIXED_EQUIPMENT_DEPRECIATIONS_EXPORT_CELLS.term.value(toExportRow(legacy))).toBeNull();
  });

  it('builds the list envelope with the page fields and both limits', () => {
    const page: FixedEquipmentDepreciationsPage = {
      items: [row, legacy],
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
    };

    expect(transformer.toListResponse(page)).toEqual({
      data: [
        { id: '7', name: 'Straight line', term: 60 },
        { id: '8', name: 'Legacy', term: null },
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
    const page: FixedEquipmentDepreciationsPage = {
      items: [],
      nextCursor: null,
      prevCursor: null,
      total: 0,
      rangeStart: 0,
    };

    expect(transformer.toListResponse(page).data).toEqual([]);
  });
});
