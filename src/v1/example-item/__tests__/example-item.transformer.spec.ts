import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { PRINT_MAX_ROWS } from '../../../shared/http/export.js';
import { exampleItemResponseSchema } from '../dto/example-item.dto.js';
import type { EnrichedExampleItem } from '../model/example-item.model.js';
import { ExampleItemTransformer } from '../service/example-item.transformer.js';

const enriched: EnrichedExampleItem = {
  id: 1,
  name: 'First',
  createdAt: '2026-01-01T00:00:00.000Z',
  internalRef: 'ref-1',
  ownerStaffId: 7,
  label: 'First (1)',
};

const META = { nextCursor: 'n', prevCursor: null, total: 3, rangeStart: 1 };

describe('ExampleItemTransformer', () => {
  const transformer = new ExampleItemTransformer();

  it('builds the DTO field by field: the id is a string, internalRef and ownerStaffId are absent (T-2-14)', () => {
    const dto = transformer.toResponse(enriched);
    expect(dto).toEqual({
      id: '1',
      name: 'First',
      label: 'First (1)',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect('internalRef' in dto).toBe(false);
    expect('ownerStaffId' in dto).toBe(false);
  });

  it('builds the list envelope on the superset meta, with exportLimit = EXPORT_MAX_ROWS and printLimit = PRINT_MAX_ROWS', () => {
    expect(transformer.toListResponse([enriched], META)).toEqual({
      data: [{ id: '1', name: 'First', label: 'First (1)', createdAt: '2026-01-01T00:00:00.000Z' }],
      meta: { ...META, exportLimit: EXPORT_MAX_ROWS, printLimit: PRINT_MAX_ROWS },
    });
  });

  it('copies the four page fields one by one: a page object passed as the meta carries nothing else', () => {
    const page = { ...META, items: [enriched] };
    expect(Object.keys(transformer.toListResponse([], page).meta).sort()).toEqual([
      'exportLimit',
      'nextCursor',
      'prevCursor',
      'printLimit',
      'rangeStart',
      'total',
    ]);
  });

  it('the response schema rejects a missing field, so a partial build cannot leave the transformer', () => {
    const withoutLabel = {
      id: enriched.id,
      name: enriched.name,
      createdAt: enriched.createdAt,
      internalRef: enriched.internalRef,
      ownerStaffId: enriched.ownerStaffId,
    } as EnrichedExampleItem;
    expect(() => transformer.toResponse(withoutLabel)).toThrow();
    expect(exampleItemResponseSchema.safeParse({ id: '1' }).success).toBe(false);
  });
});
