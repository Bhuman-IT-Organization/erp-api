import { describe, expect, it } from 'vitest';

import {
  LeadStatusesTransformer,
  toLeadStatus,
  toResponse,
} from '../service/lead-statuses.transformer.js';

import type { LeadStatusRow, LeadStatusUsage } from '../model/lead-statuses.model.js';

const row: LeadStatusRow = {
  id: 3,
  name: 'Contacted',
  statusorder: 2,
  color: '#28B8DA',
  isdefault: 0,
};

const usage: LeadStatusUsage = {
  leads: 5,
  emailIntegration: 2,
};

describe('LeadStatusesTransformer', () => {
  const transformer = new LeadStatusesTransformer();

  it('converts a database row to API response', () => {
    expect(toResponse(row, usage, 3)).toEqual({
      id: '3',
      name: 'Contacted',
      statusorder: 2,
      color: '#28B8DA',
      isdefault: 0,
      usage,
      isConfiguredDefault: true,
    });
  });

  it('marks statuses that are not configured defaults', () => {
    expect(toResponse(row, usage, 4).isConfiguredDefault).toBe(false);
  });

  it('converts database rows to facade entities', () => {
    expect(toLeadStatus(row)).toEqual({
      id: 3,
      name: 'Contacted',
      statusorder: 2,
      color: '#28B8DA',
      isdefault: 0,
    });
  });

  it('uses zero usage when no references are provided', () => {
    const result = transformer.toResponse(row, new Map(), null);

    expect(result.usage).toEqual({
      leads: 0,
      emailIntegration: 0,
    });
  });

  it('converts rows into a paginated list response', () => {
    const result = transformer.toListResponse([row], new Map([[3, usage]]), 3, {
      nextCursor: null,
      prevCursor: null,
      total: 1,
      rangeStart: 1,
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.id).toBe('3');
    expect(result.data[0]?.usage).toEqual(usage);
    expect(result.data[0]?.isConfiguredDefault).toBe(true);
    expect(result.meta.total).toBe(1);
    expect(result.meta.rangeStart).toBe(1);
    expect(result.meta.exportLimit).toBeGreaterThan(0);
    expect(result.meta.printLimit).toBeGreaterThan(0);
  });
});
