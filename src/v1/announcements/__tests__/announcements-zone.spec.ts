import { describe, expect, it } from 'vitest';
import { companyZone, instantOf, wallClockAt } from '../service/announcements-zone.js';

const NOW = new Date('2026-11-02T10:00:00.000Z');

describe('companyZone', () => {
  it('uses the setting when it is a known IANA zone', () => {
    expect(companyZone('Asia/Kolkata')).toBe('Asia/Kolkata');
  });

  it('falls back to UTC for no setting, an offset or an unknown zone', () => {
    expect(companyZone(null)).toBe('UTC');
    expect(companyZone('')).toBe('UTC');
    expect(companyZone('+04:00')).toBe('UTC');
    expect(companyZone('Nope/Zone')).toBe('UTC');
  });
});

describe('wallClockAt and instantOf', () => {
  it('writes the Kolkata wall clock and reads the original instant back', () => {
    const stored = wallClockAt(NOW, 'Asia/Kolkata');
    expect(stored.toISOString()).toBe('2026-11-02T15:30:00.000Z');
    expect(instantOf(stored, 'Asia/Kolkata')).toBe(NOW.toISOString());
  });

  it('is the identity in UTC', () => {
    expect(wallClockAt(NOW, 'UTC').toISOString()).toBe(NOW.toISOString());
    expect(instantOf(NOW, 'UTC')).toBe(NOW.toISOString());
  });

  it('drops milliseconds, as DATETIME(0) does', () => {
    const withMs = new Date('2026-11-02T10:00:00.789Z');
    expect(wallClockAt(withMs, 'UTC').toISOString()).toBe('2026-11-02T10:00:00.000Z');
  });
});
