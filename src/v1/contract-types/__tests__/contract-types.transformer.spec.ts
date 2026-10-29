/**
 * The export rows and cells, and the DTOs: the id as a string, the stored name,
 * the usage on every row, never `created_by`; the facade's `{ id, name }`.
 */
import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { ContractTypeRow, ContractTypeUsage } from '../model/contract-types.model.js';
import {
  CONTRACT_TYPES_EXPORT_CELLS,
  ContractTypesTransformer,
  NO_CONTRACT_TYPE_USAGE,
  toContractType,
  toExportRow,
  toResponse,
} from '../service/contract-types.transformer.js';

const ROW: ContractTypeRow = {
  id: 7,
  name: 'Fixed-Term',
};
const OTHER: ContractTypeRow = { id: 8, name: 'Permanent' };
const USED: ContractTypeUsage = { contracts: 2, goals: 0 };
const META = { nextCursor: 'n', prevCursor: null, total: 3, rangeStart: 1 };

describe('the response, the export rows and the facade shape', () => {
  it('toResponse writes String(id), the stored name, and the usage', () => {
    const dto = toResponse(ROW, USED);
    expect(dto).toEqual({
      id: '7',
      name: 'Fixed-Term',
      usage: USED,
    });
    expect(JSON.stringify(dto)).not.toContain('createdBy');
    expect(JSON.stringify(dto)).not.toContain('created_by');
  });

  it('the export row and its cells: name and contracts', () => {
    const row = toExportRow(ROW, USED);
    expect(row).toEqual({ name: 'Fixed-Term', contracts: 2 });
    expect(CONTRACT_TYPES_EXPORT_CELLS.name.value(row)).toBe('Fixed-Term');
    expect(CONTRACT_TYPES_EXPORT_CELLS.contracts.value(row)).toBe(2);
    expect(Object.keys(CONTRACT_TYPES_EXPORT_CELLS)).toEqual(['name', 'contracts']);
  });

  it('toContractType maps { id, name } only', () => {
    expect(toContractType(ROW)).toEqual({ id: 7, name: 'Fixed-Term' });
  });

  it('the class reads the usage map (zeros for an absent id) and builds the list envelope', () => {
    const transformer = new ContractTypesTransformer();
    const usage = new Map([[7, USED]]);
    expect(transformer.toResponse(ROW, usage).usage).toEqual(USED);
    expect(transformer.toResponse(OTHER, usage).usage).toEqual(NO_CONTRACT_TYPE_USAGE);
    const list = transformer.toListResponse([ROW, OTHER], usage, META);
    expect(list.data.map((row) => [row.id, row.name, row.usage.contracts])).toEqual([
      ['7', 'Fixed-Term', 2],
      ['8', 'Permanent', 0],
    ]);
    expect(list.meta).toEqual({
      ...META,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });
});
