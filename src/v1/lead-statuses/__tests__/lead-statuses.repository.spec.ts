import { describe, expect, it, vi } from 'vitest';

import { encodeCursor } from '../../../shared/http/keyset.js';
import type { LeadStatusesListRequest } from '../model/lead-statuses.model.js';
import { LeadStatusesRepository } from '../repository/lead-statuses.repository.js';

type PrismaDependency = ConstructorParameters<typeof LeadStatusesRepository>[0];
type Client = PrismaDependency['client'];

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'New',
  statusorder: 1,
  color: '#757575',
  isdefault: 0,
  ...overrides,
});

const request = (search: string | null = null) => ({
  search,
  sortField: 'id' as const,
  order: 'asc' as const,
  cursor: null,
  limit: 10,
});

function createRepository() {
  const findMany = vi.fn().mockResolvedValue([]);
  const findUnique = vi.fn().mockResolvedValue(null);
  const count = vi.fn().mockResolvedValue(0);

  const create = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => row(data));

  const update = vi
    .fn()
    .mockImplementation(({ data }: { data: Record<string, unknown> }) => row(data));

  const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
  const queryRaw = vi.fn();

  const client = {
    tblleads_status: {
      findMany,
      findUnique,
      count,
      create,
      update,
      deleteMany,
    },
    $queryRaw: queryRaw,
  } as unknown as Client;

  return {
    repository: new LeadStatusesRepository({ client } as PrismaDependency),
    findMany,
    findUnique,
    count,
    create,
    update,
    deleteMany,
    queryRaw,
  };
}

function createUsageQueryMock(options?: {
  lastColumn?: boolean;
  webColumn?: boolean;
  failOn?: string;
}) {
  return vi.fn((strings: TemplateStringsArray): Promise<unknown> => {
    const sql = strings.join('?').replace(/\s+/g, ' ').trim();

    if (options?.failOn && sql.includes(options.failOn)) {
      return Promise.reject(new Error('Database query failed'));
    }

    if (sql.includes('information_schema.columns') && sql.includes("'last_lead_status'")) {
      return Promise.resolve([{ n: options?.lastColumn === false ? 0 : 1 }]);
    }

    if (sql.includes('information_schema.columns') && sql.includes("'tblweb_to_lead'")) {
      return Promise.resolve([{ n: options?.webColumn === false ? 0 : 1 }]);
    }

    if (sql.includes('FROM tblleads_email_integration')) {
      return Promise.resolve([{ id: 1, n: 2 }]);
    }

    if (sql.includes('FROM tblweb_to_lead')) {
      return Promise.resolve([{ id: 1, n: 5 }]);
    }

    if (sql.includes('last_lead_status')) {
      return Promise.resolve([{ id: 1, n: 3 }]);
    }

    if (sql.includes('FROM tblleads')) {
      return Promise.resolve([{ id: 1, n: 4 }]);
    }

    return Promise.resolve([]);
  });
}

function repositoryWithRawQuery(queryRaw: ReturnType<typeof createUsageQueryMock>) {
  const client = {
    tblleads_status: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    $queryRaw: queryRaw,
  } as unknown as Client;

  return new LeadStatusesRepository({ client } as PrismaDependency);
}

