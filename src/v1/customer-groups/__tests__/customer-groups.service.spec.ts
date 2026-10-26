/**
 * Service: the repository and the logger are mocks; the validator and the transformer are the real
 * ones, so the whole use case (administrator check, parse, read or write, answer) is covered.
 */
import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { LoggerService } from '../../../shared/logger/logger.service.js';
import type { CustomerGroupsRepository } from '../repository/customer-groups.repository.js';
import { CustomerGroupsService } from '../service/customer-groups.service.js';
import { CustomerGroupsTransformer } from '../service/customer-groups.transformer.js';
import { CustomerGroupsValidator } from '../service/customer-groups.validator.js';

const admin = { isAdmin: true, staffId: 1 } as unknown as AuthenticatedUser;
const member = { isAdmin: false, staffId: 2 } as unknown as AuthenticatedUser;

function build() {
  const repository = {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listAll: vi.fn(),
    findByIds: vi.fn(),
  };
  const logger = { log: vi.fn() };
  const service = new CustomerGroupsService(
    new CustomerGroupsValidator(),
    repository as unknown as CustomerGroupsRepository,
    new CustomerGroupsTransformer(),
    logger as unknown as LoggerService,
  );
  return { service, repository, logger };
}

describe('CustomerGroupsService: administrators only', () => {
  it('refuses a non-administrator on every use case and touches nothing', async () => {
    const { service, repository } = build();
    const refusals = [
      service.list(member, {}),
      service.get(member, { id: '1' }),
      service.create(member, { name: 'VIP' }),
      service.update(member, { id: '1' }, { name: 'VIP' }),
      service.remove(member, { id: '1' }),
    ];
    for (const refusal of refusals) await expect(refusal).rejects.toBeInstanceOf(AppError);
    for (const method of Object.values(repository)) expect(method).not.toHaveBeenCalled();
  });
});

describe('CustomerGroupsService.list', () => {
  it('answers the page in the list envelope', async () => {
    const { service, repository } = build();
    repository.list.mockResolvedValueOnce({
      items: [{ id: 1, name: 'VIP' }],
      nextCursor: null,
      prevCursor: null,
      total: 1,
      rangeStart: 1,
    });
    const response = await service.list(admin, {});
    expect(response.data).toEqual([{ id: '1', name: 'VIP' }]);
    expect(response.meta.total).toBe(1);
  });
});

describe('CustomerGroupsService.get', () => {
  it('answers one group', async () => {
    const { service, repository } = build();
    repository.findById.mockResolvedValueOnce({ id: 3, name: 'Gold' });
    await expect(service.get(admin, { id: '3' })).resolves.toEqual({ id: '3', name: 'Gold' });
  });

  it('answers not found for a missing id', async () => {
    const { service, repository } = build();
    repository.findById.mockResolvedValueOnce(null);
    await expect(service.get(admin, { id: '3' })).rejects.toBeInstanceOf(AppError);
  });

  it('refuses a bad id before reading', async () => {
    const { service, repository } = build();
    await expect(service.get(admin, { id: 'abc' })).rejects.toBeInstanceOf(AppError);
    expect(repository.findById).not.toHaveBeenCalled();
  });
});

describe('CustomerGroupsService.create', () => {
  it('stores the trimmed name and logs the id only', async () => {
    const { service, repository, logger } = build();
    repository.create.mockResolvedValueOnce({ id: 9, name: 'VIP' });
    await expect(service.create(admin, { name: '  VIP ' })).resolves.toEqual({
      id: '9',
      name: 'VIP',
    });
    expect(repository.create).toHaveBeenCalledWith({ name: 'VIP' });
    expect(logger.log).toHaveBeenCalledWith('customer group created', { id: 9 });
  });

  it('refuses an empty name without writing', async () => {
    const { service, repository } = build();
    await expect(service.create(admin, { name: '' })).rejects.toBeInstanceOf(AppError);
    expect(repository.create).not.toHaveBeenCalled();
  });
});

describe('CustomerGroupsService.update', () => {
  it('renames the group', async () => {
    const { service, repository } = build();
    repository.update.mockResolvedValueOnce({ id: 4, name: 'Silver' });
    await expect(service.update(admin, { id: '4' }, { name: 'Silver' })).resolves.toEqual({
      id: '4',
      name: 'Silver',
    });
    expect(repository.update).toHaveBeenCalledWith(4, { name: 'Silver' });
  });

  it('answers not found for a missing id', async () => {
    const { service, repository } = build();
    repository.update.mockResolvedValueOnce(null);
    await expect(service.update(admin, { id: '4' }, { name: 'x' })).rejects.toBeInstanceOf(
      AppError,
    );
  });
});

describe('CustomerGroupsService.remove', () => {
  it('deletes the group through the repository (which also removes its customer links)', async () => {
    const { service, repository, logger } = build();
    repository.findById.mockResolvedValueOnce({ id: 5, name: 'VIP' });
    repository.remove.mockResolvedValueOnce(true);
    await expect(service.remove(admin, { id: '5' })).resolves.toBeUndefined();
    expect(repository.remove).toHaveBeenCalledWith(5);
    expect(logger.log).toHaveBeenCalledWith('customer group deleted', { id: 5 });
  });

  it('answers not found when the group does not exist, and deletes nothing', async () => {
    const { service, repository } = build();
    repository.findById.mockResolvedValueOnce(null);
    await expect(service.remove(admin, { id: '5' })).rejects.toBeInstanceOf(AppError);
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('answers not found when the row vanished between the read and the delete', async () => {
    const { service, repository } = build();
    repository.findById.mockResolvedValueOnce({ id: 5, name: 'VIP' });
    repository.remove.mockResolvedValueOnce(false);
    await expect(service.remove(admin, { id: '5' })).rejects.toBeInstanceOf(AppError);
  });
});

describe('CustomerGroupsService facade reads', () => {
  it('findById answers the plain shape or null, with no administrator check', async () => {
    const { service, repository } = build();
    repository.findById.mockResolvedValueOnce({ id: 1, name: 'VIP' });
    await expect(service.findById(1)).resolves.toEqual({ id: 1, name: 'VIP' });
    repository.findById.mockResolvedValueOnce(null);
    await expect(service.findById(2)).resolves.toBeNull();
  });

  it('findByIds keeps the order given, each once, skipping absent ids', async () => {
    const { service, repository } = build();
    repository.findByIds.mockResolvedValueOnce([
      { id: 1, name: 'A' },
      { id: 3, name: 'C' },
    ]);
    await expect(service.findByIds([3, 2, 1, 3])).resolves.toEqual([
      { id: 3, name: 'C' },
      { id: 1, name: 'A' },
    ]);
  });

  it('listAll answers every group', async () => {
    const { service, repository } = build();
    repository.listAll.mockResolvedValueOnce([{ id: 1, name: 'A' }]);
    await expect(service.listAll()).resolves.toEqual([{ id: 1, name: 'A' }]);
  });
});
