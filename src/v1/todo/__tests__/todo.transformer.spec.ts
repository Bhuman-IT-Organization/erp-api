import { describe, expect, it } from 'vitest';
import type { TodoRow } from '../model/todo.model.js';
import {
  companyZone,
  encodeOffsetCursor,
  FALLBACK_ZONE,
  instantOf,
  toResponse,
  TodoTransformer,
  wallClockAt,
} from '../service/todo.transformer.js';

const ZONE = 'Asia/Dubai';
/** 2026-10-02T20:30:15.250Z is 2026-10-03 00:30:15 on a Dubai wall clock. */
const INSTANT = new Date('2026-10-02T20:30:15.250Z');
const WALL = new Date(Date.UTC(2026, 9, 3, 0, 30, 15));

const row = (overrides: Partial<TodoRow> = {}): TodoRow => ({
  id: 5,
  description: 'Call Ali',
  staffId: 2,
  dateAdded: WALL,
  finished: false,
  dateFinished: null,
  itemOrder: 1,
  ...overrides,
});

describe('companyZone', () => {
  it('keeps an IANA zone and falls back to UTC for an empty, missing or unknown setting', () => {
    expect(companyZone('Asia/Dubai')).toBe('Asia/Dubai');
    expect(companyZone(null)).toBe(FALLBACK_ZONE);
    expect(companyZone('')).toBe(FALLBACK_ZONE);
    expect(companyZone('+04:00')).toBe(FALLBACK_ZONE);
    expect(companyZone('Not/AZone')).toBe(FALLBACK_ZONE);
  });
});

describe('the wall clock (D-31)', () => {
  it('wallClockAt packs the instant as the zone wall clock, seconds kept, milliseconds dropped', () => {
    expect(wallClockAt(INSTANT, ZONE).toISOString()).toBe('2026-10-03T00:30:15.000Z');
  });

  it('instantOf reads a stored wall clock back as the instant it names', () => {
    expect(instantOf(WALL, ZONE)).toBe('2026-10-02T20:30:15.000Z');
  });

  it('round-trips in a zone with daylight saving', () => {
    const wall = wallClockAt(new Date('2026-07-01T12:00:00.000Z'), 'Europe/Berlin');
    expect(instantOf(wall, 'Europe/Berlin')).toBe('2026-07-01T12:00:00.000Z');
  });
});

describe('toResponse', () => {
  it('answers the id as text, the text as stored and both dates as instants', () => {
    expect(toResponse(row(), ZONE)).toEqual({
      id: '5',
      description: 'Call Ali',
      finished: false,
      dateAdded: '2026-10-02T20:30:15.000Z',
      dateFinished: null,
    });
  });

  it('answers a finished to do with its date finished', () => {
    const done = toResponse(row({ finished: true, dateFinished: WALL }), ZONE);
    expect(done.finished).toBe(true);
    expect(done.dateFinished).toBe('2026-10-02T20:30:15.000Z');
  });

  it('never answers the staff id or the order', () => {
    const json = JSON.stringify(toResponse(row({ staffId: 99, itemOrder: 7 }), ZONE));
    expect(json).not.toContain('staff');
    expect(json).not.toContain('itemOrder');
    expect(json).not.toContain('99');
  });

  it('keeps markup as text', () => {
    expect(toResponse(row({ description: '<b>x</b>' }), ZONE).description).toBe('<b>x</b>');
  });
});

describe('TodoTransformer.toListResponse', () => {
  const t = new TodoTransformer();

  it('offers the next cursor (the next offset) while rows remain after the page', () => {
    const response = t.toListResponse([row({ id: 2 }), row({ id: 1 })], 5, 0, ZONE);
    expect(response.data.map((one) => one.id)).toEqual(['2', '1']);
    expect(response.meta).toEqual({ nextCursor: encodeOffsetCursor(2), total: 5 });
  });

  it('has no next cursor on the last page', () => {
    const response = t.toListResponse([row()], 3, 2, ZONE);
    expect(response.meta).toEqual({ nextCursor: null, total: 3 });
  });

  it('answers an empty page as an empty data array', () => {
    const response = t.toListResponse([], 0, 0, ZONE);
    expect(response.data).toEqual([]);
    expect(response.meta).toEqual({ nextCursor: null, total: 0 });
  });
});
