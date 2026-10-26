/**
 * The D-31 wall clock (`companyZone`, `wallClockAt`, `instantOf`: Perfex's `date('Y-m-d H:i:s')` in
 * the `default_timezone` zone, packed for the naive `DATETIME` and read back as an instant), the
 * export rows and cells, and the DTOs: the id as a string, the stored name, `dateCreated` as the
 * instant or `null`, the usage on every row, never `created_by`; the facade's `{ id, name }`.
 */
import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import type { ContractTypeRow, ContractTypeUsage } from '../model/contract-types.model.js';
import {
  companyZone,
  CONTRACT_TYPES_EXPORT_CELLS,
  ContractTypesTransformer,
  FALLBACK_ZONE,
  instantOf,
  NO_CONTRACT_TYPE_USAGE,
  toContractType,
  toExportRow,
  toResponse,
  wallClockAt,
} from '../service/contract-types.transformer.js';

/** A naive wall clock as `wallClockAt` packs it: the UTC fields ARE the wall-clock fields. */
const wall = (text: string): Date => new Date(`${text}Z`);

const ROW: ContractTypeRow = {
  id: 7,
  name: 'Fixed-Term',
  createdBy: 4,
  datecreated: wall('2026-10-03T00:30:15.000'),
};
const UNDATED: ContractTypeRow = { id: 8, name: 'Permanent', createdBy: null, datecreated: null };
const USED: ContractTypeUsage = { ...NO_CONTRACT_TYPE_USAGE, purchaseRequests: 2 };
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
    const stored = wallClockAt(new Date('2026-03-01T23:59:59.999Z'), 'UTC');
    expect(stored.toISOString()).toBe('2026-03-01T23:59:59.000Z');
    expect(instantOf(stored, 'UTC')).toBe('2026-03-01T23:59:59.000Z');
  });

  it.each([
    ['2026-10-24T12:00:00.000Z', '2026-10-24T13:00:00.000Z'],
    ['2026-10-24T23:59:59.000Z', '2026-10-25T00:59:59.000Z'],
    ['2026-10-25T02:00:00.000Z', '2026-10-25T02:00:00.000Z'],
    ['2026-10-25T12:00:00.000Z', '2026-10-25T12:00:00.000Z'],
  ])(
    'Europe/London across its 2026-10-25 change: %s is stored %s and round-trips',
    (instant, stored) => {
      const packed = wallClockAt(new Date(instant), 'Europe/London');
      expect(packed.toISOString()).toBe(stored);
      expect(instantOf(packed, 'Europe/London')).toBe(instant);
    },
  );

  it('a wall clock just after a spring-forward change lands on the right side (the one correction)', () => {
    // America/New_York moves 02:00 EST to 03:00 EDT at 2026-03-08T07:00Z; 03:30 EDT is 07:30Z.
    const packed = wallClockAt(new Date('2026-03-08T07:30:00.000Z'), 'America/New_York');
    expect(packed.toISOString()).toBe('2026-03-08T03:30:00.000Z');
    expect(instantOf(packed, 'America/New_York')).toBe('2026-03-08T07:30:00.000Z');
  });

  it('a wall clock the change skipped reads on the earlier side; a doubled one as the later instant', () => {
    expect(instantOf(wall('2026-03-08T02:30:00.000'), 'America/New_York')).toBe(
      '2026-03-08T06:30:00.000Z',
    );
    expect(instantOf(wall('2026-10-25T01:30:00.000'), 'Europe/London')).toBe(
      '2026-10-25T01:30:00.000Z',
    );
  });
});

describe('the response, the export rows and the facade shape', () => {
  it('toResponse writes String(id), the stored name, the instant of the date and the usage; never created_by', () => {
    const dto = toResponse(ROW, USED, 'Asia/Dubai');
    expect(dto).toEqual({
      id: '7',
      name: 'Fixed-Term',
      dateCreated: '2026-10-02T20:30:15.000Z',
      usage: USED,
    });
    expect(JSON.stringify(dto)).not.toContain('createdBy');
    expect(JSON.stringify(dto)).not.toContain('created_by');
  });

  it('a NULL datecreated answers dateCreated null', () => {
    expect(toResponse(UNDATED, NO_CONTRACT_TYPE_USAGE, 'UTC').dateCreated).toBeNull();
    expect(toExportRow(UNDATED, 'UTC')).toEqual({ id: '8', name: 'Permanent', dateCreated: null });
  });

  it('the export row and its cells: id and name as text, dateCreated a date and time cell; never the usage', () => {
    const row = toExportRow(ROW, 'Asia/Dubai');
    expect(row).toEqual({ id: '7', name: 'Fixed-Term', dateCreated: '2026-10-02T20:30:15.000Z' });
    expect(CONTRACT_TYPES_EXPORT_CELLS.id.value(row)).toBe('7');
    expect(CONTRACT_TYPES_EXPORT_CELLS.name.value(row)).toBe('Fixed-Term');
    expect(CONTRACT_TYPES_EXPORT_CELLS.dateCreated.value(row)).toBe('2026-10-02T20:30:15.000Z');
    expect(CONTRACT_TYPES_EXPORT_CELLS.dateCreated.kind).toBe('dateTime');
    expect(Object.keys(CONTRACT_TYPES_EXPORT_CELLS)).toEqual(['id', 'name', 'dateCreated']);
  });

  it('toContractType maps { id, name } only', () => {
    expect(toContractType(ROW)).toEqual({ id: 7, name: 'Fixed-Term' });
  });

  it('the class reads the usage map (zeros for an absent id) and builds the list envelope', () => {
    const transformer = new ContractTypesTransformer();
    const usage = new Map([[7, USED]]);
    expect(transformer.toResponse(ROW, usage, 'UTC').usage).toEqual(USED);
    expect(transformer.toResponse(UNDATED, usage, 'UTC').usage).toEqual(NO_CONTRACT_TYPE_USAGE);
    const list = transformer.toListResponse([ROW, UNDATED], usage, 'Asia/Dubai', META);
    expect(list.data.map((row) => [row.id, row.dateCreated])).toEqual([
      ['7', '2026-10-02T20:30:15.000Z'],
      ['8', null],
    ]);
    expect(list.meta).toEqual({
      ...META,
      exportLimit: EXPORT_MAX_ROWS,
      printLimit: PRINT_MAX_ROWS,
    });
  });
});
