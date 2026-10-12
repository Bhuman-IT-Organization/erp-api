/**
 * The seed rows shared by the service, facade and controller specs. There is no fake repository:
 * the in-memory store IS the implementation (`repository/example-item.repository.ts`, proven by
 * its own spec), so every spec seeds the real one through `create`, with fixed times, and asserts
 * what a caller would see.
 *
 * Two owners, so a spec can prove `own` never returns another member's row (ADR-0033 decision 5,
 * T-3.1-11): staff 1 owns ids 1 and 3, staff 3 owns id 2.
 */
import type { ExampleItem, NewExampleItem } from '../model/example-item.model.js';
import type { ExampleItemRepository } from '../repository/example-item.repository.js';

/** Three rows, ids 1–3 in this order, each with the internal fields a DTO must never carry. */
export const SEED_ITEMS: readonly NewExampleItem[] = [
  { name: 'First', ownerStaffId: 1, createdAt: '2026-01-01T00:00:00.000Z', internalRef: 'ref-1' },
  { name: 'Second', ownerStaffId: 3, createdAt: '2026-01-02T00:00:00.000Z', internalRef: 'ref-2' },
  { name: 'Third', ownerStaffId: 1, createdAt: '2026-01-03T00:00:00.000Z', internalRef: 'ref-3' },
];

/** Creates `items` in order through the repository's own `create`; answers the stored rows. */
export async function seedRepository(
  repo: ExampleItemRepository,
  items: readonly NewExampleItem[] = SEED_ITEMS,
): Promise<ExampleItem[]> {
  const stored: ExampleItem[] = [];
  for (const item of items) stored.push(await repo.create(item));
  return stored;
}
