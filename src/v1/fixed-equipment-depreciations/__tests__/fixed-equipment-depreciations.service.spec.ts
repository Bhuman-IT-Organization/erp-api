import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { FixedEquipmentDepreciationsService } from '../service/fixed-equipment-depreciations.service.js';
import { FixedEquipmentDepreciationsTransformer } from '../service/fixed-equipment-depreciations.transformer.js';
import { FixedEquipmentDepreciationsValidator } from '../service/fixed-equipment-depreciations.validator.js';

const repository = {
  list: vi.fn(),
  count: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  listAll: vi.fn(),
};
const transport = { publish: vi.fn() };
const logger = { log: vi.fn() };

const member = { isAdmin: false, staffId: 3 } as AuthenticatedUser;

const EMPTY_PAGE = { items: [], nextCursor: null, prevCursor: null, total: 0, rangeStart: 0 };

let service: FixedEquipmentDepreciationsService;

beforeEach(() => {
  vi.resetAllMocks();
  transport.publish.mockResolvedValue(undefined);
  service = new FixedEquipmentDepreciationsService(
    new FixedEquipmentDepreciationsValidator(),
    repository as never,
    new FixedEquipmentDepreciationsTransformer(),
    transport as never,
    logger as never,
  );
  service.now = () => new Date('2026-10-31T10:00:00.000Z');
});

describe('list', () => {
  it('answers the keyset envelope with string ids and the term', async () => {
    repository.list.mockResolvedValue({
      items: [
        { id: 2, name: 'Depreciation 2', term: 36, creatorId: 1 },
        { id: 1, name: 'Depreciation 1', term: 12, creatorId: 1 },
      ],
      nextCursor: null,
      prevCursor: null,
      total: 2,
      rangeStart: 1,
    });

    const result = await service.list({}, 'all', 1);

    expect(result.data).toEqual([
      { id: '2', name: 'Depreciation 2', term: 36 },
      { id: '1', name: 'Depreciation 1', term: 12 },
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
    repository.list.mockResolvedValue(EMPTY_PAGE);

    await service.list({}, 'all', 1);
    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortField: 'id', order: 'desc', search: null }),
      'all',
      1,
    );

    await service.list({ sort: 'name', q: 'line' }, 'all', 1);
    expect(repository.list).toHaveBeenLastCalledWith(
      expect.objectContaining({ sortField: 'name', order: 'asc', search: 'line' }),
      'all',
      1,
    );
  });

  it('forwards the row scope and the staff id unchanged (the repository narrows own)', async () => {
    repository.list.mockResolvedValue(EMPTY_PAGE);
    await service.list({}, 'own', 3);
    expect(repository.list).toHaveBeenCalledWith(expect.anything(), 'own', 3);
  });

  it('refuses a filter, two sorts, a term sort and a q that is too long with ERP-VALIDATION-0001', async () => {
    for (const query of [
      { 'filter[name]': 'x' },
      { sort: 'name,id' },
      { sort: 'term' },
      { q: 'a'.repeat(101) },
    ]) {
      await expect(service.list(query, 'all', 1)).rejects.toMatchObject({
        code: 'ERP-VALIDATION-0001',
      });
    }
    expect(repository.list).not.toHaveBeenCalled();
  });

  it('does not hide repository errors', async () => {
    repository.list.mockRejectedValue(new Error('db down'));
    await expect(service.list({}, 'all', 1)).rejects.toThrow('db down');
  });
});

describe('get', () => {
  it('returns the depreciation, read under the given scope', async () => {
    repository.findById.mockResolvedValue({ id: 3, name: 'Straight line', term: 60, creatorId: 3 });
    expect(await service.get({ id: '3' }, 'own', 3)).toEqual({
      id: '3',
      name: 'Straight line',
      term: 60,
    });
    expect(repository.findById).toHaveBeenCalledWith(3, 'own', 3);
  });

  it('answers ERP-CORE-0004 for a missing id or one hidden by own (the same answer)', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(service.get({ id: 99 }, 'own', 3)).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
  });

  it.each(['abc', '0', '-1', '1.5'])('answers ERP-VALIDATION-0001 for id=%s', async (id) => {
    await expect(service.get({ id }, 'all', 1)).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
    expect(repository.findById).not.toHaveBeenCalled();
  });
});

