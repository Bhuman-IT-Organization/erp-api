import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { LoggerService } from '../../../shared/logger/logger.service.js';
import { ServicesCreatedV1, ServicesDeletedV1, ServicesUpdatedV1 } from '../events/published.js';
import type { ServicesRepository } from '../repository/services.repository.js';
import { ServicesService } from '../service/services.service.js';
import { ServicesTransformer } from '../service/services.transformer.js';
import type { ServicesTransport } from '../service/services.transport.js';
import { ServicesValidator } from '../service/services.validator.js';
import type { Service } from '../model/services.model.js';
const ADMIN = { isAdmin: true, staffId: 1 } as unknown as AuthenticatedUser;
const STAFF = { isAdmin: false, staffId: 2 } as unknown as AuthenticatedUser;
const NOW = new Date('2026-10-24T10:00:00.000Z');

function build() {
  const repository = {
    list: vi.fn<(...args: never[]) => Promise<unknown>>(),
    count: vi.fn<(...args: never[]) => Promise<number>>(),
    findById: vi.fn<(...args: never[]) => Promise<Service | null>>(),
    create: vi.fn<(...args: never[]) => Promise<Service>>(),
    update: vi.fn<(...args: never[]) => Promise<Service | null>>(),
    remove: vi.fn<(...args: never[]) => Promise<boolean>>(),
    countTickets: vi.fn<(...args: never[]) => Promise<number>>(),
    listAll: vi.fn<(...args: never[]) => Promise<readonly Service[]>>(),
    findByIds: vi.fn<(...args: never[]) => Promise<readonly Service[]>>(),
  };
  const transport = { publish: vi.fn().mockResolvedValue(undefined) };
  const logger = { log: vi.fn() };
  const service = new ServicesService(
    new ServicesValidator(),
    repository as unknown as ServicesRepository,
    new ServicesTransformer(),
    transport as unknown as ServicesTransport,
    logger as unknown as LoggerService,
  );
  service.now = () => NOW;
  return { service, repository, transport, logger };
}

