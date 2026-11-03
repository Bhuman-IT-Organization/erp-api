/**
 * The D-31 wall clock (`companyZone`, `wallClockAt`, `instantOf`: Perfex's `date('Y-m-d H:i:s')` in
 * the `default_timezone` zone, packed for the naive `DATETIME` and read back as an instant), the
 * export rows and cells, and the DTOs: the id as a string, the stored name, `dateCreated` as the
 * instant or `null`, the usage on every row, never `created_by`; the facade's `{ id, name }`.
 */
import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { KnowledgeBaseRow, KnowledgeBaseUsage } from '../model/knowledge-base.model.js';
import {
  companyZone,
  KNOWLEDGE_BASE_EXPORT_CELLS,
  KnowledgeBaseTransformer,
  FALLBACK_ZONE,
  instantOf,
  NO_KNOWLEDGE_BASE_USAGE,
  toKnowledgeBase,
  toExportRow,
  toResponse,
  wallClockAt,
} from '../service/knowledge-base.transformer.js';

/** A naive wall clock as `wallClockAt` packs it: the UTC fields ARE the wall-clock fields. */
const wall = (text: string): Date => new Date(`${text}Z`);

const ROW: KnowledgeBaseRow = {
  id: 7,
  name: 'Head Office',
  createdBy: 4,
  datecreated: wall('2026-10-03T00:30:15.000'),
};
const UNDATED: KnowledgeBaseRow = { id: 8, name: 'Warehouse', createdBy: null, datecreated: null };
const USED: KnowledgeBaseUsage = { ...NO_KNOWLEDGE_BASE_USAGE, purchaseOrders: 2, assets: 1 };
const META = { nextCursor: 'n', prevCursor: null, total: 3, rangeStart: 1 };

describe('companyZone (D-31: the zone PHP runs in)', () => {
  it.each([
    [null, 'UTC'],
    ['', 'UTC'],
    ['Not/AZone', 'UTC'],
    ['+04:00', 'UTC'],
    [' Asia/Dubai', 'UTC'],
    ['Asia/Dubai', 'Asia/Dubai'],
    ['Europe/London', 'Europe/London'],
    ['UTC', 'UTC'],
  ])('companyZone(%o) is %s', (setting, zone) => {
    expect(companyZone(setting)).toBe(zone);
    expect(FALLBACK_ZONE).toBe('UTC');
  });
});

describe('wallClockAt and instantOf (D-31: the naive DATETIME Perfex writes)', () => {
  it('Asia/Dubai: 2026-10-02T20:30:15.250Z is stored 2026-10-03 00:30:15 and reads back to the second', () => {
    const stored = wallClockAt(new Date('2026-10-02T20:30:15.250Z'), 'Asia/Dubai');
    expect(stored.toISOString()).toBe('2026-10-03T00:30:15.000Z');
    expect(instantOf(stored, 'Asia/Dubai')).toBe('2026-10-02T20:30:15.000Z');
  });

  it('UTC is the identity, milliseconds dropped', () => {
    const stored = wallClockAt(new Date('2026-10-02T20:30:15.999Z'), 'UTC');
    expect(stored.toISOString()).toBe('2026-10-02T20:30:15.000Z');
    expect(instantOf(stored, 'UTC')).toBe('2026-10-02T20:30:15.000Z');
  });

  it('Europe/London daylight-saving boundary: stays the same instant round-trip', () => {
    const instant = new Date('2026-06-15T12:00:00.000Z');
    const stored = wallClockAt(instant, 'Europe/London');
    expect(instantOf(stored, 'Europe/London')).toBe(instant.toISOString());
  });
});

describe('toResponse: the single knowledge base DTO', () => {
  it('shapes the DTO: id as string, name as stored, dateCreated as the instant, usage carried', () => {
    expect(toResponse(ROW, USED, 'Asia/Dubai')).toEqual({
      id: '7',
      name: 'Head Office',
      dateCreated: '2026-10-02T20:30:15.000Z',
      usage: USED,
    });
  });

  it('answers dateCreated: null when the row holds none', () => {
    expect(toResponse(UNDATED, NO_KNOWLEDGE_BASE_USAGE, 'UTC')).toMatchObject({
      id: '8',
      dateCreated: null,
    });
  });

  it('never answers created_by (stripped by the zod response schema, T-2-14)', () => {
    const response = toResponse(ROW, NO_KNOWLEDGE_BASE_USAGE, 'UTC') as unknown as Record<
      string,
      unknown
    >;
    expect(response.created_by).toBeUndefined();
    expect(response.createdBy).toBeUndefined();
  });
});

describe('toExportRow: the export row (no usage, id as string)', () => {
  it('shapes the three columns: id, name, dateCreated as the instant (or null)', () => {
    expect(toExportRow(ROW, 'Asia/Dubai')).toEqual({
      id: '7',
      name: 'Head Office',
      dateCreated: '2026-10-02T20:30:15.000Z',
    });
    expect(toExportRow(UNDATED, 'UTC')).toEqual({
      id: '8',
      name: 'Warehouse',
      dateCreated: null,
    });
  });
});

describe('KNOWLEDGE_BASE_EXPORT_CELLS: each export column over the row', () => {
  const row = toExportRow(ROW, 'Asia/Dubai');

  it('id answers the string id', () => {
    expect(KNOWLEDGE_BASE_EXPORT_CELLS.id.value(row)).toBe('7');
  });

  it('name answers the stored name', () => {
    expect(KNOWLEDGE_BASE_EXPORT_CELLS.name.value(row)).toBe('Head Office');
  });

  it('dateCreated answers the ISO instant and is kind: dateTime', () => {
    expect(KNOWLEDGE_BASE_EXPORT_CELLS.dateCreated.value(row)).toBe('2026-10-02T20:30:15.000Z');
    expect(KNOWLEDGE_BASE_EXPORT_CELLS.dateCreated.kind).toBe('dateTime');
  });
});

describe('toKnowledgeBase: the facade shape { id, name }', () => {
  it('keeps id as number, name, and drops created_by and datecreated', () => {
    expect(toKnowledgeBase(ROW)).toEqual({ id: 7, name: 'Head Office' });
  });
});

describe('KnowledgeBaseTransformer: toListResponse and toResponse over a usage map', () => {
  const transformer = new KnowledgeBaseTransformer();

  it('toListResponse wraps rows into the envelope with the limits from the core', () => {
    const usage = new Map<number, KnowledgeBaseUsage>([[7, USED]]);
    const response = transformer.toListResponse([ROW, UNDATED], usage, 'Asia/Dubai', META);

    expect(response).toEqual({
      data: [
        {
          id: '7',
          name: 'Head Office',
          dateCreated: '2026-10-02T20:30:15.000Z',
          usage: USED,
        },
        {
          id: '8',
          name: 'Warehouse',
          dateCreated: null,
          usage: NO_KNOWLEDGE_BASE_USAGE,
        },
      ],
      meta: {
        nextCursor: 'n',
        prevCursor: null,
        total: 3,
        rangeStart: 1,
        exportLimit: EXPORT_MAX_ROWS,
        printLimit: PRINT_MAX_ROWS,
      },
    });
  });

  it('toResponse uses NO_KNOWLEDGE_BASE_USAGE when the usage map has no entry for the id', () => {
    expect(transformer.toResponse(ROW, new Map(), 'UTC').usage).toEqual(NO_KNOWLEDGE_BASE_USAGE);
  });
});
