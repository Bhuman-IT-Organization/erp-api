/**
 * The values read codec: `fromStoredValue` answers a value Perfex's `handle_custom_fields_post`
 * stored, for the wire (a textarea without its `nl2br` tags, checkbox and multiselect split into
 * their options); `splitOptions` answers the chips of the comma-joined options column.
 */
import { describe, expect, it } from 'vitest';
import { fromStoredValue, splitOptions } from '../service/custom-field-values.js';

describe('fromStoredValue (the read codec)', () => {
  it('splits checkbox and multiselect on commas into trimmed options', () => {
    expect(fromStoredValue('multiselect', 'a, b')).toEqual(['a', 'b']);
    expect(fromStoredValue('checkbox', '')).toEqual([]);
  });

  it('removes the break tags nl2br added to a textarea, in any letter case', () => {
    expect(fromStoredValue('textarea', 'a<br />\nb')).toBe('a\nb');
    expect(fromStoredValue('textarea', 'a<BR>\nb<br/>\nc')).toBe('a\nb\nc');
  });

  it('answers every other type as stored', () => {
    expect(fromStoredValue('date_picker', '2026-09-30')).toBe('2026-09-30');
    expect(fromStoredValue('input', ' x ')).toBe(' x ');
  });
});

describe('splitOptions (the options column)', () => {
  it('splits on commas, trims each and drops empty ones', () => {
    expect(splitOptions(' a, b ,,c ')).toEqual(['a', 'b', 'c']);
    expect(splitOptions(null)).toEqual([]);
  });
});
