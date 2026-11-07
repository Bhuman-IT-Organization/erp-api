import { AppError } from '../../../shared/errors/app-error.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import {
  ESTIMATE_REQUEST_STATUSES_FACADE_MAX_ROWS,
  type EstimateRequestStatusRow,
  type EstimateRequestStatusesListRequest,
  type EstimateRequestStatusesPage,
  type EstimateRequestStatusSortField,
  type NewEstimateRequestStatus,
} from '../model/estimate-request-statuses.model.js';
import type { EstimateRequestStatusesRepository } from '../repository/estimate-request-statuses.repository.js';

export const SEED_STATUSES: readonly EstimateRequestStatusRow[] = [
  { id: 1, name: 'Open', color: '#ffffff', statusorder: 1, flag: null, total_request: 0 },
  { id: 2, name: 'Ready', color: '#757575', statusorder: 2, flag: null, total_request: 0 },
  { id: 3, name: 'Closed', color: '#000000', statusorder: 3, flag: 'built-in', total_request: 0 },
];

export type EstimateRequestStatusesRepositoryPort = Pick<
  EstimateRequestStatusesRepository,
  | 'list'
  | 'count'
  | 'findById'
  | 'create'
  | 'update'
  | 'deleteReferenceCount'
  | 'remove'
  | 'listAll'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: EstimateRequestStatusRow, field: EstimateRequestStatusSortField): Key {
  return field === 'name' ? [row.name, row.id] : [row.id, row.id];
}

export class InMemoryEstimateRequestStatusesRepository implements EstimateRequestStatusesRepositoryPort {
  readonly rows = new Map(SEED_STATUSES.map((row) => [row.id, row]));
  readonly referenceCounts = new Map<number, number>();
  readonly formReferenceCounts = new Map<number, number>();
  referenceCountError: Error | null = null;
  private lastId = Math.max(...this.rows.keys());

  reset(): void {
    this.rows.clear();
    for (const row of SEED_STATUSES) this.rows.set(row.id, row);
    this.referenceCounts.clear();
    this.formReferenceCounts.clear();
    this.referenceCountError = null;
    this.lastId = Math.max(...this.rows.keys());
  }

  list(request: EstimateRequestStatusesListRequest): Promise<EstimateRequestStatusesPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: EstimateRequestStatusRow): Key => keyOf(row, sortField);
    const matching = [...this.rows.values()].filter((row) => this.matches(row, request));
    const sorted = matching.sort((a, b) => compareKeys(key(a), key(b), order));
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
    if (first === undefined || last === undefined) {
      return Promise.resolve({
        items,
        nextCursor: null,
        prevCursor: null,
        total: matching.length,
        rangeStart: 0,
      });
    }
    const rangeStart =
      sorted.filter((row) => compareKeys(key(row), key(first), order) < 0).length + 1;
    return Promise.resolve({
      items,
      nextCursor:
        rangeStart - 1 + items.length < matching.length
          ? encodeCursor(sortField, key(last), 'after')
          : null,
      prevCursor: rangeStart > 1 ? encodeCursor(sortField, key(first), 'before') : null,
      total: matching.length,
      rangeStart,
    });
  }

  count(request: EstimateRequestStatusesListRequest): Promise<number> {
    return Promise.resolve(
      [...this.rows.values()].filter((row) => this.matches(row, request)).length,
    );
  }

  findById(id: number): Promise<EstimateRequestStatusRow | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(input: NewEstimateRequestStatus): Promise<EstimateRequestStatusRow> {
    this.lastId += 1;
    const row: EstimateRequestStatusRow = {
      id: this.lastId,
      ...input,
      flag: null,
      total_request: 0,
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  update(
    id: number,
    patch: Partial<NewEstimateRequestStatus>,
  ): Promise<EstimateRequestStatusRow | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated = { ...row, ...patch };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  deleteReferenceCount(id: number): Promise<{
    readonly requestCount: number;
    readonly formCount: number;
  }> {
    if (this.referenceCountError !== null) return Promise.reject(this.referenceCountError);
    return Promise.resolve({
      requestCount: this.referenceCounts.get(id) ?? 0,
      formCount: this.formReferenceCounts.get(id) ?? 0,
    });
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  listAll(): Promise<readonly EstimateRequestStatusRow[]> {
    const rows = [...this.rows.values()].sort(
      (a, b) =>
        (a.statusorder ?? Number.MAX_SAFE_INTEGER) - (b.statusorder ?? Number.MAX_SAFE_INTEGER) ||
        a.id - b.id,
    );
    if (rows.length > ESTIMATE_REQUEST_STATUSES_FACADE_MAX_ROWS) {
      return Promise.reject(
        new AppError('ERP-INTERNAL-0001', 'too many estimate request statuses'),
      );
    }
    return Promise.resolve(rows);
  }

  private matches(
    row: EstimateRequestStatusRow,
    request: EstimateRequestStatusesListRequest,
  ): boolean {
    const search = request.search;
    if (search === null) return true;
    return (
      row.name.toLowerCase().includes(search.toLowerCase()) ||
      (/^\d+$/.test(search) && row.id === Number(search))
    );
  }
}

export function asRepository(
  fake: InMemoryEstimateRequestStatusesRepository,
): EstimateRequestStatusesRepository {
  return fake as unknown as EstimateRequestStatusesRepository;
}
