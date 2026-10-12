import { describe, expect, it } from 'vitest';
import type { ExampleItem } from '../model/example-item.model.js';
import { ExampleItemEnricher } from '../service/example-item.enricher.js';

const item: ExampleItem = {
  id: 7,
  name: 'Seven',
  createdAt: '2026-01-07T00:00:00.000Z',
  internalRef: 'ref-7',
  ownerStaffId: 1,
};

describe('ExampleItemEnricher', () => {
  const enricher = new ExampleItemEnricher();

  it('adds label = `${name} (${id})` and keeps every entity field', () => {
    expect(enricher.enrich(item)).toEqual({ ...item, label: 'Seven (7)' });
  });

  it('is pure: the input is untouched and the output is a new object', () => {
    const before = { ...item };
    const enriched = enricher.enrich(item);
    expect(item).toEqual(before);
    expect('label' in item).toBe(false);
    expect(enriched).not.toBe(item);
  });
});
