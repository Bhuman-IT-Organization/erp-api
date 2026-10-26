/**
 * Transformer: entity to wire shape. Pure, so no database or Nest app.
 */
import { describe, expect, it } from 'vitest';
import {
  CustomerGroupsTransformer,
  toCustomerGroup,
} from '../service/customer-groups.transformer.js';

const transformer = new CustomerGroupsTransformer();

describe('CustomerGroupsTransformer.toResponse', () => {
  it('answers the id as text and the name as stored', () => {
    expect(transformer.toResponse({ id: 7, name: 'VIP' })).toEqual({ id: '7', name: 'VIP' });
  });
});

describe('CustomerGroupsTransformer.toListResponse', () => {
  it('wraps the rows and copies the four page fields', () => {
    const response = transformer.toListResponse(
      [
        { id: 2, name: 'Gold' },
        { id: 1, name: 'VIP' },
      ],
      { nextCursor: null, prevCursor: null, total: 2, rangeStart: 1 },
    );
    expect(response.data).toEqual([
      { id: '2', name: 'Gold' },
      { id: '1', name: 'VIP' },
    ]);
    expect(response.meta).toEqual({
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
    });
  });

  it('answers an empty page', () => {
    const response = transformer.toListResponse([], {
      nextCursor: null,
      prevCursor: null,
      total: 0,
      rangeStart: 0,
    });
    expect(response.data).toEqual([]);
    expect(response.meta.total).toBe(0);
  });
});

describe('toCustomerGroup', () => {
  it('hands the facade the id and the name as numbers and text', () => {
    expect(toCustomerGroup({ id: 3, name: 'Silver' })).toEqual({ id: 3, name: 'Silver' });
  });
});
