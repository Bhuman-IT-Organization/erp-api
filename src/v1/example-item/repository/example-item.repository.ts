/**
 * Repository: the module's data seam (BE-08). The module owns no table yet, and no table is
 * invented for it: the rows live in a bounded in-memory store behind exactly the interface a
 * database table would have — `list`, `count`, `findById`, `create`, `update` — so every other
 * layer (the strict bodies, the service, the events, the controller) does real work from the day
 * the module is generated, and only this file changes when the table arrives.
 *
 * The swap, once the module owns a table: claim it in `prisma/ownership.json` with owner
 * `node` (ADR-0029, ADR-0030), run `corepack yarn db:generate`, inject `PrismaService` in the
 * constructor, and replace each method with ONE call on the typed delegate (`<table>` below). The
 * row scope stays here (ADR-0033 decision 5) and the `own` branch only ever narrows: it adds a
 * `where` on the owning column and never removes one (T-3.1-11).
 *
 * ```ts
 * const owned = scope === 'own' ? { ownerStaffId: staffId } : {};
 * const keyed = request.ids === undefined ? {} : { id: { in: [...request.ids] } }; // export keys only narrow
 * const match = { ...owned, ...keyed, ...(search === null ? {} : { name: { contains: search } }) };
 * // list: the page (a `before` cursor reads in the reversed order and reverses the rows back),
 * // then total and the rank of the first row, exactly as v1/identity's repository does
 * prisma.client.<table>.findMany({
 *   where: cursor === null ? match : { AND: [match, keysetWhere(sortField, 'id', cursor, order)] },
 *   orderBy: [{ [sortField]: order }, { id: order }],
 *   take: limit,
 * });
 * prisma.client.<table>.count({ where: match });                                  // count
 * prisma.client.<table>.findFirst({ where: { id, ...owned } });                   // findById
 * prisma.client.<table>.create({ data: input });                                  // create
 * prisma.client.<table>.update({ where: { id }, data: patch });                   // update (P2025 → null)
 * ```
 *
 * Once the repository reads its client, `src/v1/__tests__/module-shape.spec.ts` in erp-api requires
 * `__tests__/<module>.repository.int.spec.ts`: write it then, against the local stack, and prove the
 * `own` narrowing on real rows. Until then `example-item.repository.spec.ts` proves this store.
 */
import { Injectable } from '@nestjs/common';
import type { ReadScope } from '../../../shared/http/decorators/scope.decorator.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import type {
  ExampleItem,
  ExampleItemListRequest,
  ExampleItemPage,
  ExampleItemSortField,
  NewExampleItem,
} from '../model/example-item.model.js';

/**
 * The most rows the store holds; past it the oldest row is evicted. Above `EXPORT_MAX_ROWS`
 * (10,000), so the export's cap stays reachable.
 *
 * ponytail: in-memory store, bounded; the Prisma delegate above replaces it.
 */
export const EXAMPLE_ITEM_MEMORY_MAX_ROWS = 20_000;

type Key = readonly [KeyValue, number];

function keyOf(item: ExampleItem, sortField: ExampleItemSortField): Key {
  return sortField === 'name' ? [item.name, item.id] : [item.id, item.id];
}

@Injectable()
export class ExampleItemRepository {
  /** Insertion order is id order, so the first key is always the oldest row. */
  private readonly rows = new Map<number, ExampleItem>();
  private lastId = 0;

  /**
   * One keyset page: ordered by `(sortField, id)`, `after` the cursor row (or from the first row),
   * or the `limit` rows just `before` it; `total` counts every matching row, `rangeStart` is the
   * first row's 1-based rank (`0` on an empty page); `prevCursor` is `null` on the first page and
   * `nextCursor` on the last.
   */
  list(
    request: ExampleItemListRequest,
    scope: ReadScope,
    staffId: number,
  ): Promise<ExampleItemPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (item: ExampleItem): Key => keyOf(item, sortField);
    const sorted = this.matching(request, scope, staffId).sort((a, b) =>
      compareKeys(key(a), key(b), order),
    );
    let items: ExampleItem[];
    if (cursor?.direction === 'before') {
      const earlier = sorted.filter((item) => compareKeys(key(item), cursor.key, order) < 0);
      items = earlier.slice(Math.max(0, earlier.length - limit));
    } else {
      items = sorted
        .filter((item) => cursor === null || compareKeys(key(item), cursor.key, order) > 0)
        .slice(0, limit);
    }
    const total = sorted.length;
    const first = items[0];
    const last = items.at(-1);
    if (first === undefined || last === undefined) {
      return Promise.resolve({ items, nextCursor: null, prevCursor: null, total, rangeStart: 0 });
    }
    const rangeStart =
      sorted.filter((item) => compareKeys(key(item), key(first), order) < 0).length + 1;
    return Promise.resolve({
      items,
      nextCursor:
        rangeStart - 1 + items.length < total ? encodeCursor(sortField, key(last), 'after') : null,
      prevCursor: rangeStart > 1 ? encodeCursor(sortField, key(first), 'before') : null,
      total,
      rangeStart,
    });
  }

  /** The list's own match without the cursor: what the export counts before it reads a row. */
  count(request: ExampleItemListRequest, scope: ReadScope, staffId: number): Promise<number> {
    return Promise.resolve(this.matching(request, scope, staffId).length);
  }

  /** One row, or `null` when it is missing OR another member's under `own` (the same answer). */
  findById(id: number, scope: ReadScope, staffId: number): Promise<ExampleItem | null> {
    const item = this.rows.get(id);
    if (item === undefined || !this.visible(item, scope, staffId)) return Promise.resolve(null);
    return Promise.resolve(item);
  }

  /** Stores a row under the next integer id; past the bound the oldest row is evicted. */
  create(input: NewExampleItem): Promise<ExampleItem> {
    this.lastId += 1;
    const item: ExampleItem = { id: this.lastId, ...input };
    this.rows.set(item.id, item);
    if (this.rows.size > EXAMPLE_ITEM_MEMORY_MAX_ROWS) {
      const oldest = this.rows.keys().next();
      if (oldest.done !== true) this.rows.delete(oldest.value);
    }
    return Promise.resolve(item);
  }

  /** Changes the given fields of a row; `null` when the id is missing. */
  update(id: number, patch: { readonly name?: string | undefined }): Promise<ExampleItem | null> {
    const item = this.rows.get(id);
    if (item === undefined) return Promise.resolve(null);
    const updated: ExampleItem = {
      ...item,
      ...(patch.name === undefined ? {} : { name: patch.name }),
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  /**
   * The row scope, then `?q=` over the name (case-insensitive `contains`), then an export's ticked
   * keys: all three AND-ed, so a key only ever narrows and never reaches a row the scope hides.
   */
  private matching(
    request: ExampleItemListRequest,
    scope: ReadScope,
    staffId: number,
  ): ExampleItem[] {
    const needle = request.search?.toLowerCase() ?? null;
    const { ids } = request;
    return [...this.rows.values()].filter(
      (item) =>
        this.visible(item, scope, staffId) &&
        (needle === null || item.name.toLowerCase().includes(needle)) &&
        (ids === undefined || ids.includes(item.id)),
    );
  }

  /** `own` narrows to the caller's rows and never widens (T-3.1-11). */
  private visible(item: ExampleItem, scope: ReadScope, staffId: number): boolean {
    return scope === 'all' || item.ownerStaffId === staffId;
  }
}
