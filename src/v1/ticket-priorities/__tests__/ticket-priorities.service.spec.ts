import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { TicketPrioritiesRepository } from '../repository/ticket-priorities.repository.js';
import { TicketPrioritiesService } from '../service/ticket-priorities.service.js';
import { SettingsFacade } from '../../settings/index.js';

const mockRepository = {
  findAll: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  isReferenced: vi.fn(),
};

const mockSettingsFacade = {
  getOption: vi.fn(), // <-- FIXED: getOption
};

const user = {} as AuthenticatedUser;

let service: TicketPrioritiesService;

beforeEach(async () => {
  vi.resetAllMocks();

  const moduleRef = await Test.createTestingModule({
    providers: [
      TicketPrioritiesService,
      { provide: TicketPrioritiesRepository, useValue: mockRepository },
      { provide: SettingsFacade, useValue: mockSettingsFacade },
    ],
  }).compile();

  service = moduleRef.get(TicketPrioritiesService);
});

describe('list', () => {
  it('returns priorities in the order the repository gives them (newest ID first)', async () => {
    mockRepository.findAll.mockResolvedValue([
      { priorityid: 2, name: 'High' },
      { priorityid: 1, name: 'Low' },
    ]);

    const result = await service.list(user);

    expect(result.data).toEqual([
      { id: 2, name: 'High' },
      { id: 1, name: 'Low' },
    ]);
    expect(result.meta.total).toBe(2);
  });

  it('returns an empty list when there are no priorities', async () => {
    mockRepository.findAll.mockResolvedValue([]);

    const result = await service.list(user);

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('treats a null repository result as an empty list', async () => {
    mockRepository.findAll.mockResolvedValue(null);

    const result = await service.list(user);

    expect(result).toEqual({ data: [], meta: { total: 0 } });
  });

  it('returns an empty list on AppError ERP-CORE-0004', async () => {
    mockRepository.findAll.mockRejectedValue(new AppError('ERP-CORE-0004', 'no_table'));

    const result = await service.list(user);

    expect(result).toEqual({ data: [], meta: { total: 0 } });
  });

  it('rethrows other AppErrors', async () => {
    mockRepository.findAll.mockRejectedValue(new AppError('ERP-VALIDATION-0001', 'boom'));

    await expect(service.list(user)).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
  });

  it('rethrows unknown errors', async () => {
    mockRepository.findAll.mockRejectedValue(new Error('db down'));

    await expect(service.list(user)).rejects.toThrow('db down');
  });
});

describe('get', () => {
  it('returns the mapped priority', async () => {
    mockRepository.findById.mockResolvedValue({ priorityid: 3, name: 'Medium' });

    const result = await service.get(user, { id: 3 });

    expect(result).toEqual({ id: 3, name: 'Medium' });
  });

  it('converts a string id to a number', async () => {
    mockRepository.findById.mockResolvedValue({ priorityid: 3, name: 'Medium' });

    await service.get(user, { id: '3' });

    expect(mockRepository.findById).toHaveBeenCalledWith(3);
  });

  it('throws AppError ERP-CORE-0004 when the priority does not exist', async () => {
    mockRepository.findById.mockResolvedValue(null);

    await expect(service.get(user, { id: 99 })).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
  });
});

describe('create', () => {
  it('creates the priority and returns the mapped result', async () => {
    mockRepository.create.mockResolvedValue({ priorityid: 7, name: 'Critical' });

    const result = await service.create(user, { name: 'Critical' });

    expect(mockRepository.create).toHaveBeenCalledWith({ name: 'Critical' });
    expect(result).toEqual({ id: 7, name: 'Critical' });
  });

  it('propagates repository errors', async () => {
    mockRepository.create.mockRejectedValue(new Error('duplicate'));

    await expect(service.create(user, { name: 'High' })).rejects.toThrow('duplicate');
  });
});

describe('update', () => {
  it('updates the priority and returns the mapped result', async () => {
    mockRepository.update.mockResolvedValue({ priorityid: 7, name: 'Urgent' });

    const result = await service.update(user, { id: 7 }, { name: 'Urgent' });

    expect(mockRepository.update).toHaveBeenCalledWith(7, { name: 'Urgent' });
    expect(result).toEqual({ id: 7, name: 'Urgent' });
  });

  it('converts a string id to a number', async () => {
    mockRepository.update.mockResolvedValue({ priorityid: 7, name: 'Urgent' });

    await service.update(user, { id: '7' }, { name: 'Urgent' });

    expect(mockRepository.update).toHaveBeenCalledWith(7, { name: 'Urgent' });
  });
});

describe('remove', () => {
  it('refuses to delete if any ticket uses the priority', async () => {
    mockRepository.isReferenced.mockResolvedValue(true);

    await expect(service.remove(user, { id: 5 })).rejects.toMatchObject({
      name: 'AppError',
      code: 'ERP-VALIDATION-0001',
      message: 'is_referenced',
    });
    expect(mockRepository.delete).not.toHaveBeenCalled();
  });

  it('refuses to delete if the priority is the email_piping_default_priority', async () => {
    mockRepository.isReferenced.mockResolvedValue(false);
    mockSettingsFacade.getOption.mockResolvedValue('4');

    await expect(service.remove(user, { id: 4 })).rejects.toMatchObject({
      name: 'AppError',
      code: 'ERP-VALIDATION-0001',
    });
    expect(mockRepository.delete).not.toHaveBeenCalled();
  });

  it('deletes the priority when unused and not the default', async () => {
    mockRepository.isReferenced.mockResolvedValue(false);
    mockSettingsFacade.getOption.mockResolvedValue('1'); // <-- FIXED
    mockRepository.delete.mockResolvedValue({ priorityid: 6, name: 'Urgent' });

    await service.remove(user, { id: 6 });

    expect(mockRepository.delete).toHaveBeenCalledWith(6);
  });

  it('deletes when the default priority setting is unset', async () => {
    mockRepository.isReferenced.mockResolvedValue(false);
    mockSettingsFacade.getOption.mockResolvedValue(undefined); // <-- FIXED
    mockRepository.delete.mockResolvedValue({ priorityid: 6, name: 'Urgent' });

    await service.remove(user, { id: 6 });

    expect(mockRepository.delete).toHaveBeenCalledWith(6);
  });

  it('still deletes when the settings lookup fails', async () => {
    mockRepository.isReferenced.mockResolvedValue(false);
    mockSettingsFacade.getOption.mockRejectedValue(new Error('setting missing')); // <-- FIXED
    mockRepository.delete.mockResolvedValue({ priorityid: 6, name: 'Urgent' });

    await service.remove(user, { id: 6 });

    expect(mockRepository.delete).toHaveBeenCalledWith(6);
  });

  it('converts a string id to a number', async () => {
    mockRepository.isReferenced.mockResolvedValue(false);
    mockSettingsFacade.getOption.mockResolvedValue('1'); // <-- FIXED
    mockRepository.delete.mockResolvedValue({ priorityid: 6, name: 'Urgent' });

    await service.remove(user, { id: '6' });

    expect(mockRepository.isReferenced).toHaveBeenCalledWith(6);
    expect(mockRepository.delete).toHaveBeenCalledWith(6);
  });

  it('reads the correct setting key', async () => {
    mockRepository.isReferenced.mockResolvedValue(false);
    mockSettingsFacade.getOption.mockResolvedValue('1'); // <-- FIXED
    mockRepository.delete.mockResolvedValue({ priorityid: 6, name: 'Urgent' });

    await service.remove(user, { id: 6 });

    expect(mockSettingsFacade.getOption).toHaveBeenCalledWith('email_piping_default_priority'); // <-- FIXED
  });
});
