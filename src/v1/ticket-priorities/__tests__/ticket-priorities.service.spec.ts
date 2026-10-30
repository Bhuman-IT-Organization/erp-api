import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { TicketPrioritiesService } from '../service/ticket-priorities.service.js';
import { TicketPrioritiesTransformer } from '../service/ticket-priorities.transformer.js';
import { TicketPrioritiesValidator } from '../service/ticket-priorities.validator.js';

const repository = {
  list: vi.fn(),
  count: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  isReferenced: vi.fn(),
  listAll: vi.fn(),
};
const transport = { publish: vi.fn(), emailPipingDefaultPriority: vi.fn() };
const logger = { log: vi.fn() };

const admin = { isAdmin: true, staffId: 1 } as AuthenticatedUser;
const member = { isAdmin: false, staffId: 2 } as AuthenticatedUser;

let service: TicketPrioritiesService;

beforeEach(() => {
  vi.resetAllMocks();
  transport.publish.mockResolvedValue(undefined);
  service = new TicketPrioritiesService(
    new TicketPrioritiesValidator(),
    repository as never,
    new TicketPrioritiesTransformer(),
    transport as never,
    logger as never,
  );
  service.now = () => new Date('2026-10-29T10:00:00.000Z');
});

describe('administrators only', () => {
  it.each([
    ['list', () => service.list(member, {})],
    ['get', () => service.get(member, { id: 1 })],
    ['create', () => service.create(member, { name: 'High' })],
    ['update', () => service.update(member, { id: 1 }, { name: 'High' })],
    ['remove', () => service.remove(member, { id: 1 })],
    ['exportCsv', () => service.exportCsv(member, {})],
  ])('%s answers ERP-AUTH-0005 to a non-admin before touching anything', async (_name, run) => {
    await expect(run()).rejects.toMatchObject({ code: 'ERP-AUTH-0005' });
    expect(repository.list).not.toHaveBeenCalled();
    expect(repository.findById).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });
});

describe('list', () => {
  it('answers the keyset envelope with string ids', async () => {
    repository.list.mockResolvedValue({
      items: [
        { id: 2, name: 'High' },
        { id: 1, name: 'Low' },
      ],
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
    });

    const result = await service.list(admin, {});

    expect(result.data).toEqual([
      { id: '2', name: 'High' },
      { id: '1', name: 'Low' },
    ]);
    expect(result.meta).toMatchObject({
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
    });
    expect(result.meta.exportLimit).toBeGreaterThan(0);
    expect(result.meta.printLimit).toBeGreaterThan(0);
  });

  it('defaults to the id descending and passes q and sort to the repository', async () => {
    repository.list.mockResolvedValue({
      items: [],
      nextCursor: null,
      prevCursor: null,
      total: 0,
      rangeStart: 0,
    });

    await service.list(admin, {});
    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortField: 'id', order: 'desc', search: null }),
    );

    await service.list(admin, { sort: 'name', q: 'hi' });
    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortField: 'name', order: 'asc', search: 'hi' }),
    );
  });

  it('refuses a filter, two sorts and a q that is too long with ERP-VALIDATION-0001', async () => {
    await expect(service.list(admin, { 'filter[name]': 'x' })).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
    await expect(service.list(admin, { sort: 'name,id' })).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
    await expect(service.list(admin, { q: 'a'.repeat(101) })).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
  });

  it('does not hide repository errors', async () => {
    repository.list.mockRejectedValue(new Error('db down'));
    await expect(service.list(admin, {})).rejects.toThrow('db down');
  });
});

describe('get', () => {
  it('returns the priority', async () => {
    repository.findById.mockResolvedValue({ id: 3, name: 'Medium' });
    expect(await service.get(admin, { id: '3' })).toEqual({ id: '3', name: 'Medium' });
    expect(repository.findById).toHaveBeenCalledWith(3);
  });

  it('answers ERP-CORE-0004 for a missing id', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(service.get(admin, { id: 99 })).rejects.toMatchObject({ code: 'ERP-CORE-0004' });
  });

  it.each(['abc', '0', '-1', '1.5'])('answers ERP-VALIDATION-0001 for id=%s', async (id) => {
    await expect(service.get(admin, { id })).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
    expect(repository.findById).not.toHaveBeenCalled();
  });
});

