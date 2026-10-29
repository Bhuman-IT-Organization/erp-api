import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import type {
  NewTicketStatus,
  TicketStatus,
  TicketStatusPatch,
  TicketStatusesListRequest,
  TicketStatusesPage,
  TicketStatusesSortField,
} from '../model/ticket-statuses.model.js';
import type { TicketStatusesRepository } from '../repository/ticket-statuses.repository.js';

export const SEED_TICKET_STATUSES: readonly TicketStatus[] = [
  {
    ticketstatusid: 1,
    name: 'Open',
    isdefault: 1,
    statuscolor: '#03a9f4',
    statusorder: 1,
    ticket_count: 0,
  },
  {
    ticketstatusid: 2,
    name: 'In progress',
    isdefault: 0,
    statuscolor: '#ff2d42',
    statusorder: 2,
    ticket_count: 0,
  },
  {
    ticketstatusid: 3,
    name: 'Closed',
    isdefault: 0,
    statuscolor: null,
    statusorder: 3,
    ticket_count: 0,
  },
];

export type TicketStatusesRepositoryPort = Pick<
  TicketStatusesRepository,
  'list' | 'count' | 'findById' | 'create' | 'update' | 'remove' | 'hasTicketReferences' | 'listAll'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: TicketStatus, sortField: TicketStatusesSortField): Key {
  return sortField === 'name'
    ? [row.name, row.ticketstatusid]
    : [row.ticketstatusid, row.ticketstatusid];
}

export class InMemoryTicketStatusesRepository implements TicketStatusesRepositoryPort {
  readonly ticketReferences = new Set<number>();
  readonly ticketCounts = new Map<number, number>();
  private readonly rows = new Map<number, TicketStatus>();
  private lastId = 0;

  seed(rows: readonly TicketStatus[]): void {
    for (const row of rows) {
      this.rows.set(row.ticketstatusid, row);
      this.lastId = Math.max(this.lastId, row.ticketstatusid);
      this.ticketCounts.set(row.ticketstatusid, row.ticket_count);
    }
  }
  private matching(request: TicketStatusesListRequest): TicketStatus[] {
    const search = request.search;
    if (search === null) return [...this.rows.values()];
    const needle = search.toLowerCase();
    const id = /^\d+$/.test(search) ? Number(search) : null;
    return [...this.rows.values()].filter(
      (row) =>
        row.name.toLowerCase().includes(needle) || (id !== null && row.ticketstatusid === id),
    );
  }

  list(request: TicketStatusesListRequest): Promise<TicketStatusesPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: TicketStatus): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: TicketStatus[];
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
    const withCounts = items.map((row) => ({
      ...row,
      ticket_count: Math.max(
        this.ticketCounts.get(row.ticketstatusid) ?? 0,
        this.ticketReferences.has(row.ticketstatusid) ? 1 : 0,
      ),
    }));
    if (first === undefined || last === undefined) {
      return Promise.resolve({
        items: withCounts,
        nextCursor: null,
        prevCursor: null,
        total,
        rangeStart: 0,
      });
    }
    const rangeStart =
      sorted.filter((row) => compareKeys(key(row), key(first), order) < 0).length + 1;
    return Promise.resolve({
      items: withCounts,
      nextCursor:
        rangeStart - 1 + items.length < total ? encodeCursor(sortField, key(last), 'after') : null,
      prevCursor: rangeStart > 1 ? encodeCursor(sortField, key(first), 'before') : null,
      total,
      rangeStart,
    });
  }

  count(request: TicketStatusesListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<TicketStatus | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    return Promise.resolve({
      ...row,
      ticket_count: Math.max(this.ticketCounts.get(id) ?? 0, this.ticketReferences.has(id) ? 1 : 0),
    });
  }

  create(input: NewTicketStatus): Promise<TicketStatus> {
    this.lastId += 1;
    const row: TicketStatus = {
      ticketstatusid: this.lastId,
      name: input.name,
      isdefault: 0,
      statuscolor: input.statuscolor ?? null,
      statusorder: input.statusorder ?? null,
      ticket_count: 0,
    };
    this.rows.set(row.ticketstatusid, row);
    this.ticketCounts.set(row.ticketstatusid, 0);
    return Promise.resolve(row);
  }

  update(id: number, patch: TicketStatusPatch): Promise<TicketStatus | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated: TicketStatus = {
      ...row,
      ...patch,
      ticket_count: Math.max(this.ticketCounts.get(id) ?? 0, this.ticketReferences.has(id) ? 1 : 0),
    };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  hasTicketReferences(id: number): Promise<boolean> {
    const count = Math.max(this.ticketCounts.get(id) ?? 0, this.ticketReferences.has(id) ? 1 : 0);
    return Promise.resolve(count > 0);
  }

  listAll(): Promise<readonly TicketStatus[]> {
    return Promise.resolve(
      [...this.rows.values()].map((row) => ({
        ...row,
        ticket_count: Math.max(
          this.ticketCounts.get(row.ticketstatusid) ?? 0,
          this.ticketReferences.has(row.ticketstatusid) ? 1 : 0,
        ),
      })),
    );
  }
}

export function asRepository(fake: InMemoryTicketStatusesRepository): TicketStatusesRepository {
  return fake as unknown as TicketStatusesRepository;
}

export function seededStore(): InMemoryTicketStatusesRepository {
  const repo = new InMemoryTicketStatusesRepository();
  repo.seed(SEED_TICKET_STATUSES);
  return repo;
}
