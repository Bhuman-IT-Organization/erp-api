/**
 * The in-memory fake of the module's repository and the seed rows the service and facade specs
 * share. It answers the repository's public methods with the same keyset order both ways (ties
 * broken on the id), `total` and `rangeStart`, and the same `q` (the name contains it,
 * case-insensitively; an all-digit `q` is also the id).
 */
import { AppError } from '../../../shared/errors/app-error.js';
import { compareKeys, encodeCursor, type KeyValue } from '../../../shared/http/keyset.js';
import {
  ANNOUNCEMENTS_FACADE_MAX_ROWS,
  type AnnouncementPatch,
  type AnnouncementRow,
  type AnnouncementsListRequest,
  type AnnouncementsPage,
  type AnnouncementsSortField,
  type NewAnnouncement,
} from '../model/announcements.model.js';
import type { AnnouncementsRepository } from '../repository/announcements.repository.js';

/** Three rows, ids 1 to 3. By the default `-dateadded` they read 3, 2, 1; by name 1, 3, 2. */
export const SEED_ANNOUNCEMENTS: readonly AnnouncementRow[] = [
  {
    id: 1,
    name: 'Head Office',
    message: 'Open on Sunday',
    dateadded: new Date(Date.UTC(2026, 0, 5, 9, 0, 0)),
    showtousers: 1,
    showtostaff: 1,
    showname: 0,
  },
  {
    id: 2,
    name: 'Warehouse',
    message: null,
    dateadded: new Date(Date.UTC(2026, 0, 20, 9, 0, 0)),
    showtousers: 0,
    showtostaff: 1,
    showname: 1,
  },
  {
    id: 3,
    name: 'Holiday',
    message: 'Closed on Friday',
    dateadded: new Date(Date.UTC(2026, 1, 10, 14, 30, 0)),
    showtousers: 1,
    showtostaff: 0,
    showname: 0,
  },
];

/** The repository's public surface, which the fake answers method for method. */
export type AnnouncementsRepositoryPort = Pick<
  AnnouncementsRepository,
  'list' | 'count' | 'findById' | 'create' | 'update' | 'remove' | 'listAll' | 'findByIds'
>;

type Key = readonly [KeyValue, number];

function keyOf(row: AnnouncementRow, sortField: AnnouncementsSortField): Key {
  if (sortField === 'name') return [row.name, row.id];
  return [row.dateadded.getTime(), row.id];
}

export class InMemoryAnnouncementsRepository implements AnnouncementsRepositoryPort {
  private readonly rows = new Map<number, AnnouncementRow>();
  private lastId = 0;

  /** Puts rows in exactly as given (ids included). */
  seed(rows: readonly AnnouncementRow[]): void {
    for (const row of rows) {
      this.rows.set(row.id, row);
      this.lastId = Math.max(this.lastId, row.id);
    }
  }

  list(request: AnnouncementsListRequest): Promise<AnnouncementsPage> {
    const { sortField, order, cursor, limit } = request;
    const key = (row: AnnouncementRow): Key => keyOf(row, sortField);
    const sorted = this.matching(request).sort((a, b) => compareKeys(key(a), key(b), order));
    let items: AnnouncementRow[];
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

  count(request: AnnouncementsListRequest): Promise<number> {
    return Promise.resolve(this.matching(request).length);
  }

  findById(id: number): Promise<AnnouncementRow | null> {
    return Promise.resolve(this.rows.get(id) ?? null);
  }

  create(input: NewAnnouncement, dateadded: Date): Promise<AnnouncementRow> {
    this.lastId += 1;
    const row: AnnouncementRow = { id: this.lastId, dateadded, ...input };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  /** The four saved fields; the date stays as it was. */
  update(id: number, patch: AnnouncementPatch): Promise<AnnouncementRow | null> {
    const row = this.rows.get(id);
    if (row === undefined) return Promise.resolve(null);
    const updated: AnnouncementRow = { ...row, ...patch };
    this.rows.set(id, updated);
    return Promise.resolve(updated);
  }

  remove(id: number): Promise<boolean> {
    return Promise.resolve(this.rows.delete(id));
  }

  /** The date descending, then the id descending (the order Perfex's portal reads). */
  listAll(): Promise<readonly AnnouncementRow[]> {
    const rows = [...this.rows.values()].sort(
      (a, b) => b.dateadded.getTime() - a.dateadded.getTime() || b.id - a.id,
    );
    if (rows.length > ANNOUNCEMENTS_FACADE_MAX_ROWS) {
      return Promise.reject(new AppError('ERP-INTERNAL-0001', 'too many announcements'));
    }
    return Promise.resolve(rows);
  }

  findByIds(ids: readonly number[]): Promise<readonly AnnouncementRow[]> {
    return Promise.resolve([...this.rows.values()].filter((row) => ids.includes(row.id)));
  }

  private matching(request: AnnouncementsListRequest): AnnouncementRow[] {
    const search = request.search;
    if (search === null) return [...this.rows.values()];
    const needle = search.toLowerCase();
    const id = /^\d+$/.test(search) ? Number(search) : null;
    return [...this.rows.values()].filter(
      (row) => row.name.toLowerCase().includes(needle) || row.id === id,
    );
  }
}

/** The fake where the module expects the repository (the real class has a private `prisma` field). */
export function asRepository(fake: InMemoryAnnouncementsRepository): AnnouncementsRepository {
  return fake as unknown as AnnouncementsRepository;
}

/** A new store seeded with `SEED_ANNOUNCEMENTS` (ids 1 to 3). */
export function seededStore(): InMemoryAnnouncementsRepository {
  const repo = new InMemoryAnnouncementsRepository();
  repo.seed(SEED_ANNOUNCEMENTS);
  return repo;
}