describe('ServicesService', () => {
  it('describes itself', () => {
    expect(build().service.describe()).toEqual({ module: 'services', version: 1 });
  });

  describe('administrators only (D-06, D-26)', () => {
    it('refuses every use case to a non-administrator before touching the repository', async () => {
      const { service, repository, transport } = build();
      const calls = [
        service.list(STAFF, {}),
        service.get(STAFF, { id: '1' }),
        service.create(STAFF, { name: 'a' }),
        service.update(STAFF, { id: '1' }, { name: 'a' }),
        service.remove(STAFF, { id: '1' }),
        service.exportCsv(STAFF, {}),
      ];
      for (const call of calls) await expect(call).rejects.toBeInstanceOf(AppError);
      for (const fn of Object.values(repository)) expect(fn).not.toHaveBeenCalled();
      expect(transport.publish).not.toHaveBeenCalled();
    });
  });

  describe('list and get', () => {
    it('lists one page in the id-descending default order', async () => {
      const { service, repository } = build();
      repository.list.mockResolvedValue({
        items: [{ id: 1, name: 'A' }],
        nextCursor: null,
        prevCursor: null,
        total: 1,
        rangeStart: 1,
      });
      const response = await service.list(ADMIN, {});
      expect(repository.list).toHaveBeenCalledWith(
        expect.objectContaining({ sortField: 'id', order: 'desc' }),
      );
      expect(response.data).toEqual([{ id: '1', name: 'A' }]);
    });

    it('reads one service', async () => {
      const { service, repository } = build();

      repository.findById.mockResolvedValue({ id: 4, name: 'Gold' });

      expect(await service.get(ADMIN, { id: '4' })).toEqual({
        id: '4',
        name: 'Gold',
      });

      expect(repository.findById).toHaveBeenCalledWith(4);
    });

    it('answers ERP-CORE-0004 for a missing id', async () => {
      const { service, repository } = build();
      repository.findById.mockResolvedValue(null);

      await expect(service.get(ADMIN, { id: '99' })).rejects.toMatchObject({
        code: 'ERP-CORE-0004',
      });
    });
  });

  describe('create', () => {
    it('writes the trimmed name, publishes the event after the write and logs the id', async () => {
      const { service, repository, transport, logger } = build();
      repository.create.mockResolvedValue({ id: 3, name: 'Gold' });

      const response = await service.create(ADMIN, { name: ' Gold ' });

      expect(repository.create).toHaveBeenCalledWith({ name: 'Gold' });
      expect(response).toEqual({ id: '3', name: 'Gold' });
      expect(transport.publish.mock.calls[0]?.[0]).toBeInstanceOf(ServicesCreatedV1);
      expect(logger.log).toHaveBeenCalledWith('service created', { id: 3 });
    });

    it('does not create with an invalid body', async () => {
      const { service, repository } = build();
      await expect(service.create(ADMIN, { name: '' })).rejects.toBeInstanceOf(AppError);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('renames and publishes the update event', async () => {
      const { service, repository, transport } = build();
      repository.update.mockResolvedValue({ id: 3, name: 'Silver' });

      const response = await service.update(ADMIN, { id: '3' }, { name: 'Silver' });

      expect(repository.update).toHaveBeenCalledWith(3, { name: 'Silver' });
      expect(response).toEqual({ id: '3', name: 'Silver' });
      expect(transport.publish.mock.calls[0]?.[0]).toBeInstanceOf(ServicesUpdatedV1);
    });

    it('answers ERP-CORE-0004 and publishes nothing for a missing id', async () => {
      const { service, repository, transport } = build();
      repository.update.mockResolvedValue(null);
      await expect(service.update(ADMIN, { id: '9' }, { name: 'x' })).rejects.toMatchObject({
        code: 'ERP-CORE-0004',
      });
      expect(transport.publish).not.toHaveBeenCalled();
    });
  });

  describe('remove (Perfex is_referenced)', () => {
    it('answers ERP-CORE-0004 for a missing id and deletes nothing', async () => {
      const { service, repository } = build();
      repository.findById.mockResolvedValue(null);
      await expect(service.remove(ADMIN, { id: '9' })).rejects.toMatchObject({
        code: 'ERP-CORE-0004',
      });
      expect(repository.remove).not.toHaveBeenCalled();
    });

    it('refuses with ERP-SERVICES-0001 while a ticket uses the service', async () => {
      const { service, repository, transport } = build();
      repository.findById.mockResolvedValue({ id: 2, name: 'Gold' });
      repository.countTickets.mockResolvedValue(4);

      await expect(service.remove(ADMIN, { id: '2' })).rejects.toMatchObject({
        code: 'ERP-SERVICES-0001',
      });
      expect(repository.countTickets).toHaveBeenCalledWith(2);
      expect(repository.remove).not.toHaveBeenCalled();
      expect(transport.publish).not.toHaveBeenCalled();
    });

    it('deletes an unused service and publishes the delete event', async () => {
      const { service, repository, transport, logger } = build();
      repository.findById.mockResolvedValue({ id: 2, name: 'Gold' });
      repository.countTickets.mockResolvedValue(0);
      repository.remove.mockResolvedValue(true);

      await service.remove(ADMIN, { id: '2' });

      expect(repository.remove).toHaveBeenCalledWith(2);
      expect(transport.publish.mock.calls[0]?.[0]).toBeInstanceOf(ServicesDeletedV1);
      expect(logger.log).toHaveBeenCalledWith('service deleted', { id: 2 });
    });

    it('answers ERP-CORE-0004 when the row is gone between the read and the delete', async () => {
      const { service, repository, transport } = build();
      repository.findById.mockResolvedValue({ id: 2, name: 'Gold' });
      repository.countTickets.mockResolvedValue(0);
      repository.remove.mockResolvedValue(false);
      await expect(service.remove(ADMIN, { id: '2' })).rejects.toMatchObject({
        code: 'ERP-CORE-0004',
      });
      expect(transport.publish).not.toHaveBeenCalled();
    });
  });

  describe('facade reads (no actor, no assertion)', () => {
    it('findById answers { id, name } or null', async () => {
      const { service, repository } = build();
      repository.findById.mockResolvedValueOnce({ id: 1, name: 'A' }).mockResolvedValueOnce(null);
      expect(await service.findById(1)).toEqual({ id: 1, name: 'A' });
      expect(await service.findById(2)).toBeNull();
    });

    it('listAll maps every row', async () => {
      const { service, repository } = build();
      repository.listAll.mockResolvedValue([{ id: 1, name: 'A' }]);
      expect(await service.listAll()).toEqual([{ id: 1, name: 'A' }]);
    });

    it('findByIds answers in the order given, each once, skipping absent ids', async () => {
      const { service, repository } = build();
      repository.findByIds.mockResolvedValue([
        { id: 1, name: 'A' },
        { id: 3, name: 'C' },
      ]);
      const found = await service.findByIds([3, 2, 1, 3]);
      expect(repository.findByIds).toHaveBeenCalledWith([3, 2, 1]);
      expect(found).toEqual([
        { id: 3, name: 'C' },
        { id: 1, name: 'A' },
      ]);
    });
  });
});
