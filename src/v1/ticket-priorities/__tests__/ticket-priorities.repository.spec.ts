import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TICKET_PRIORITIES_FACADE_MAX_ROWS,
  type TicketPrioritiesListRequest,
} from '../model/ticket-priorities.model.js';
import { TicketPrioritiesRepository } from '../repository/ticket-priorities.repository.js';

const priorities = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
};
const tickets = { count: vi.fn() };
const prisma = { client: { tbltickets_priorities: priorities, tbltickets: tickets } };

const SELECT = { priorityid: true, name: true };

let repository: TicketPrioritiesRepository;

beforeEach(() => {
  vi.resetAllMocks();
  repository = new TicketPrioritiesRepository(prisma as never);
});

describe('TicketPrioritiesRepository', () => {
  const request = {
    sortField: 'id',
    order: 'desc',
    cursor: null,
    limit: 25,
    search: null,
  } as TicketPrioritiesListRequest;

  it('lists newest id first', async () => {
    priorities.findMany.mockResolvedValue([]);
    priorities.count.mockResolvedValue(0);
    const page = await repository.list(request);
    expect(priorities.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ priorityid: 'desc' }, { priorityid: 'desc' }],
      take: 25,
      select: SELECT,
    });
    expect(page).toEqual({
      items: [],
      nextCursor: null,
      prevCursor: null,
      total: 0,
      rangeStart: 0,
    });
  });

  it('maps rows to the model and sets the page range', async () => {
    priorities.findMany.mockResolvedValue([
      { priorityid: 2, name: 'High' },
      { priorityid: 1, name: 'Low' },
    ]);
    priorities.count.mockResolvedValueOnce(5).mockResolvedValueOnce(0);
    const page = await repository.list(request);
    expect(page.items).toEqual([
      { id: 2, name: 'High' },
      { id: 1, name: 'Low' },
    ]);
    expect(page.total).toBe(5);
    expect(page.rangeStart).toBe(1);
    expect(page.nextCursor).not.toBeNull();
    expect(page.prevCursor).toBeNull();
  });

  it('searches the name, and the id when the search is a number', async () => {
    priorities.findMany.mockResolvedValue([]);
    priorities.count.mockResolvedValue(0);
    await repository.list({ ...request, search: '12' });
    expect(priorities.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ name: { contains: '12' } }, { priorityid: 12 }] },
      }),
    );
  });

  it('counts with the same search', async () => {
    priorities.count.mockResolvedValue(3);
    expect(await repository.count({ ...request, search: 'hi' })).toBe(3);
    expect(priorities.count).toHaveBeenCalledWith({
      where: { OR: [{ name: { contains: 'hi' } }] },
    });
  });

  it('finds by id', async () => {
    priorities.findFirst.mockResolvedValue({ priorityid: 1, name: 'Low' });
    expect(await repository.findById(1)).toEqual({ id: 1, name: 'Low' });
    expect(priorities.findFirst).toHaveBeenCalledWith({
      where: { priorityid: 1 },
      select: SELECT,
    });
  });

  it('returns null when the id is not found', async () => {
    priorities.findFirst.mockResolvedValue(null);
    expect(await repository.findById(99)).toBeNull();
  });

  it('creates with the name only', async () => {
    priorities.create.mockResolvedValue({ priorityid: 2, name: 'High' });
    expect(await repository.create({ name: 'High' })).toEqual({ id: 2, name: 'High' });
    expect(priorities.create).toHaveBeenCalledWith({ data: { name: 'High' }, select: SELECT });
  });

  it('updates the name', async () => {
    priorities.update.mockResolvedValue({ priorityid: 2, name: 'Urgent' });
    expect(await repository.update(2, { name: 'Urgent' })).toEqual({ id: 2, name: 'Urgent' });
    expect(priorities.update).toHaveBeenCalledWith({
      where: { priorityid: 2 },
      data: { name: 'Urgent' },
      select: SELECT,
    });
  });

  it('returns null when the update finds no row (P2025)', async () => {
    priorities.update.mockRejectedValue({ code: 'P2025' });
    expect(await repository.update(2, { name: 'Urgent' })).toBeNull();
  });

  it('lets any other update error through', async () => {
    priorities.update.mockRejectedValue(new Error('db down'));
    await expect(repository.update(2, { name: 'Urgent' })).rejects.toThrow('db down');
  });

  it('removes by id and reports whether a row went', async () => {
    priorities.deleteMany.mockResolvedValue({ count: 1 });
    expect(await repository.remove(3)).toBe(true);
    expect(priorities.deleteMany).toHaveBeenCalledWith({ where: { priorityid: 3 } });
    priorities.deleteMany.mockResolvedValue({ count: 0 });
    expect(await repository.remove(3)).toBe(false);
  });

  it('reports whether a ticket uses the priority', async () => {
    tickets.count.mockResolvedValue(2);
    expect(await repository.isReferenced(3)).toBe(true);
    expect(tickets.count).toHaveBeenCalledWith({ where: { priority: 3 } });
    tickets.count.mockResolvedValue(0);
    expect(await repository.isReferenced(3)).toBe(false);
  });

  it('lists all priorities by name for the facade', async () => {
    priorities.findMany.mockResolvedValue([{ priorityid: 1, name: 'Low' }]);
    expect(await repository.listAll()).toEqual([{ id: 1, name: 'Low' }]);
    expect(priorities.findMany).toHaveBeenCalledWith({
      orderBy: [{ name: 'asc' }, { priorityid: 'asc' }],
      take: TICKET_PRIORITIES_FACADE_MAX_ROWS + 1,
      select: SELECT,
    });
  });

  it('refuses the full list when there are more rows than the facade limit', async () => {
    priorities.findMany.mockResolvedValue(
      Array.from({ length: TICKET_PRIORITIES_FACADE_MAX_ROWS + 1 }, (_, i) => ({
        priorityid: i + 1,
        name: `P${String(i)}`,
      })),
    );
    await expect(repository.listAll()).rejects.toThrow(/refused, not truncated/);
  });
});
