/**
 * ExampleItemRepository, the in-memory store behind the repository seam. It IS the implementation
 * (no table is invented), so it is proven here the way an int spec proves a Prisma repository: the
 * keyset order both ways with ties broken on the id, a walk forward and back that loses and repeats
 * no row, `total` and `rangeStart`, the row scope that only ever narrows (ADR-0033 decision 5,
 * T-3.1-11), the bound on the store, and the writes. Rows are seeded through `create` itself, with
 * fixed times.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXPORT_MAX_ROWS } from '../../../shared/http/csv.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import type {
  ExampleItem,
  ExampleItemListRequest,
  ExampleItemPage,
  ExampleItemSortField,
} from '../model/example-item.model.js';
import {
  EXAMPLE_ITEM_MEMORY_MAX_ROWS,
  ExampleItemRepository,
} from '../repository/example-item.repository.js';

const OWNER = 1;
const OTHER_OWNER = 3;
const STRANGER = 99;

/** Five rows, two pairs of equal names so a tie can only be broken by the id. */
const ROWS: readonly { name: string; owner: number }[] = [
  { name: 'Delta', owner: OWNER },
  { name: 'Alpha', owner: OTHER_OWNER },
  { name: 'Charlie', owner: OWNER },
  { name: 'Alpha', owner: OWNER },
  { name: 'Charlie', owner: OTHER_OWNER },
];

async function seeded(): Promise<ExampleItemRepository> {
  const repo = new ExampleItemRepository();
  for (const [index, row] of ROWS.entries()) {
    await repo.create({
      name: row.name,
      ownerStaffId: row.owner,
      createdAt: `2026-01-0${String(index + 1)}T00:00:00.000Z`,
      internalRef: `ref-${String(index + 1)}`,
    });
  }
  return repo;
}

function request(
  sortField: ExampleItemSortField,
  order: 'asc' | 'desc',
  limit = 10,
  search: string | null = null,
): ExampleItemListRequest {
  return { search, sortField, order, cursor: null, limit };
}

const ids = (page: ExampleItemPage): number[] => page.items.map((item) => item.id);

describe('ExampleItemRepository — the keyset order', () => {
  it('sorts by id both ways', async () => {
    const repo = await seeded();
    expect(ids(await repo.list(request('id', 'asc'), 'all', OWNER))).toEqual([1, 2, 3, 4, 5]);
    expect(ids(await repo.list(request('id', 'desc'), 'all', OWNER))).toEqual([5, 4, 3, 2, 1]);
  });

  it('sorts by name both ways and breaks ties on the id', async () => {
    const repo = await seeded();
    expect(ids(await repo.list(request('name', 'asc'), 'all', OWNER))).toEqual([2, 4, 3, 5, 1]);
    expect(ids(await repo.list(request('name', 'desc'), 'all', OWNER))).toEqual([1, 5, 3, 4, 2]);
  });

  it('walks forward with nextCursor and back with prevCursor, losing and repeating no row', async () => {
    const repo = await seeded();
    const forward: number[] = [];
    const pages: ExampleItemPage[] = [];
    let next: ExampleItemListRequest = request('name', 'asc', 2);
    for (;;) {
      const page = await repo.list(next, 'all', OWNER);
      pages.push(page);
      forward.push(...ids(page));
      const cursor = decodeCursor(page.nextCursor, 'name');
      if (cursor === null) break;
      next = { ...next, cursor };
    }
    expect(forward).toEqual([2, 4, 3, 5, 1]);
    expect(pages.map((page) => page.rangeStart)).toEqual([1, 3, 5]);
    expect(pages[0]?.prevCursor).toBeNull();
    expect(pages.at(-1)?.nextCursor).toBeNull();

    const backward: number[] = [];
    let page = pages.at(-1);
    while (page !== undefined) {
      backward.unshift(...ids(page));
      const cursor = decodeCursor(page.prevCursor, 'name');
      page = cursor === null ? undefined : await repo.list({ ...next, cursor }, 'all', OWNER);
    }
    expect(backward).toEqual([2, 4, 3, 5, 1]);
  });

  it('total counts every matching row and rangeStart is the rank of the first; both 0 on an empty page', async () => {
    const repo = await seeded();
    const page = await repo.list(request('id', 'asc', 2, 'alp'), 'all', OWNER);
    expect(ids(page)).toEqual([2, 4]);
    expect(page.total).toBe(2);
    expect(page.rangeStart).toBe(1);
    expect(page.nextCursor).toBeNull();

    const none = await repo.list(request('id', 'asc', 2, 'zzz'), 'all', OWNER);
    expect(none).toEqual({
      items: [],
      nextCursor: null,
      prevCursor: null,
      total: 0,
      rangeStart: 0,
    });
  });

  it("count is the list's own match without the cursor", async () => {
    const repo = await seeded();
    expect(await repo.count(request('name', 'asc', 1, 'charlie'), 'all', OWNER)).toBe(2);
    expect(await repo.count(request('name', 'asc'), 'all', OWNER)).toBe(ROWS.length);
  });
});

