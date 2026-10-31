import { describe, expect, it } from 'vitest';
import {
  createFixedEquipmentDepreciationsBodySchema,
  fixedEquipmentDepreciationsListResponseSchema,
  fixedEquipmentDepreciationsParamsSchema,
  updateFixedEquipmentDepreciationsBodySchema,
} from '../dto/fixed-equipment-depreciations.dto.js';

const META = {
  nextCursor: null,
  prevCursor: null,
  total: 1,
  rangeStart: 1,
  exportLimit: 1000,
  printLimit: 500,
};

describe('fixedEquipmentDepreciationsParamsSchema', () => {
  it('coerces a numeric string to a number', () => {
    expect(fixedEquipmentDepreciationsParamsSchema.parse({ id: '5' })).toEqual({ id: 5 });
  });

  it.each(['abc', '0', '-1', '1.5', ''])('rejects id=%s', (id) => {
    expect(fixedEquipmentDepreciationsParamsSchema.safeParse({ id }).success).toBe(false);
  });
});

describe('createFixedEquipmentDepreciationsBodySchema', () => {
  const ok = (body: unknown): boolean =>
    createFixedEquipmentDepreciationsBodySchema.safeParse(body).success;

  it('accepts a name and a number of months, and trims the name', () => {
    expect(
      createFixedEquipmentDepreciationsBodySchema.parse({ name: '  Depreciation 1  ', term: 12 }),
    ).toEqual({ name: 'Depreciation 1', term: 12 });
  });

  it('rejects an empty or blank name', () => {
    expect(ok({ name: '', term: 12 })).toBe(false);
    expect(ok({ name: '   ', term: 12 })).toBe(false);
  });

  it('accepts 200 characters and rejects 201 (the column is a VARCHAR(200))', () => {
    expect(ok({ name: 'a'.repeat(200), term: 12 })).toBe(true);
    expect(ok({ name: 'a'.repeat(201), term: 12 })).toBe(false);
  });

  it('rejects a missing or non-string name', () => {
    expect(ok({ term: 12 })).toBe(false);
    expect(ok({ name: 5, term: 12 })).toBe(false);
  });

  it('requires the number of months as a number greater than 0', () => {
    expect(ok({ name: 'Straight line' })).toBe(false);
    expect(ok({ name: 'Straight line', term: '12' })).toBe(false);
    expect(ok({ name: 'Straight line', term: 0 })).toBe(false);
    expect(ok({ name: 'Straight line', term: -6 })).toBe(false);
    expect(ok({ name: 'Straight line', term: 1 })).toBe(true);
  });

  it('refuses a key Perfex never posts, the creator included', () => {
    expect(ok({ name: 'Straight line', term: 12, creator_id: 9 })).toBe(false);
    expect(ok({ name: 'Straight line', term: 12, id: 3 })).toBe(false);
  });
});

describe('updateFixedEquipmentDepreciationsBodySchema', () => {
  it('still enforces the length limit and the number of months', () => {
    const ok = (body: unknown): boolean =>
      updateFixedEquipmentDepreciationsBodySchema.safeParse(body).success;
    expect(ok({ name: 'a'.repeat(201), term: 12 })).toBe(false);
    expect(ok({ name: 'Renamed' })).toBe(false);
  });
});

describe('fixedEquipmentDepreciationsListResponseSchema', () => {
  it('accepts the keyset envelope, a term or null', () => {
    const result = fixedEquipmentDepreciationsListResponseSchema.safeParse({
      data: [
        { id: '1', name: 'Depreciation 1', term: 12 },
        { id: '4', name: 'Legacy', term: null },
      ],
      meta: META,
    });
    expect(result.success).toBe(true);
  });

  it('rejects a numeric id', () => {
    expect(
      fixedEquipmentDepreciationsListResponseSchema.safeParse({
        data: [{ id: 1, name: 'Depreciation 1', term: 12 }],
        meta: META,
      }).success,
    ).toBe(false);
  });
});
