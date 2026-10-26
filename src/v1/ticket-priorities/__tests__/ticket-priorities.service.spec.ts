import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { TicketPrioritiesRepository } from '../repository/ticket-priorities.repository.js';
import { TicketPrioritiesService } from '../service/ticket-priorities.service.js';
import { SettingsFacade } from '../../settings/index.js';

const repo = {
  findAll: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  isReferenced: vi.fn(),
};
const settings = { getOption: vi.fn() };
const user = {} as AuthenticatedUser;

let service: TicketPrioritiesService;

beforeEach(async () => {
  vi.resetAllMocks();

  const moduleRef = await Test.createTestingModule({
    providers: [
      TicketPrioritiesService,
      { provide: TicketPrioritiesRepository, useValue: repo },
      { provide: SettingsFacade, useValue: settings },
    ],
  }).compile();

  service = moduleRef.get(TicketPrioritiesService);
});

describe('list', () => {
  it('returns priorities in the order the repository gives them (newest ID first)', async () => {
    repo.findAll.mockResolvedValue([
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
    repo.findAll.mockResolvedValue([]);

    const result = await service.list(user);

    expect(result.data).toEqual([]);
    expect(result.meta.total).toBe(0);
  });

  it('treats a null repository result as an empty list', async () => {
    repo.findAll.mockResolvedValue(null);

    const result = await service.list(user);

    expect(result).toEqual({ data: [], meta: { total: 0 } });
  });

  it('returns an empty list on AppError ERP-CORE-0004', async () => {
    repo.findAll.mockRejectedValue(new AppError('ERP-CORE-0004', 'no_table'));

    const result = await service.list(user);

    expect(result).toEqual({ data: [], meta: { total: 0 } });
  });

  it('rethrows other AppErrors', async () => {
    repo.findAll.mockRejectedValue(new AppError('ERP-VALIDATION-0001', 'boom'));

    await expect(service.list(user)).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
  });

  it('rethrows unknown errors', async () => {
    repo.findAll.mockRejectedValue(new Error('db down'));

    await expect(service.list(user)).rejects.toThrow('db down');
  });
});

describe('get', () => {
  it('returns the mapped priority', async () => {
    repo.findById.mockResolvedValue({ priorityid: 3, name: 'Medium' });

    const result = await service.get(user, { id: 3 });

    expect(result).toEqual({ id: 3, name: 'Medium' });
  });

  it('converts a string id to a number', async () => {
    repo.findById.mockResolvedValue({ priorityid: 3, name: 'Medium' });

    await service.get(user, { id: '3' });

    expect(repo.findById).toHaveBeenCalledWith(3);
  });

  it('throws NotFoundException when the priority does not exist', async () => {
    repo.findById.mockResolvedValue(null);

    await expect(service.get(user, { id: 99 })).rejects.toThrow(NotFoundException);
  });
});

describe('create', () => {
  it('creates the priority and returns the mapped result', async () => {
    repo.create.mockResolvedValue({ priorityid: 7, name: 'Critical' });

    const result = await service.create(user, { name: 'Critical' });

    expect(repo.create).toHaveBeenCalledWith({ name: 'Critical' });
    expect(result).toEqual({ id: 7, name: 'Critical' });
  });

  it('propagates repository errors', async () => {
    repo.create.mockRejectedValue(new Error('duplicate'));

    await expect(service.create(user, { name: 'High' })).rejects.toThrow('duplicate');
  });
});

describe('update', () => {
  it('updates the priority and returns the mapped result', async () => {
    repo.update.mockResolvedValue({ priorityid: 7, name: 'Urgent' });

    const result = await service.update(user, { id: 7 }, { name: 'Urgent' });

    expect(repo.update).toHaveBeenCalledWith(7, { name: 'Urgent' });
    expect(result).toEqual({ id: 7, name: 'Urgent' });
  });

  it('converts a string id to a number', async () => {
    repo.update.mockResolvedValue({ priorityid: 7, name: 'Urgent' });

    await service.update(user, { id: '7' }, { name: 'Urgent' });

    expect(repo.update).toHaveBeenCalledWith(7, { name: 'Urgent' });
  });

  it('throws NotFoundException when the priority does not exist', async () => {
    repo.update.mockResolvedValue(null);

    await expect(service.update(user, { id: 99 }, { name: 'Nope' })).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('remove', () => {
  it('refuses to delete if any ticket uses the priority', async () => {
    repo.isReferenced.mockResolvedValue(true);

    await expect(service.remove(user, { id: 5 })).rejects.toMatchObject({
      name: 'AppError',
      code: 'ERP-VALIDATION-0001',
      message: 'is_referenced',
    });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('refuses to delete if the priority is the email_piping_default_priority', async () => {
    repo.isReferenced.mockResolvedValue(false);
    settings.getOption.mockResolvedValue('4'); // settings return strings

    await expect(service.remove(user, { id: 4 })).rejects.toMatchObject({
      name: 'AppError',
      code: 'ERP-VALIDATION-0001',
    });
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('deletes the priority when unused and not the default', async () => {
    repo.isReferenced.mockResolvedValue(false);
    settings.getOption.mockResolvedValue('1');
    repo.delete.mockResolvedValue({ priorityid: 6, name: 'Urgent' });

    await service.remove(user, { id: 6 });

    expect(repo.delete).toHaveBeenCalledWith(6);
  });

  it('deletes when the default priority setting is unset', async () => {
    repo.isReferenced.mockResolvedValue(false);
    settings.getOption.mockResolvedValue(undefined);
    repo.delete.mockResolvedValue({ priorityid: 6, name: 'Urgent' });

    await service.remove(user, { id: 6 });

    expect(repo.delete).toHaveBeenCalledWith(6);
  });

  it('still deletes when the settings lookup fails', async () => {
    repo.isReferenced.mockResolvedValue(false);
    settings.getOption.mockRejectedValue(new Error('setting missing'));
    repo.delete.mockResolvedValue({ priorityid: 6, name: 'Urgent' });

    await service.remove(user, { id: 6 });

    expect(repo.delete).toHaveBeenCalledWith(6);
  });

  it('converts a string id to a number', async () => {
    repo.isReferenced.mockResolvedValue(false);
    settings.getOption.mockResolvedValue('1');
    repo.delete.mockResolvedValue({ priorityid: 6, name: 'Urgent' });

    await service.remove(user, { id: '6' });

    expect(repo.isReferenced).toHaveBeenCalledWith(6);
    expect(repo.delete).toHaveBeenCalledWith(6);
  });

  it('throws NotFoundException when the priority does not exist', async () => {
    repo.isReferenced.mockResolvedValue(false);
    settings.getOption.mockResolvedValue('1');
    repo.delete.mockResolvedValue(null);

    await expect(service.remove(user, { id: 99 })).rejects.toThrow(NotFoundException);
  });

  it('reads the correct setting key', async () => {
    repo.isReferenced.mockResolvedValue(false);
    settings.getOption.mockResolvedValue('1');
    repo.delete.mockResolvedValue({ priorityid: 6, name: 'Urgent' });

    await service.remove(user, { id: 6 });

    expect(settings.getOption).toHaveBeenCalledWith('email_piping_default_priority');
  });
});