describe('create', () => {
  it('trims the name, saves the term and the actor as creator, publishes and logs', async () => {
    repository.create.mockResolvedValue({ id: 5, name: 'Declining', term: 24, creatorId: 3 });

    const result = await service.create(member, { name: '  Declining  ', term: 24 });

    expect(repository.create).toHaveBeenCalledWith({ name: 'Declining', term: 24, creatorId: 3 });
    expect(result).toEqual({ id: '5', name: 'Declining', term: 24 });
    expect(transport.publish).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('depreciation created', { id: 5 });
  });

  it.each([
    ['an empty name', { name: '', term: 12 }],
    ['a blank name', { name: '   ', term: 12 }],
    ['a 201-character name', { name: 'a'.repeat(201), term: 12 }],
    ['no name', { term: 12 }],
    ['no term', { name: 'Declining' }],
    ['a zero term', { name: 'Declining', term: 0 }],
    ['a text term', { name: 'Declining', term: '12' }],
    ['a creator in the body', { name: 'Declining', term: 12, creator_id: 9 }],
  ])('refuses a body with %s', async (_label, body) => {
    await expect(service.create(member, body)).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('accepts a 200-character name', async () => {
    const name = 'a'.repeat(200);
    repository.create.mockResolvedValue({ id: 6, name, term: 12, creatorId: 3 });
    expect(await service.create(member, { name, term: 12 })).toEqual({ id: '6', name, term: 12 });
  });
});

describe('update', () => {
  it('changes the name and the term, publishes and logs', async () => {
    repository.update.mockResolvedValue({ id: 2, name: 'Five years', term: 60, creatorId: 1 });

    const result = await service.update({ id: '2' }, { name: 'Five years', term: 60 });

    expect(repository.update).toHaveBeenCalledWith(2, { name: 'Five years', term: 60 });
    expect(result).toEqual({ id: '2', name: 'Five years', term: 60 });
    expect(transport.publish).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('depreciation updated', { id: 2 });
  });

  it('answers ERP-CORE-0004 when the id is missing and publishes nothing', async () => {
    repository.update.mockResolvedValue(null);
    await expect(service.update({ id: 9 }, { name: 'X', term: 12 })).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
    expect(transport.publish).not.toHaveBeenCalled();
  });

  it('refuses a bad id or an incomplete body with ERP-VALIDATION-0001', async () => {
    await expect(service.update({ id: 'abc' }, { name: 'X', term: 12 })).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
    await expect(service.update({ id: 1 }, { name: 'X' })).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
    expect(repository.update).not.toHaveBeenCalled();
  });
});

describe('remove', () => {
  it('deletes, then publishes and logs (no in-use check, as in Perfex)', async () => {
    repository.remove.mockResolvedValue(true);
    await service.remove({ id: 5 });
    expect(repository.remove).toHaveBeenCalledWith(5);
    expect(transport.publish).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith('depreciation deleted', { id: 5 });
  });

  it('answers ERP-CORE-0004 when the row is not there, and publishes nothing', async () => {
    repository.remove.mockResolvedValue(false);
    await expect(service.remove({ id: 9 })).rejects.toMatchObject({ code: 'ERP-CORE-0004' });
    expect(transport.publish).not.toHaveBeenCalled();
  });

  it('answers ERP-VALIDATION-0001 for a bad id', async () => {
    await expect(service.remove({ id: 'abc' })).rejects.toMatchObject({
      code: 'ERP-VALIDATION-0001',
    });
    expect(repository.remove).not.toHaveBeenCalled();
  });
});

describe('exportCsv', () => {
  it('counts and reads under the given scope', async () => {
    repository.count.mockResolvedValue(0);
    repository.list.mockResolvedValue(EMPTY_PAGE);
    await service.exportCsv({}, 'own', 3);
    expect(repository.count).toHaveBeenCalledWith(expect.anything(), 'own', 3);
  });
});

describe('facade reads', () => {
  it('findById reads every owner, and answers the model or null', async () => {
    const row = { id: 2, name: 'Depreciation 2', term: 36, creatorId: 1 };
    repository.findById.mockResolvedValue(row);
    expect(await service.findById(2)).toEqual(row);
    expect(repository.findById).toHaveBeenCalledWith(2, 'all', 0);
    repository.findById.mockResolvedValue(null);
    expect(await service.findById(99)).toBeNull();
  });

  it('listAll returns the model rows', async () => {
    const rows = [{ id: 1, name: 'Depreciation 1', term: 12, creatorId: 1 }];
    repository.listAll.mockResolvedValue(rows);
    expect(await service.listAll()).toEqual(rows);
  });
});
