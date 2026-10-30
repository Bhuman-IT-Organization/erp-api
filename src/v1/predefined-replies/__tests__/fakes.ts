import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import type {
  NewPredefinedReply,
  PredefinedReply,
  PredefinedRepliesListRequest,
  PredefinedRepliesPage,
  UpdatePredefinedReply,
  PredefinedRepliesSortField,
} from '../model/predefined-replies.model.js';
import type { PredefinedRepliesRepository } from '../repository/predefined-replies.repository.js';

type Key = readonly [KeyValue, number];

const SEED_ITEMS: readonly NewPredefinedReply[] = [
  { name: 'First', message: 'First reply message' },
  { name: 'Second', message: 'Second reply message' },
  { name: 'Third', message: 'Third reply message' },
];

function keyOf(row: PredefinedReply, field: PredefinedRepliesSortField): Key {
  return field === 'name' ? [row.name, row.id] : [row.id, row.id];
}

export class InMemoryPredefinedRepliesRepository {
  private readonly rows = new Map<number, PredefinedReply>();
  private lastId = 0;

  async seed(): Promise<void> {
    for (const item of SEED_ITEMS) await this.create(item);
  }

  count(request: PredefinedRepliesListRequest): Promise<number> {
    return this.list(request).then((page) => page.total);
  }

  list(request: PredefinedRepliesListRequest): Promise<PredefinedRepliesPage> {
    const { search, sortField, order, cursor, limit } = request;
    const needle = search?.toLowerCase() ?? null;
    const key = (row: PredefinedReply): Key => keyOf(row, sortField);

    const numericId = needle !== null && /^\d+$/.test(needle) ? Number(needle) : null;

    const sorted = [...this.rows.values()]
      .filter(
        (row) =>
          needle === null ||
          row.name.toLowerCase().includes(needle) ||
          (numericId !== null &&
            Number.isSafeInteger(numericId) &&
            numericId > 0 &&
            row.id === numericId),
      )
      .sort((a, b) => compareKeys(key(a), key(b), order));

    let items: PredefinedReply[];
    if (cursor?.direction === 'before') {
      const earlier = sorted.filter((row) => compareKeys(key(row), cursor.key, order) < 0);
      items = earlier.slice(Math.max(0, earlier.length - limit));
    } else {
      items = sorted
        .filter((row) => cursor === null || compareKeys(key(row), cursor.key, order) > 0)
        .slice(0, limit);
    }

    const total = sorted.length;
    const first = items[0];
    const last = items.at(-1);

    if (first === undefined || last === undefined) {
      return Promise.resolve({ items, nextCursor: null, prevCursor: null, total, rangeStart: 0 });
    }

    const rangeStart =
      sorted.filter((row) => compareKeys(key(row), key(first), order) < 0).length + 1;

    return Promise.resolve({
      items,
      nextCursor:
        rangeStart - 1 + items.length < total ? encodeCursor(sortField, key(last), 'after') : null,
      prevCursor: rangeStart > 1 ? encodeCursor(sortField, key(first), 'before') : null,
      total,
      rangeStart,
    });
  }

  findById(id: number): Promise<PredefinedReply | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  listAll(): Promise<PredefinedReply[]> {
    return Promise.resolve(
      [...this.rows.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id),
    );
  }

  findByIds(ids: readonly number[]): Promise<PredefinedReply[]> {
    return Promise.resolve(
      ids.flatMap((id) => {
        const row = this.rows.get(id);
        return row === undefined ? [] : [row];
      }),
    );
  }

  create(input: NewPredefinedReply): Promise<PredefinedReply> {
    const row: PredefinedReply = {
      id: ++this.lastId,
      name: input.name,
      message: input.message,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  update(id: number, input: UpdatePredefinedReply): Promise<PredefinedReply | null> {
    const existing = this.rows.get(id);
    if (existing === undefined) return Promise.resolve(null);
    const row: PredefinedReply = {
      id,
      name: input.name ?? existing.name,
      message: input.message ?? existing.message,
    };
    this.rows.set(id, row);
    return Promise.resolve(row);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }
}

export function asRepository(
  fake: InMemoryPredefinedRepliesRepository,
): PredefinedRepliesRepository {
  return fake as unknown as PredefinedRepliesRepository;
}
