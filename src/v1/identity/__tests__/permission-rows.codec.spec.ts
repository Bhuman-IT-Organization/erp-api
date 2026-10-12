/**
 * The PHP `serialize()` codec for `tblroles.permissions`: round-trip, multi-byte strings (PHP counts
 * BYTES, not UTF-16 units — the assertion that would catch a `String.length` encoder), the empty
 * map, and every malformed shape degrading to `{}` with one reason rather than a throw.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  decodeRolePermissions,
  encodeRolePermissions,
} from '../repository/permission-rows.codec.js';

describe('encodeRolePermissions', () => {
  it('writes PHP serialize() for a feature => capability[] map', () => {
    expect(encodeRolePermissions({ staff: ['view', 'create'] })).toBe(
      'a:1:{s:5:"staff";a:2:{i:0;s:4:"view";i:1;s:6:"create";}}',
    );
  });

  it('writes an empty outer array for an empty map', () => {
    expect(encodeRolePermissions({})).toBe('a:0:{}');
  });

  it('writes an empty inner array for a feature with no capability', () => {
    expect(encodeRolePermissions({ staff: [] })).toBe('a:1:{s:5:"staff";a:0:{}}');
  });

  it('counts BYTES, not characters, for a multi-byte string', () => {
    // "موظفون" is 6 characters and 12 UTF-8 bytes; a character-counting encoder writes s:6.
    const serialized = encodeRolePermissions({ موظفون: ['view'] });
    expect(serialized).toContain('s:12:"موظفون";');
    expect(Buffer.byteLength('موظفون', 'utf8')).toBe(12);
  });
});

describe('decodeRolePermissions', () => {
  it('round-trips a two-feature map', () => {
    const map = { staff: ['view', 'create'], roles: ['view'] };
    expect(decodeRolePermissions(encodeRolePermissions(map))).toEqual(map);
  });

  it('round-trips multi-byte feature names and capabilities', () => {
    const map = { موظفون: ['عرض', 'إنشاء'] };
    expect(decodeRolePermissions(encodeRolePermissions(map))).toEqual(map);
  });

  it('answers {} for null and for an empty column without calling onMalformed', () => {
    const onMalformed = vi.fn();
    expect(decodeRolePermissions(null, onMalformed)).toEqual({});
    expect(decodeRolePermissions('', onMalformed)).toEqual({});
    expect(onMalformed).not.toHaveBeenCalled();
  });

  it('answers {} for an empty serialized array', () => {
    expect(decodeRolePermissions('a:0:{}')).toEqual({});
  });

  it.each([
    ['not serialized at all', 'staff.view'],
    ['an object rather than an array', 'O:8:"stdClass":0:{}'],
    ['a declared length longer than the string', 'a:1:{s:99:"staff";a:0:{}}'],
    ['a truncated outer array', 'a:1:{s:5:"staff";a:1:{i:0;s:4:"view";}'],
    ['an integer leaf', 'a:1:{s:5:"staff";a:1:{i:0;i:7;}}'],
    ['a re-keyed capability list', 'a:1:{s:5:"staff";a:1:{i:3;s:4:"view";}}'],
    ['trailing bytes after the outer array', 'a:0:{}rubbish'],
  ])('answers {} with one reason for %s', (_case, serialized) => {
    const onMalformed = vi.fn();
    expect(decodeRolePermissions(serialized, onMalformed)).toEqual({});
    expect(onMalformed).toHaveBeenCalledTimes(1);
    expect(typeof onMalformed.mock.calls[0]?.[0]).toBe('string');
  });

  it('never throws, even without an onMalformed callback', () => {
    expect(() => decodeRolePermissions('nonsense')).not.toThrow();
  });
});
