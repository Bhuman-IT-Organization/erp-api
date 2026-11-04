import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { LeadSourceRow, LeadSourceUsage } from '../model/lead-sources.model.js';
import {
  LEAD_SOURCES_EXPORT_CELLS,
  LeadSourcesTransformer,
  NO_LEAD_SOURCE_USAGE,
  toExportRow,
  toLeadSource,
  toResponse,
} from '../service/lead-sources.transformer.js';

const ROW: LeadSourceRow = { id: 7, name: 'Web site' };
const USED: LeadSourceUsage = { leads: 3, emailIntegrations: 0, webToLeadForms: 0 };
const META = { nextCursor: 'next', prevCursor: null, total: 3, rangeStart: 1 };

describe('LeadSourcesTransformer', () => {
  it('builds a wire record with a string id and its usage', () => {
    expect(toResponse(ROW, USED)).toEqual({ id: '7', name: 'Web site', usage: USED });
  });

  it('builds export rows and the matching column cells', () => {
    const row = toExportRow(ROW, { ...USED, emailIntegrations: 4, webToLeadForms: 2 });
    expect(row).toEqual({ id: '7', name: 'Web site', totalLeads: 3 });
    expect(LEAD_SOURCES_EXPORT_CELLS.id.value(row)).toBe('7');
    expect(LEAD_SOURCES_EXPORT_CELLS.name.value(row)).toBe('Web site');
    expect(LEAD_SOURCES_EXPORT_CELLS.totalLeads.value(row)).toBe(3);
    expect(Object.keys(LEAD_SOURCES_EXPORT_CELLS)).toEqual(['id', 'name', 'totalLeads']);
    expect(toExportRow(ROW)).toEqual({ id: '7', name: 'Web site', totalLeads: 0 });
  });

  it('maps facade values to id and name only', () => {
    expect(toLeadSource(ROW)).toEqual({ id: 7, name: 'Web site' });
  });

  it('uses zero usage when an id is absent and includes the list limits in the response', () => {
    const transformer = new LeadSourcesTransformer();
    const list = transformer.toListResponse([ROW], new Map(), META);
    expect(list.data).toEqual([{ id: '7', name: 'Web site', usage: NO_LEAD_SOURCE_USAGE }]);
    expect(list.meta).toEqual({
      ...META,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });

  it('uses the supplied usage for list and detail responses', () => {
    const transformer = new LeadSourcesTransformer();
    const usage = new Map([[ROW.id, USED]]);
    expect(transformer.toResponse(ROW, usage).usage).toEqual(USED);
    expect(transformer.toListResponse([ROW], usage, META).data[0]?.usage).toEqual(USED);
  });
});
