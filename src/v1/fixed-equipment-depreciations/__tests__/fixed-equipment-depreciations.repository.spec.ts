import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIXED_EQUIPMENT_DEPRECIATIONS_FACADE_MAX_ROWS,
  type FixedEquipmentDepreciationsListRequest,
} from '../model/fixed-equipment-depreciations.model.js';
import { FixedEquipmentDepreciationsRepository } from '../repository/fixed-equipment-depreciations.repository.js';

const depreciations = {
  findMany: vi.fn(),
  findFirst: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  deleteMany: vi.fn(),
};
const prisma = { client: { tblfe_depreciations: depreciations } };

const SELECT = { id: true, name: true, term: true, creator_id: true };

let repository: FixedEquipmentDepreciationsRepository;

beforeEach(() => {
  vi.resetAllMocks();
  repository = new FixedEquipmentDepreciationsRepository(prisma as never);
});

describe('FixedEquipmentDepreciationsRepository', () => {
  const request = {
    sortField: 'id',
    order: 'desc',
    cursor: null,
    limit: 25,
    search: null,
  } as FixedEquipmentDepreciationsListRequest;

  it('lists newest id first, every row under all', async () => {
    depreciations.findMany.mockResolvedValue([]);
    depreciations.count.mockResolvedValue(0);
    const page = await repository.list(request, 'all', 1);
    expect(depreciations.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ id: 'desc' }, { id: 'desc' }],
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

  it('maps rows to the model (the creator as creatorId, a missing term as null) and sets the page range', async () => {
    depreciations.findMany.mockResolvedValue([
      { id: 2, name: 'Depreciation 2', term: 36, creator_id: 1 },
      { id: 1, name: 'Legacy', term: null, creator_id: null },
    ]);
    depreciations.count.mockResolvedValueOnce(5).mockResolvedValueOnce(0);
    const page = await repository.list(request, 'all', 1);
    expect(page.items).toEqual([
      { id: 2, name: 'Depreciation 2', term: 36, creatorId: 1 },
      { id: 1, name: 'Legacy', term: null, creatorId: null },
    ]);
    expect(page.total).toBe(5);
    expect(page.rangeStart).toBe(1);
    expect(page.nextCursor).not.toBeNull();
    expect(page.prevCursor).toBeNull();
  });

  it('narrows own to the rows the member created, in the list and its count', async () => {
    depreciations.findMany.mockResolvedValue([]);
    depreciations.count.mockResolvedValue(0);
    await repository.list(request, 'own', 3);
    expect(depreciations.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ creator_id: 3 }] } }),
    );
    expect(depreciations.count).toHaveBeenCalledWith({ where: { AND: [{ creator_id: 3 }] } });
  });

  it('searches the name, and the id when the search is a number', async () => {
    depreciations.findMany.mockResolvedValue([]);
    depreciations.count.mockResolvedValue(0);
    await repository.list({ ...request, search: '12' }, 'all', 1);
    expect(depreciations.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ OR: [{ name: { contains: '12' } }, { id: 12 }] }] },
      }),
    );
  });

  it('ANDs the scope with the search: own only ever narrows', async () => {
    depreciations.findMany.mockResolvedValue([]);
    depreciations.count.mockResolvedValue(0);
    await repository.list({ ...request, search: 'line' }, 'own', 3);
    expect(depreciations.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ creator_id: 3 }, { OR: [{ name: { contains: 'line' } }] }] },
      }),
    );
  });

  it('counts with the same scope and search', async () => {
    depreciations.count.mockResolvedValue(3);
    expect(await repository.count({ ...request, search: 'line' }, 'all', 1)).toBe(3);
    expect(depreciations.count).toHaveBeenCalledWith({
      where: { AND: [{ OR: [{ name: { contains: 'line' } }] }] },
    });
  });

  it('finds by id under all', async () => {
    depreciations.findFirst.mockResolvedValue({
      id: 1,
      name: 'Depreciation 1',
      term: 12,
      creator_id: 1,
    });
    expect(await repository.findById(1, 'all', 2)).toEqual({
      id: 1,
      name: 'Depreciation 1',
      term: 12,
      creatorId: 1,
    });
    expect(depreciations.findFirst).toHaveBeenCalledWith({ where: { id: 1 }, select: SELECT });
  });

  it('finds by id under own only among the member’s rows', async () => {
    depreciations.findFirst.mockResolvedValue(null);
    expect(await repository.findById(1, 'own', 3)).toBeNull();
    expect(depreciations.findFirst).toHaveBeenCalledWith({
      where: { id: 1, creator_id: 3 },
      select: SELECT,
    });
  });

  it('creates with the name, the term and the creator', async () => {
    depreciations.create.mockResolvedValue({
      id: 5,
      name: 'Declining',
      term: 24,
      creator_id: 3,
    });
    expect(await repository.create({ name: 'Declining', term: 24, creatorId: 3 })).toEqual({
      id: 5,
      name: 'Declining',
      term: 24,
      creatorId: 3,
    });
    expect(depreciations.create).toHaveBeenCalledWith({
      data: { name: 'Declining', term: 24, creator_id: 3 },
      select: SELECT,
    });
  });

  it('updates the name and the term only', async () => {
    depreciations.update.mockResolvedValue({
      id: 2,
      name: 'Five years',
      term: 60,
      creator_id: 1,
    });
    expect(await repository.update(2, { name: 'Five years', term: 60 })).toEqual({
      id: 2,
      name: 'Five years',
      term: 60,
      creatorId: 1,
    });
    expect(depreciations.update).toHaveBeenCalledWith({
      where: { id: 2 },
      data: { name: 'Five years', term: 60 },
      select: SELECT,
    });
  });

  it('returns null when the update finds no row (P2025)', async () => {
    depreciations.update.mockRejectedValue({ code: 'P2025' });
    expect(await repository.update(2, { name: 'Five years', term: 60 })).toBeNull();
  });

  it('lets any other update error through', async () => {
    depreciations.update.mockRejectedValue(new Error('db down'));
    await expect(repository.update(2, { name: 'Five years', term: 60 })).rejects.toThrow('db down');
  });

  it('removes by id and reports whether a row went', async () => {
    depreciations.deleteMany.mockResolvedValue({ count: 1 });
    expect(await repository.remove(3)).toBe(true);
    expect(depreciations.deleteMany).toHaveBeenCalledWith({ where: { id: 3 } });
    depreciations.deleteMany.mockResolvedValue({ count: 0 });
    expect(await repository.remove(3)).toBe(false);
  });

  it('lists all depreciations by name for the facade', async () => {
    depreciations.findMany.mockResolvedValue([
      { id: 1, name: 'Depreciation 1', term: 12, creator_id: 1 },
    ]);
    expect(await repository.listAll()).toEqual([
      { id: 1, name: 'Depreciation 1', term: 12, creatorId: 1 },
    ]);
    expect(depreciations.findMany).toHaveBeenCalledWith({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: FIXED_EQUIPMENT_DEPRECIATIONS_FACADE_MAX_ROWS + 1,
      select: SELECT,
    });
  });

  it('refuses the full list when there are more rows than the facade limit', async () => {
    depreciations.findMany.mockResolvedValue(
      Array.from({ length: FIXED_EQUIPMENT_DEPRECIATIONS_FACADE_MAX_ROWS + 1 }, (_, i) => ({
        id: i + 1,
        name: `D${String(i)}`,
        term: 12,
        creator_id: 1,
      })),
    );
    await expect(repository.listAll()).rejects.toThrow(/refused, not truncated/);
  });
});
