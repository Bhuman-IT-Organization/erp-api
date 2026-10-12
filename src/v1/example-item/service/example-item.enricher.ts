/**
 * Enricher: computed fields and lookups the entity does not carry — a label, a count, a value read
 * from another module through its facade. Pure: it returns a new object and never mutates its
 * input, so the same entity can be enriched twice and compared.
 */
import { Injectable } from '@nestjs/common';
import type { EnrichedExampleItem, ExampleItem } from '../model/example-item.model.js';

@Injectable()
export class ExampleItemEnricher {
  /** `label` is `${name} (${id})` — the display string erp-web shows in a list row. */
  enrich(item: ExampleItem): EnrichedExampleItem {
    return { ...item, label: `${item.name} (${String(item.id)})` };
  }
}
