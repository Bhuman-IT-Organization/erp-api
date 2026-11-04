import { AppError } from '../../../shared/errors/app-error.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import {
  LEAD_SOURCES_FACADE_MAX_ROWS,
  type LeadSourceRow,
  type LeadSourcesListRequest,
  type LeadSourcesPage,
  type LeadSourcesSortField,
  type LeadSourceUsage,
  type NewLeadSource,
} from '../model/lead-sources.model.js';
import {
  LEAD_SOURCE_REFERENCES,
  referenceKey,
  type LeadSourcesRepository,
} from '../repository/lead-sources.repository.js';
import { NO_LEAD_SOURCE_USAGE } from '../service/lead-sources.transformer.js';

export const SEED_LEAD_SOURCES: readonly LeadSourceRow[] = [
  { id: 1, name: 'Website' },
  { id: 2, name: 'Referral' },
  { id: 3, name: 'Website' },
];

export const ZERO_USAGE: LeadSourceUsage = NO_LEAD_SOURCE_USAGE;

export type LeadSourcesRepositoryPort = Pick<
  LeadSourcesRepository,
  | 'list'
  | 'count'
  | 'findById'
  | 'create'
  | 'update'
  | 'remove'
  | 'presentReferences'
  | 'usageByLeadSource'
  | 'listAll'
  | 'findByIds'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: LeadSourceRow, field: LeadSourcesSortField): Key {
  return field === 'name' ? [row.name, row.id] : [row.id, row.id];
}

export class InMemoryLeadSourcesRepository implements LeadSourcesRepositoryPort {
  readonly usage = new Map<number, LeadSourceUsage>();
  private readonly rows = new Map<number, LeadSourceRow>();
  private lastId = 0;

  seed(rows: readonly LeadSourceRow[]): void {
    for (const row of rows) {
      this.rows.set(row.id, row);
      this.lastId = Math.max(this.lastId, row.id);
    }
  }

  list(request: LeadSourcesListRequest): Promise<LeadSourcesPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: LeadSourceRow): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    const items =
      cursor?.direction === 'before'
        ? sorted
            .filter((row) => compareKeys(key(row), cursor.key, order) < 0)
            .slice(
              Math.max(
                0,
                sorted.filter((row) => compareKeys(key(row), cursor.key, order) < 0).length - limit,
              ),
            )
        : sorted
            .filter((row) => cursor === null || compareKeys(key(row), cursor.key, order) > 0)
            .slice(0, limit);
    const first = items[0];
    const last = items.at(-1);
    if (first === undefined || last === undefined)
      return Promise.resolve({
        items,
        nextCursor: null,
        prevCursor: null,
        total: sorted.length,
        rangeStart: 0,
      });
    const rangeStart =
      sorted.filter((row) => compareKeys(key(row), key(first), order) < 0).length + 1;
    return Promise.resolve({
      items,
      nextCursor:
        rangeStart - 1 + items.length < sorted.length
          ? encodeCursor(sortField, key(last), 'after')
          : null,
      prevCursor: rangeStart > 1 ? encodeCursor(sortField, key(first), 'before') : null,
      total: sorted.length,
      rangeStart,
    });
  }

  count(request: LeadSourcesListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<LeadSourceRow | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(input: NewLeadSource): Promise<LeadSourceRow> {
    const row = { id: ++this.lastId, name: input.name };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  update(id: number, patch: { readonly name: string }): Promise<LeadSourceRow | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated = { ...row, name: patch.name };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  presentReferences(): Promise<ReadonlySet<string>> {
    return Promise.resolve(new Set(LEAD_SOURCE_REFERENCES.map(referenceKey)));
  }

  usageByLeadSource(ids: readonly number[]): Promise<ReadonlyMap<number, LeadSourceUsage>> {
    return Promise.resolve(new Map(ids.map((id) => [id, this.usage.get(id) ?? ZERO_USAGE])));
  }

  listAll(): Promise<readonly LeadSourceRow[]> {
    const rows = [...this.rows.values()].sort((a, b) =>
      compareKeys(keyOf(a, 'name'), keyOf(b, 'name'), 'asc'),
    );
    if (rows.length > LEAD_SOURCES_FACADE_MAX_ROWS)
      return Promise.reject(new AppError('ERP-INTERNAL-0001', 'too many lead sources'));
    return Promise.resolve(rows);
  }

  findByIds(ids: readonly number[]): Promise<readonly LeadSourceRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => ids.includes(row.id)));
  }

  private matching(request: LeadSourcesListRequest): LeadSourceRow[] {
    if (request.search === null) return [...this.rows.values()];
    const needle = request.search.toLowerCase();
    const id = /^\d+$/.test(request.search) ? Number(request.search) : null;
    return [...this.rows.values()].filter(
      (row) => row.name.toLowerCase().includes(needle) || row.id === id,
    );
  }
}

export function asRepository(fake: InMemoryLeadSourcesRepository): LeadSourcesRepository {
  return fake as unknown as LeadSourcesRepository;
}

export function seededStore(): InMemoryLeadSourcesRepository {
  const repository = new InMemoryLeadSourcesRepository();
  repository.seed(SEED_LEAD_SOURCES);
  return repository;
}
