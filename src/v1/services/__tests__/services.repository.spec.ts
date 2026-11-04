import { describe, expect, it, vi, beforeEach } from 'vitest';
import { ServicesRepository } from '../repository/services.repository.js';

describe('ServicesRepository', () => {
  const prisma = {
    client: {
      tblservices: {
        findMany: vi.fn(),
        count: vi.fn(),
        findFirst: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        deleteMany: vi.fn(),
      },
      tbltickets: {
        count: vi.fn(),
      },
    },
  };

  let repository: ServicesRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repository = new ServicesRepository(prisma as never);
  });

  describe('findById', () => {
    it('returns a service when the id exists', async () => {
      prisma.client.tblservices.findFirst.mockResolvedValue({
        serviceid: 1,
        name: 'Gold',
      });

      await expect(repository.findById(1)).resolves.toEqual({
        id: 1,
        name: 'Gold',
      });

      expect(prisma.client.tblservices.findFirst).toHaveBeenCalledWith({
        where: { serviceid: 1 },
        select: { serviceid: true, name: true },
      });
    });

    it('returns null when the service does not exist', async () => {
      prisma.client.tblservices.findFirst.mockResolvedValue(null);

      await expect(repository.findById(99)).resolves.toBeNull();
    });
  });

  describe('create', () => {
    it('creates a service using its name', async () => {
      prisma.client.tblservices.create.mockResolvedValue({
        serviceid: 5,
        name: 'Gold',
      });

      await expect(repository.create({ name: 'Gold' })).resolves.toEqual({
        id: 5,
        name: 'Gold',
      });

      expect(prisma.client.tblservices.create).toHaveBeenCalledWith({
        data: { name: 'Gold' },
        select: { serviceid: true, name: true },
      });
    });
  });

  describe('update', () => {
    it('updates the service name', async () => {
      prisma.client.tblservices.update.mockResolvedValue({
        serviceid: 5,
        name: 'Platinum',
      });

      await expect(repository.update(5, { name: 'Platinum' })).resolves.toEqual({
        id: 5,
        name: 'Platinum',
      });

      expect(prisma.client.tblservices.update).toHaveBeenCalledWith({
        where: { serviceid: 5 },
        data: { name: 'Platinum' },
        select: { serviceid: true, name: true },
      });
    });

    it('returns null when Prisma reports that the service was not found', async () => {
      prisma.client.tblservices.update.mockRejectedValue({
        code: 'P2025',
      });

      await expect(repository.update(99, { name: 'Platinum' })).resolves.toBeNull();
    });

    it('rethrows unexpected database errors', async () => {
      const error = new Error('Database error');
      prisma.client.tblservices.update.mockRejectedValue(error);

      await expect(repository.update(5, { name: 'Platinum' })).rejects.toBe(error);
    });
  });

  describe('remove', () => {
    it('returns true when a service is deleted', async () => {
      prisma.client.tblservices.deleteMany.mockResolvedValue({
        count: 1,
      });

      await expect(repository.remove(5)).resolves.toBe(true);

      expect(prisma.client.tblservices.deleteMany).toHaveBeenCalledWith({
        where: { serviceid: 5 },
      });
    });

    it('returns false when no service is deleted', async () => {
      prisma.client.tblservices.deleteMany.mockResolvedValue({
        count: 0,
      });

      await expect(repository.remove(99)).resolves.toBe(false);
    });
  });

  describe('countTickets', () => {
    it('counts tickets that use the service', async () => {
      prisma.client.tbltickets.count.mockResolvedValue(3);

      await expect(repository.countTickets(5)).resolves.toBe(3);

      expect(prisma.client.tbltickets.count).toHaveBeenCalledWith({
        where: { service: 5 },
      });
    });
  });

  describe('count', () => {
    it('counts services without a search filter', async () => {
      prisma.client.tblservices.count.mockResolvedValue(4);

      await expect(
        repository.count({
          search: null,
          sortField: 'name',
          order: 'asc',
          cursor: null,
          limit: 10,
        }),
      ).resolves.toBe(4);

      expect(prisma.client.tblservices.count).toHaveBeenCalledWith({
        where: {},
      });
    });
  });

  describe('findByIds', () => {
    it('returns an empty array without querying the database for empty ids', async () => {
      await expect(repository.findByIds([])).resolves.toEqual([]);

      expect(prisma.client.tblservices.findMany).not.toHaveBeenCalled();
    });

    it('returns services matching the provided ids', async () => {
      prisma.client.tblservices.findMany.mockResolvedValue([
        { serviceid: 1, name: 'Gold' },
        { serviceid: 2, name: 'Silver' },
      ]);

      await expect(repository.findByIds([1, 2])).resolves.toEqual([
        { id: 1, name: 'Gold' },
        { id: 2, name: 'Silver' },
      ]);

      expect(prisma.client.tblservices.findMany).toHaveBeenCalledWith({
        where: { serviceid: { in: [1, 2] } },
        select: { serviceid: true, name: true },
      });
    });
  });
});
