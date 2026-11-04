import { AppError } from '../../../shared/errors/app-error.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import {
  LEAD_STATUSES_FACADE_MAX_ROWS,
  type LeadStatusRow,
  type LeadStatusUsage,
  type LeadStatusesListRequest,
  type LeadStatusesPage,
  type LeadStatusesSortField,
} from '../model/lead-statuses.model.js';
import {
  type CreateLeadStatusData,
  type UpdateLeadStatusData,
  type LeadStatusesRepository,
} from '../repository/lead-statuses.repository.js';

export const SEED_LEAD_STATUSES: readonly LeadStatusRow[] = [
  {
    id: 1,
    name: 'Customer',
    statusorder: 1,
    color: '#28B8DA',
    isdefault: 1,
  },
  {
    id: 2,
    name: 'New',
    statusorder: 2,
    color: '#757575',
    isdefault: 0,
  },
  {
    id: 3,
    name: 'Qualified',
    statusorder: 3,
    color: '#00A65A',
    isdefault: 0,
  },
];

export const ZERO_USAGE: LeadStatusUsage = {
  leads: 0,
  lastLeadStatus: 0,
  emailIntegration: 0,
  webToLead: 0,
};

export type LeadStatusesRepositoryPort = Pick<
  LeadStatusesRepository,
  | 'list'
  | 'count'
  | 'findById'
  | 'findByIds'
  | 'listAll'
  | 'create'
  | 'update'
  | 'remove'
  | 'usageByStatuses'
  | 'usageByStatus'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: LeadStatusRow, sortField: LeadStatusesSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

export class InMemoryLeadStatusesRepository implements LeadStatusesRepositoryPort {
  readonly usage = new Map<number, LeadStatusUsage>();

  private readonly rows = new Map<number, LeadStatusRow>();
  private lastId = 0;

  seed(rows: readonly LeadStatusRow[]): void {
    for (const row of rows) {
      this.rows.set(row.id, row);
      this.lastId = Math.max(this.lastId, row.id);
    }
  }

  private matching(request?: LeadStatusesListRequest): LeadStatusRow[] {
    const search = request?.search ?? null;

    if (search === null) {
      return [...this.rows.values()];
    }

    const needle = search.toLowerCase();

    return [...this.rows.values()].filter((row) => row.name.toLowerCase().includes(needle));
  }

  async list(request: LeadStatusesListRequest): Promise<LeadStatusesPage> {
    await Promise.resolve();
    const { sortField, order, cursor, limit } = request;
    const key = (row: LeadStatusRow): Key => keyOf(row, sortField);

    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));

    let items: LeadStatusRow[];

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
      return {
        items,
        nextCursor: null,
        prevCursor: null,
        total,
        rangeStart: 0,
      };
    }

    const rangeStart =
      sorted.filter((row) => compareKeys(key(row), key(first), order) < 0).length + 1;

    return {
      items,
      nextCursor:
        rangeStart - 1 + items.length < total ? encodeCursor(sortField, key(last), 'after') : null,
      prevCursor: rangeStart > 1 ? encodeCursor(sortField, key(first), 'before') : null,
      total,
      rangeStart,
    };
  }

  count(request?: LeadStatusesListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<LeadStatusRow | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  findByIds(ids: readonly number[]): Promise<readonly LeadStatusRow[]> {
    const wanted = new Set(ids);

    return Promise.resolve([...this.rows.values()].filter((row) => wanted.has(row.id)));
  }

  listAll(): Promise<readonly LeadStatusRow[]> {
    const rows = [...this.rows.values()].sort((a, b) => {
      const orderA = a.statusorder ?? Number.MAX_SAFE_INTEGER;
      const orderB = b.statusorder ?? Number.MAX_SAFE_INTEGER;

      return orderA - orderB || a.id - b.id;
    });

    if (rows.length > LEAD_STATUSES_FACADE_MAX_ROWS) {
      return Promise.reject(
        new AppError('ERP-INTERNAL-0001', 'Too many lead statuses for an unpaged read'),
      );
    }

    return Promise.resolve(rows);
  }

  create(input: CreateLeadStatusData): Promise<LeadStatusRow> {
    this.lastId += 1;

    const row: LeadStatusRow = {
      id: this.lastId,
      name: input.name,
      statusorder: input.statusorder ?? null,
      color: input.color ?? '#757575',
      isdefault: 0,
    };

    this.rows.set(row.id, row);

    return Promise.resolve(row);
  }

  update(id: number, patch: UpdateLeadStatusData): Promise<LeadStatusRow | null> {
    const existing = this.rows.get(id);

    if (existing === undefined) {
      return Promise.resolve(null);
    }

    const updated: LeadStatusRow = {
      ...existing,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.statusorder !== undefined ? { statusorder: patch.statusorder } : {}),
    };

    this.rows.set(id, updated);

    return Promise.resolve(updated);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  usageByStatuses(ids: readonly number[]): Promise<ReadonlyMap<number, LeadStatusUsage>> {
    return Promise.resolve(
      new Map([...new Set(ids)].map((id) => [id, this.usage.get(id) ?? ZERO_USAGE])),
    );
  }

  async usageByStatus(id: number): Promise<LeadStatusUsage> {
    return (await this.usageByStatuses([id])).get(id) ?? ZERO_USAGE;
  }
}

export function asRepository(fake: InMemoryLeadStatusesRepository): LeadStatusesRepository {
  return fake as unknown as LeadStatusesRepository;
}

export function seededStore(): InMemoryLeadStatusesRepository {
  const repo = new InMemoryLeadStatusesRepository();
  repo.seed(SEED_LEAD_STATUSES);
  return repo;
}