describe('LeadStatusesRepository', () => {
  it('searches by name', async () => {
    const { repository, findMany } = createRepository();

    await repository.list(request('Open'));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ name: { contains: 'Open' } }] },
      }),
    );
  });

  it('matches numeric searches by name and ID', async () => {
    const { repository, findMany } = createRepository();

    await repository.list(request('123'));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ name: { contains: '123' } }, { id: 123 }],
        },
      }),
    );
  });
  it('matches the maximum signed 32-bit ID boundary', async () => {
    const { repository, findMany } = createRepository();

    await repository.list(request('2147483647'));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ name: { contains: '2147483647' } }, { id: 2147483647 }],
        },
      }),
    );
  });

  it('does not match IDs above the signed 32-bit maximum', async () => {
    const { repository, findMany } = createRepository();

    await repository.list(request('2147483648'));

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ name: { contains: '2147483648' } }],
        },
      }),
    );
  });

  describe('paging by cursor', () => {
    const page = (overrides: Partial<LeadStatusesListRequest>): LeadStatusesListRequest => ({
      search: null,
      sortField: 'name',
      order: 'asc',
      cursor: null,
      limit: 2,
      ...overrides,
    });
    const third = row({ id: 3, name: 'C' });
    const fourth = row({ id: 4, name: 'D' });

    it('reads after the cursor: the keyset, the order and both page cursors', async () => {
      const { repository, findMany, count } = createRepository();
      findMany.mockResolvedValue([third, fourth]);
      count.mockResolvedValueOnce(6).mockResolvedValueOnce(2);

      const result = await repository.list(
        page({ cursor: { sort: 'name', key: ['B', 2], direction: 'after' } }),
      );

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{}, { OR: [{ name: { gt: 'B' } }, { name: 'B', id: { gt: 2 } }] }] },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: 2,
        }),
      );
      expect(result.items.map((item) => item.id)).toEqual([3, 4]);
      expect(result).toMatchObject({
        total: 6,
        rangeStart: 3,
        nextCursor: encodeCursor('name', ['D', 4], 'after'),
        prevCursor: encodeCursor('name', ['C', 3], 'before'),
      });
    });

    it('reads before the cursor in reverse and answers the rows in list order', async () => {
      const { repository, findMany, count } = createRepository();
      findMany.mockResolvedValue([fourth, third]);
      count.mockResolvedValueOnce(6).mockResolvedValueOnce(2);

      const result = await repository.list(
        page({ cursor: { sort: 'name', key: ['E', 5], direction: 'before' } }),
      );

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{}, { OR: [{ name: { lt: 'E' } }, { name: 'E', id: { lt: 5 } }] }] },
          orderBy: [{ name: 'desc' }, { id: 'desc' }],
        }),
      );
      expect(result.items.map((item) => item.id)).toEqual([3, 4]);
      expect(count).toHaveBeenLastCalledWith({
        where: { AND: [{}, { OR: [{ name: { lt: 'C' } }, { name: 'C', id: { lt: 3 } }] }] },
      });
      expect(result).toMatchObject({
        rangeStart: 3,
        nextCursor: encodeCursor('name', ['D', 4], 'after'),
        prevCursor: encodeCursor('name', ['C', 3], 'before'),
      });
    });

    it('reads after the cursor on a descending sort with the keyset flipped', async () => {
      const { repository, findMany } = createRepository();

      await repository.list(
        page({ order: 'desc', cursor: { sort: 'name', key: ['B', 2], direction: 'after' } }),
      );

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { AND: [{}, { OR: [{ name: { lt: 'B' } }, { name: 'B', id: { lt: 2 } }] }] },
          orderBy: [{ name: 'desc' }, { id: 'desc' }],
        }),
      );
    });

    it('keeps the search beside the keyset', async () => {
      const { repository, findMany } = createRepository();

      await repository.list(
        page({ search: 'Op', cursor: { sort: 'name', key: ['B', 2], direction: 'after' } }),
      );

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            AND: [
              { OR: [{ name: { contains: 'Op' } }] },
              { OR: [{ name: { gt: 'B' } }, { name: 'B', id: { gt: 2 } }] },
            ],
          },
        }),
      );
    });

    it('answers no cursors on a page that holds every row', async () => {
      const { repository, findMany, count } = createRepository();
      findMany.mockResolvedValue([third, fourth]);
      count.mockResolvedValueOnce(2).mockResolvedValueOnce(0);

      await expect(repository.list(page({}))).resolves.toMatchObject({
        total: 2,
        rangeStart: 1,
        nextCursor: null,
        prevCursor: null,
      });
    });

    it('answers rangeStart 0 and no cursors on an empty page, with no second count', async () => {
      const { repository, count } = createRepository();

      await expect(repository.list(page({}))).resolves.toMatchObject({
        items: [],
        total: 0,
        rangeStart: 0,
        nextCursor: null,
        prevCursor: null,
      });
      expect(count).toHaveBeenCalledTimes(1);
    });
  });

  it('counts matching statuses', async () => {
    const { repository, count } = createRepository();
    count.mockResolvedValue(5);

    await expect(repository.count(request('Open'))).resolves.toBe(5);
  });

  it('finds a status by ID and returns null when missing', async () => {
    const { repository, findUnique } = createRepository();

    findUnique.mockResolvedValueOnce(row());

    await expect(repository.findById(1)).resolves.toEqual(row());
    await expect(repository.findById(99)).resolves.toBeNull();
  });

  it('finds multiple statuses using unique IDs', async () => {
    const { repository, findMany } = createRepository();

    findMany.mockResolvedValue([row()]);

    await expect(repository.findByIds([1, 1, 2])).resolves.toEqual([row()]);

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [1, 2] } },
      }),
    );
  });

  it('does not query for an empty ID list', async () => {
    const { repository, findMany } = createRepository();

    await expect(repository.findByIds([])).resolves.toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('lists all statuses within the configured limit', async () => {
    const { repository, findMany } = createRepository();

    findMany.mockResolvedValue([row()]);

    await expect(repository.listAll()).resolves.toEqual([row()]);
  });

  it('refuses listAll when more than 1,000 rows are returned', async () => {
    const { repository, findMany } = createRepository();

    findMany.mockResolvedValue(Array.from({ length: 1001 }, (_, i) => row({ id: i + 1 })));

    await expect(repository.listAll()).rejects.toMatchObject({
      code: 'ERP-INTERNAL-0001',
    });
  });

  it('uses the default colour when none is supplied', async () => {
    const { repository, create } = createRepository();

    await repository.create({ name: 'Open' });

    expect(create).toHaveBeenCalled();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: { color: '#757575' },
    });
  });

  it('uses the default colour when an empty colour is supplied', async () => {
    const { repository, create } = createRepository();

    await repository.create({ name: 'Open', color: '' });

    expect(create).toHaveBeenCalled();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: { color: '#757575' },
    });
  });

  it('preserves a supplied colour', async () => {
    const { repository, create } = createRepository();

    await repository.create({ name: 'Open', color: '#123456' });

    expect(create).toHaveBeenCalled();
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      data: { color: '#123456' },
    });
  });

  it('passes the supplied colour to Prisma when updating a status', async () => {
    const { repository, update } = createRepository();

    await repository.update(1, { color: '#123456' });

    expect(update).toHaveBeenCalled();
    expect(update.mock.calls[0]?.[0]).toMatchObject({
      where: { id: 1 },
      data: { color: '#123456' },
    });
  });

  it('returns null for a missing-row P2025 update', async () => {
    const { repository, update } = createRepository();

    update.mockRejectedValue({ code: 'P2025' });

    await expect(repository.update(99, { name: 'Updated' })).resolves.toBeNull();
  });

  it('rethrows update errors other than P2025', async () => {
    const { repository, update } = createRepository();

    update.mockRejectedValue(new Error('Database error'));

    await expect(repository.update(1, { name: 'Updated' })).rejects.toThrow('Database error');
  });

  it('returns true when remove deletes a row', async () => {
    const { repository } = createRepository();

    await expect(repository.remove(1)).resolves.toBe(true);
  });

  it('returns false when remove deletes no rows', async () => {
    const { repository, deleteMany } = createRepository();

    deleteMany.mockResolvedValue({ count: 0 });

    await expect(repository.remove(1)).resolves.toBe(false);
  });

  it('returns an empty usage map without querying for empty IDs', async () => {
    const queryRaw = createUsageQueryMock();
    const repository = repositoryWithRawQuery(queryRaw);

    await expect(repository.usageByStatuses([])).resolves.toEqual(new Map());

    expect(queryRaw).not.toHaveBeenCalled();
  });

  it('counts all four usage reference locations', async () => {
    const repository = repositoryWithRawQuery(createUsageQueryMock());

    await expect(repository.usageByStatuses([1])).resolves.toEqual(
      new Map([
        [
          1,
          {
            leads: 4,
            lastLeadStatus: 3,
            emailIntegration: 2,
            webToLead: 5,
          },
        ],
      ]),
    );
  });

  it('skips optional usage queries when their columns are missing', async () => {
    const queryRaw = createUsageQueryMock({
      lastColumn: false,
      webColumn: false,
    });

    const repository = repositoryWithRawQuery(queryRaw);

    await expect(repository.usageByStatuses([1])).resolves.toEqual(
      new Map([
        [
          1,
          {
            leads: 4,
            lastLeadStatus: 0,
            emailIntegration: 2,
            webToLead: 0,
          },
        ],
      ]),
    );

    expect(queryRaw).toHaveBeenCalledTimes(4);
  });

  it('throws ERP-LEADSTATUSES-0004 when a usage query fails', async () => {
    const repository = repositoryWithRawQuery(createUsageQueryMock({ failOn: 'FROM tblleads' }));

    await expect(repository.usageByStatuses([1])).rejects.toMatchObject({
      code: 'ERP-LEADSTATUSES-0004',
    });
  });
});
