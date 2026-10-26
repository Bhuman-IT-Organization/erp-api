/**
 * Repository: the Prisma client is replaced by a mock, so these specs prove the shape of each call
 * (and the order of the delete transaction) without a database.
 */
import { describe, expect, it, vi } from 'vitest';
import { CustomerGroupsRepository } from '../repository/customer-groups.repository.js';

/** The repository's own constructor argument, so no spec imports the Prisma service (DB-04, BE-08). */
type RepositoryDeps = ConstructorParameters<typeof CustomerGroupsRepository>[0];

function build() {
  const calls: string[] = [];
  const tx = {
    tblcustomer_groups: {
      deleteMany: vi.fn((): Promise<{ count: number }> => {
        calls.push('links');
        return Promise.resolve({ count: 3 });
      }),
    },
    tblcustomers_groups: {
      deleteMany: vi.fn((): Promise<{ count: number }> => {
        calls.push('group');
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  const groups = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    count: vi.fn(),
  };
  const client = {
    tblcustomers_groups: groups,
    $transaction: vi.fn((work: (inner: typeof tx) => Promise<boolean>) => work(tx)),
  };
  const repository = new CustomerGroupsRepository({ client } as unknown as RepositoryDeps);
  return { repository, client, tx, groups, calls };
}

describe('CustomerGroupsRepository.remove', () => {
  it('deletes the group links and then the group, inside ONE transaction', async () => {
    const { repository, client, tx, calls } = build();
    await expect(repository.remove(5)).resolves.toBe(true);
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.tblcustomer_groups.deleteMany).toHaveBeenCalledWith({ where: { groupid: 5 } });
    expect(tx.tblcustomers_groups.deleteMany).toHaveBeenCalledWith({ where: { id: 5 } });
    expect(calls).toEqual(['links', 'group']);
  });

  it('answers false when the group did not exist', async () => {
    const { repository, tx } = build();
    tx.tblcustomers_groups.deleteMany.mockResolvedValueOnce({ count: 0 });
    await expect(repository.remove(99)).resolves.toBe(false);
  });
});

describe('CustomerGroupsRepository.findById', () => {
  it('answers the row or null', async () => {
    const { repository, groups } = build();
    groups.findFirst.mockResolvedValueOnce({ id: 2, name: 'VIP' });
    await expect(repository.findById(2)).resolves.toEqual({ id: 2, name: 'VIP' });
    groups.findFirst.mockResolvedValueOnce(null);
    await expect(repository.findById(3)).resolves.toBeNull();
  });
});

describe('CustomerGroupsRepository.create', () => {
  it('stores the name only', async () => {
    const { repository, groups } = build();
    groups.create.mockResolvedValueOnce({ id: 8, name: 'Gold' });
    await expect(repository.create({ name: 'Gold' })).resolves.toEqual({ id: 8, name: 'Gold' });
    expect(groups.create).toHaveBeenCalledWith({
      data: { name: 'Gold' },
      select: { id: true, name: true },
    });
  });
});

describe('CustomerGroupsRepository.update', () => {
  it('changes the name and nothing else', async () => {
    const { repository, groups } = build();
    groups.update.mockResolvedValueOnce({ id: 4, name: 'Silver' });
    await expect(repository.update(4, { name: 'Silver' })).resolves.toEqual({
      id: 4,
      name: 'Silver',
    });
    expect(groups.update).toHaveBeenCalledWith({
      where: { id: 4 },
      data: { name: 'Silver' },
      select: { id: true, name: true },
    });
  });

  it('answers null when Prisma says the record was not found (P2025)', async () => {
    const { repository, groups } = build();
    groups.update.mockRejectedValueOnce({ code: 'P2025' });
    await expect(repository.update(404, { name: 'x' })).resolves.toBeNull();
  });

  it('rethrows any other error', async () => {
    const { repository, groups } = build();
    groups.update.mockRejectedValueOnce(new Error('database down'));
    await expect(repository.update(1, { name: 'x' })).rejects.toThrow('database down');
  });
});

describe('CustomerGroupsRepository.findByIds', () => {
  it('reads nothing for no ids', async () => {
    const { repository, groups } = build();
    await expect(repository.findByIds([])).resolves.toEqual([]);
    expect(groups.findMany).not.toHaveBeenCalled();
  });

  it('reads the rows of the given ids', async () => {
    const { repository, groups } = build();
    groups.findMany.mockResolvedValueOnce([{ id: 1, name: 'VIP' }]);
    await expect(repository.findByIds([1, 2])).resolves.toEqual([{ id: 1, name: 'VIP' }]);
  });
});

describe('CustomerGroupsRepository.listAll', () => {
  it('answers every row when under the limit', async () => {
    const { repository, groups } = build();
    groups.findMany.mockResolvedValueOnce([
      { id: 1, name: 'A' },
      { id: 2, name: 'B' },
    ]);
    await expect(repository.listAll()).resolves.toHaveLength(2);
  });

  it('refuses loudly above the limit instead of truncating', async () => {
    const { repository, groups } = build();
    groups.findMany.mockResolvedValueOnce(
      Array.from({ length: 1001 }, (_, index) => ({ id: index + 1, name: `g${String(index)}` })),
    );
    await expect(repository.listAll()).rejects.toThrow();
  });
});
