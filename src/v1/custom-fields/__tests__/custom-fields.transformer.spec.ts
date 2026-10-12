/**
 * CustomFieldsTransformer: the record with its fingerprint over every form field (ADR-0040), the
 * options split into chips, `disabled` as the negation of `active`, the list rows with their value
 * counts, and the facade's definition (`null` for a stored entity or type Perfex's Setup does not
 * offer).
 */
import { describe, expect, it } from 'vitest';
import { etagOf } from '../../../shared/http/etag.js';
import type { CustomField } from '../model/custom-fields.model.js';
import { CustomFieldsTransformer, shownOf } from '../service/custom-fields.transformer.js';
import { newField } from './fakes.js';

const transformer = new CustomFieldsTransformer();
const ROW: CustomField = {
  id: 5,
  ...newField({ type: 'select', options: 'a, b,c', active: false }),
};

describe('CustomFieldsTransformer', () => {
  it('answers the record with the options as chips, disabled = !active, the count and the etag of the shown fields', () => {
    const dto = transformer.toResponse(ROW, 3);
    expect(dto).toMatchObject({ id: 5, options: ['a', 'b', 'c'], disabled: true, valuesCount: 3 });
    expect(dto.etag).toBe(etagOf(shownOf(ROW)));
  });

  it('the etag changes with any form field and not with the slug', () => {
    const base = transformer.toResponse(ROW, 0).etag;
    expect(transformer.toResponse({ ...ROW, required: true }, 0).etag).not.toBe(base);
    expect(transformer.toResponse({ ...ROW, bsColumn: 6 }, 0).etag).not.toBe(base);
    expect(transformer.toResponse({ ...ROW, slug: 'other' }, 0).etag).toBe(base);
  });

  it('a list row carries active and the value count (zero when the map has none)', () => {
    const list = transformer.toListResponse([ROW], new Map(), {
      nextCursor: null,
      prevCursor: null,
      total: 1,
      rangeStart: 1,
    });
    expect(list.data).toEqual([
      {
        id: 5,
        name: 'Field',
        fieldto: 'leads',
        type: 'select',
        slug: 'leads_field',
        active: false,
        fieldOrder: 0,
        valuesCount: 0,
      },
    ]);
  });

  it('a definition answers the facade shape, or null for an entity or type Setup does not offer', () => {
    expect(transformer.toDefinition(ROW)).toMatchObject({
      id: 5,
      fieldto: 'leads',
      type: 'select',
      options: ['a', 'b', 'c'],
      active: false,
    });
    expect(transformer.toDefinition({ ...ROW, fieldto: 'fixed_equipment' })).toBeNull();
    expect(transformer.toDefinition({ ...ROW, type: 'unknown' })).toBeNull();
  });
});