describe('ExampleItemRepository — the row scope only ever narrows (T-3.1-11)', () => {
  it("own never returns another member's row in list, count or findById", async () => {
    const repo = await seeded();
    const mine = await repo.list(request('id', 'asc'), 'own', OWNER);
    expect(ids(mine)).toEqual([1, 3, 4]);
    expect(mine.items.every((item: ExampleItem) => item.ownerStaffId === OWNER)).toBe(true);
    expect(await repo.count(request('id', 'asc'), 'own', OWNER)).toBe(3);
    expect(await repo.findById(2, 'own', OWNER)).toBeNull();
    expect((await repo.findById(1, 'own', OWNER))?.name).toBe('Delta');
  });

  it('own returns nothing for a member who owns no row; all returns every row whoever asks', async () => {
    const repo = await seeded();
    expect(ids(await repo.list(request('id', 'asc'), 'own', STRANGER))).toEqual([]);
    expect(await repo.count(request('id', 'asc'), 'own', STRANGER)).toBe(0);
    expect(ids(await repo.list(request('id', 'asc'), 'all', STRANGER))).toEqual([1, 2, 3, 4, 5]);
    expect((await repo.findById(2, 'all', STRANGER))?.name).toBe('Alpha');
  });
});

describe('ExampleItemRepository — the writes and the bound', () => {
  it('create assigns increasing integer ids and keeps every field it is given', async () => {
    const repo = new ExampleItemRepository();
    const first = await repo.create({
      name: 'One',
      ownerStaffId: OWNER,
      createdAt: '2026-01-01T00:00:00.000Z',
      internalRef: 'ref-1',
    });
    const second = await repo.create({
      name: 'Two',
      ownerStaffId: OWNER,
      createdAt: '2026-01-02T00:00:00.000Z',
      internalRef: 'ref-2',
    });
    expect(first).toEqual({
      id: 1,
      name: 'One',
      ownerStaffId: OWNER,
      createdAt: '2026-01-01T00:00:00.000Z',
      internalRef: 'ref-1',
    });
    expect(second.id).toBe(2);
  });

  it('update changes the name only; a missing id is null', async () => {
    const repo = await seeded();
    expect(await repo.update(1, { name: 'Echo' })).toMatchObject({
      id: 1,
      name: 'Echo',
      ownerStaffId: OWNER,
      internalRef: 'ref-1',
    });
    expect((await repo.findById(1, 'all', OWNER))?.name).toBe('Echo');
    expect(await repo.update(1, {})).toMatchObject({ id: 1, name: 'Echo' });
    expect(await repo.update(404, { name: 'Nobody' })).toBeNull();
  });

  it('past EXAMPLE_ITEM_MEMORY_MAX_ROWS the oldest row is gone, and the export cap stays reachable', async () => {
    expect(EXAMPLE_ITEM_MEMORY_MAX_ROWS).toBeGreaterThan(EXPORT_MAX_ROWS);
    const repo = new ExampleItemRepository();
    for (let i = 0; i <= EXAMPLE_ITEM_MEMORY_MAX_ROWS; i += 1) {
      await repo.create({
        name: 'Row',
        ownerStaffId: OWNER,
        createdAt: '2026-01-01T00:00:00.000Z',
        internalRef: 'ref',
      });
    }
    expect(await repo.findById(1, 'all', OWNER)).toBeNull();
    expect(await repo.findById(2, 'all', OWNER)).not.toBeNull();
    expect(await repo.count(request('id', 'asc'), 'all', OWNER)).toBe(EXAMPLE_ITEM_MEMORY_MAX_ROWS);
  });

  it('no code line names the database client: the store never touches it (the swap is the doc comment)', () => {
    const source = readFileSync(
      join(import.meta.dirname, '..', 'repository', 'example-item.repository.ts'),
      'utf8',
    );
    const code = source
      .split('\n')
      .filter((line) => !/^\s*(\/\*\*|\*|\*\/|\/\/)/.test(line))
      .join('\n');
    expect(code.toLowerCase()).not.toContain('prisma');
    expect(source).not.toContain('this.prisma');
  });
});

describe('ExampleItemRepository: the ticked keys only ever narrow (04.1.1-02, D-03)', () => {
  it('matching with ids returns only those ids that are also visible and match the search', async () => {
    const repo = await seeded();
    const keyed = { ...request('id', 'asc'), ids: [1, 2, 3, 99] };
    expect(ids(await repo.list(keyed, 'own', OWNER))).toEqual([1, 3]);
    expect(await repo.count(keyed, 'own', OWNER)).toBe(2);
    const searched = { ...request('id', 'asc', 10, 'charlie'), ids: [2, 3, 5] };
    expect(ids(await repo.list(searched, 'all', OWNER))).toEqual([3, 5]);
    expect(ids(await repo.list(searched, 'own', OTHER_OWNER))).toEqual([5]);
  });

  it('an empty ids list matches nothing; absent ids narrow nothing', async () => {
    const repo = await seeded();
    expect(await repo.count({ ...request('id', 'asc'), ids: [] }, 'all', OWNER)).toBe(0);
    expect(await repo.count(request('id', 'asc'), 'all', OWNER)).toBe(ROWS.length);
  });
});