describe('create', () => {
  it('trims the name, creates, publishes and logs', async () => {
    repository.create.mockResolvedValue({ id: 7, name: 'Critical' });

    const result = await service.create(admin, { name: '  Critical  ' });

    expect(repository.create).toHaveBeenCalledWith({ name: 'Critical' });
    expect(result).toEqual({ id: '7', name: 'Critical' });
    expect(transport.publish).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('ticket priority created', { id: 7 });
  });

  it.each([
    ['empty', { name: '' }],
    ['blank', { name: '   ' }],
    ['51 characters', { name: 'a'.repeat(51) }],
    ['missing', {}],
    ['not a string', { name: 5 }],
    ['an extra key', { name: 'High', priorityid: 9 }],
  ])('refuses a body with a name that is %s', async (_label, body) => {
    await expect(service.create(admin, body)).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('accepts a 50-character name', async () => {
    const name = 'a'.repeat(50);
    repository.create.mockResolvedValue({ id: 8, name });
    expect(await service.create(admin, { name })).toEqual({ id: '8', name });
  });
});

describe('update', () => {
  it('renames, publishes and logs', async () => {
    repository.update.mockResolvedValue({ id: 7, name: 'Urgent' });

    const result = await service.update(admin, { id: '7' }, { name: 'Urgent' });

    expect(repository.update).toHaveBeenCalledWith(7, { name: 'Urgent' });
    expect(result).toEqual({ id: '7', name: 'Urgent' });
    expect(transport.publish).toHaveBeenCalledTimes(1);
  });

  it('answers ERP-CORE-0004 when the id is missing and publishes nothing', async () => {
    repository.update.mockResolvedValue(null);
    await expect(service.update(admin, { id: 9 }, { name: 'X' })).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
    expect(transport.publish).not.toHaveBeenCalled();
  });

  it('refuses a bad id or an empty body with ERP-VALIDATION-0001', async () => {
    await expect(service.update(admin, { id: 'abc' }, { name: 'X' })).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
    await expect(service.update(admin, { id: 1 }, {})).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
    expect(repository.update).not.toHaveBeenCalled();
  });
});

describe('remove', () => {
  beforeEach(() => {
    repository.findById.mockResolvedValue({ id: 5, name: 'High' });
    repository.isReferenced.mockResolvedValue(false);
    transport.emailPipingDefaultPriority.mockResolvedValue('1');
    repository.remove.mockResolvedValue(true);
  });

  it('answers ERP-CORE-0004 for a missing id', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(service.remove(admin, { id: 9 })).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('answers ERP-VALIDATION-0001 for a bad id', async () => {
    await expect(service.remove(admin, { id: 'abc' })).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
  });

  it('refuses while a ticket uses it (ERP-TICKETPRIORITIES-0001)', async () => {
    repository.isReferenced.mockResolvedValue(true);
    await expect(service.remove(admin, { id: 5 })).rejects.toMatchObject({
      code: 'ERP-TICKETPRIORITIES-0001',
    });
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('refuses when its use could not be counted (ERP-TICKETPRIORITIES-0001)', async () => {
    repository.isReferenced.mockRejectedValue(new Error('the ticket count failed'));
    await expect(service.remove(admin, { id: 5 })).rejects.toMatchObject({
      code: 'ERP-TICKETPRIORITIES-0001',
      message: 'its use could not be counted',
    });
    expect(repository.remove).not.toHaveBeenCalled();
    expect(transport.publish).not.toHaveBeenCalled();
  });

  it('refuses the email-piping default (ERP-TICKETPRIORITIES-0002)', async () => {
    transport.emailPipingDefaultPriority.mockResolvedValue('5');
    await expect(service.remove(admin, { id: 5 })).rejects.toMatchObject({
      code: 'ERP-TICKETPRIORITIES-0002',
    });
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('refuses when the setting cannot be read (ERP-TICKETPRIORITIES-0002)', async () => {
    transport.emailPipingDefaultPriority.mockRejectedValue(new Error('settings down'));
    await expect(service.remove(admin, { id: 5 })).rejects.toMatchObject({
      code: 'ERP-TICKETPRIORITIES-0002',
    });
    expect(repository.remove).not.toHaveBeenCalled();
  });

  it('deletes when unused and not the default, then publishes and logs', async () => {
    await service.remove(admin, { id: 5 });
    expect(repository.remove).toHaveBeenCalledWith(5);
    expect(transport.publish).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('ticket priority deleted', { id: 5 });
  });

  it('deletes when the setting is unset (null)', async () => {
    transport.emailPipingDefaultPriority.mockResolvedValue(null);
    await service.remove(admin, { id: 5 });
    expect(repository.remove).toHaveBeenCalledWith(5);
  });

  it('answers ERP-CORE-0004 when the row vanished between the read and the delete', async () => {
    repository.remove.mockResolvedValue(false);
    await expect(service.remove(admin, { id: 5 })).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
    expect(transport.publish).not.toHaveBeenCalled();
  });
});

describe('facade reads', () => {
  it('findById returns the model, or null, with no administrator check', async () => {
    repository.findById.mockResolvedValue({ id: 2, name: 'High' });
    expect(await service.findById(2)).toEqual({ id: 2, name: 'High' });
    repository.findById.mockResolvedValue(null);
    expect(await service.findById(99)).toBeNull();
  });

  it('listAll returns the model rows', async () => {
    repository.listAll.mockResolvedValue([{ id: 1, name: 'Low' }]);
    expect(await service.listAll()).toEqual([{ id: 1, name: 'Low' }]);
  });
});
