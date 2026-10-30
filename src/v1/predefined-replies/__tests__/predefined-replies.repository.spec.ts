import { describe, expect, it, vi } from 'vitest';
import type { PredefinedRepliesListRequest } from '../model/predefined-replies.model.js';
import { PredefinedRepliesRepository } from '../repository/predefined-replies.repository.js';

const baseRequest: PredefinedRepliesListRequest = {
  search: null,
  sortField: 'name',
  order: 'asc',
  cursor: null,
  limit: 20,
};

function build(rows: unknown[] = []) {
  const calls: { method: string; args: unknown }[] = [];

  const delegate = {
    count: vi.fn((args: unknown) => {
      calls.push({ method: 'count', args });
      return Promise.resolve(0);
    }),
    findMany: vi.fn((args: unknown) => {
      calls.push({ method: 'findMany', args });
      return Promise.resolve(rows);
    }),
    findUnique: vi.fn((args: unknown) => {
      calls.push({ method: 'findUnique', args });
      return Promise.resolve(rows[0] ?? null);
    }),
    create: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn(),
  };

  const prisma = {
    client: { tbltickets_predefined_replies: delegate },
  };

  const repository = new PredefinedRepliesRepository(prisma as never);

  return { repository, calls, delegate };
}

describe('PredefinedRepliesRepository', () => {
  it('searches name only, and adds an exact ID for an all-digit query', async () => {
    const { repository, calls } = build();

    await repository.count({ ...baseRequest, search: 'welcome' });

    expect(calls[0]?.args).toEqual({
      where: { OR: [{ name: { contains: 'welcome' } }] },
    });

    const numeric = build();

    await numeric.repository.count({ ...baseRequest, search: '12' });

    expect(numeric.calls[0]?.args).toEqual({
      where: { OR: [{ name: { contains: '12' } }, { id: 12 }] },
    });
  });

  it('reads all records ordered by name then ID with stored HTML', async () => {
    const rows = [
      { id: 2, name: 'B', message: '<p>B</p>' },
      { id: 1, name: 'A', message: '<p>A</p>' },
    ];

    const { repository, calls } = build(rows);

    await expect(repository.listAll()).resolves.toEqual(rows);

    expect(calls[0]).toEqual({
      method: 'findMany',
      args: {
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, message: true },
      },
    });
  });

  it('uses findUnique for findById and skips the query for an empty ID list', async () => {
    const { repository, calls } = build([{ id: 4, name: 'A', message: '&lt;p&gt;' }]);

    await expect(repository.findById(4)).resolves.toEqual({
      id: 4,
      name: 'A',
      message: '&lt;p&gt;',
    });

    expect(calls[0]).toEqual({
      method: 'findUnique',
      args: {
        where: { id: 4 },
        select: { id: true, name: true, message: true },
      },
    });

    calls.length = 0;

    await expect(repository.findByIds([])).resolves.toEqual([]);
    expect(calls).toEqual([]);
  });

  it('fetches requested IDs in one query and returns only stored rows', async () => {
    const { repository, calls } = build([{ id: 4, name: 'A', message: 'A' }]);

    await expect(repository.findByIds([4, 9])).resolves.toEqual([
      { id: 4, name: 'A', message: 'A' },
    ]);

    expect(calls[0]).toEqual({
      method: 'findMany',
      args: {
        where: { id: { in: [4, 9] } },
        select: { id: true, name: true, message: true },
      },
    });
  });
});
