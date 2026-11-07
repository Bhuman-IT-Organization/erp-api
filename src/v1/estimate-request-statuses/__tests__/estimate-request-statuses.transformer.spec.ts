import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { EstimateRequestStatusRow } from '../model/estimate-request-statuses.model.js';
import {
  ESTIMATE_REQUEST_STATUSES_EXPORT_CELLS,
  EstimateRequestStatusesTransformer,
} from '../service/estimate-request-statuses.transformer.js';

const ROW: EstimateRequestStatusRow = {
  id: 8,
  name: 'Ready',
  color: '#757575',
  statusorder: 2,
  flag: null,
  total_request: 4,
};

describe('EstimateRequestStatusesTransformer', () => {
  it('preserves the web response contract and stringifies the id', () => {
    expect(new EstimateRequestStatusesTransformer().toResponse(ROW)).toEqual({
      id: '8',
      name: 'Ready',
      color: '#757575',
      statusorder: 2,
      flag: null,
      total_request: 4,
    });
  });

  it('builds list metadata and export columns in frontend order', () => {
    const transformer = new EstimateRequestStatusesTransformer();
    expect(
      transformer.toListResponse([ROW], {
        nextCursor: null,
        prevCursor: null,
        total: 1,
        rangeStart: 1,
      }).meta,
    ).toEqual({
      nextCursor: null,
      prevCursor: null,
      total: 1,
      rangeStart: 1,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
    const exported = transformer.toExportRow(ROW);
    expect(exported).toEqual({ id: '8', name: 'Ready', total_request: 4 });
    expect(Object.keys(ESTIMATE_REQUEST_STATUSES_EXPORT_CELLS)).toEqual([
      'id',
      'name',
      'total_request',
    ]);
    expect(ESTIMATE_REQUEST_STATUSES_EXPORT_CELLS.total_request.value(exported)).toBe(4);
  });
});
