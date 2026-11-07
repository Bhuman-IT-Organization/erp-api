import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../../../shared/errors/app-error.js';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { LoggerService } from '../../../shared/logger/logger.service.js';
import { TodoCreatedV1, TodoDeletedV1, TodoUpdatedV1 } from '../events/published.js';
import type { TodoRow } from '../model/todo.model.js';
import type { TodoRepository } from '../repository/todo.repository.js';
import { TodoService } from '../service/todo.service.js';
import { TodoTransformer } from '../service/todo.transformer.js';
import type { TodoTransport } from '../service/todo.transport.js';
import { TodoValidator } from '../service/todo.validator.js';

const ME = { isAdmin: false, staffId: 5 } as unknown as AuthenticatedUser;
const NOW = new Date('2026-10-02T20:30:15.250Z');
/** The Dubai wall clock of NOW. */
const WALL = new Date(Date.UTC(2026, 9, 3, 0, 30, 15));

const row = (overrides: Partial<TodoRow> = {}): TodoRow => ({
  id: 7,
  description: 'Call Ali',
  staffId: 5,
  dateAdded: WALL,
  finished: false,
  dateFinished: null,
  itemOrder: 1,
  ...overrides,
});

function build() {
  const repository = {
    list: vi.fn(),
    findById: vi.fn(),
    create: vi.fn(),
    updateDescription: vi.fn(),
    setFinished: vi.fn(),
    reorder: vi.fn(),
    remove: vi.fn(),
    countUnfinished: vi.fn(),
  };
  const transport = {
    publish: vi.fn().mockResolvedValue(undefined),
    companyTimeZone: vi.fn().mockResolvedValue('Asia/Dubai'),
  };
  const logger = { log: vi.fn() };
  const service = new TodoService(
    new TodoValidator(),
    repository as unknown as TodoRepository,
    new TodoTransformer(),
    transport as unknown as TodoTransport,
    logger as unknown as LoggerService,
  );
  service.now = () => NOW;
  return { service, repository, transport, logger };
}

describe('TodoService', () => {
  it('describes itself', () => {
    expect(build().service.describe()).toEqual({ module: 'todo', version: 1 });
  });

  describe('list', () => {
    it("reads the caller's own panel and answers the envelope with the next cursor", async () => {
      const { service, repository } = build();
      repository.list.mockResolvedValue({
        items: [row()],
        total: 3,
        hasMore: true,
      });

      const response = await service.list(ME, { status: 'unfinished', limit: '1' });

      expect(repository.list).toHaveBeenCalledWith(5, {
        status: 'unfinished',
        limit: 1,
        cursor: null,
      });
      expect(response.data).toEqual([
        {
          id: '7',
          description: 'Call Ali',
          finished: false,
          dateAdded: '2026-10-02T20:30:15.000Z',
          dateFinished: null,
        },
      ]);
      expect(response.meta.total).toBe(3);
      expect(response.meta.nextCursor).not.toBeNull();
    });

    it('rejects a query with no status before reading', async () => {
      const { service, repository } = build();
      await expect(service.list(ME, {})).rejects.toBeInstanceOf(AppError);
      expect(repository.list).not.toHaveBeenCalled();
    });
  });

  describe('get', () => {
    it("reads one of the caller's own to do's by the caller's staff id", async () => {
      const { service, repository } = build();
      repository.findById.mockResolvedValue(row());
      expect((await service.get(ME, { id: '7' })).id).toBe('7');
      expect(repository.findById).toHaveBeenCalledWith(5, 7);
    });

    it("answers ERP-CORE-0004 for another member's or a missing to do (the same 404)", async () => {
      const { service, repository } = build();
      repository.findById.mockResolvedValue(null);
      await expect(service.get(ME, { id: '99' })).rejects.toMatchObject({ code: 'ERP-CORE-0004' });
    });
  });

  describe('create', () => {
    it('writes the trimmed text and the company wall clock, publishes after the write, logs the id', async () => {
      const { service, repository, transport, logger } = build();
      repository.create.mockResolvedValue(row());

      const response = await service.create(ME, { description: '  Call Ali  ' });

      expect(repository.create).toHaveBeenCalledWith({
        staffId: 5,
        description: 'Call Ali',
        dateAdded: WALL,
      });
      expect(response.id).toBe('7');
      const event = transport.publish.mock.calls[0]?.[0] as TodoCreatedV1;
      expect(event).toBeInstanceOf(TodoCreatedV1);
      expect(event.payload).toEqual({ id: 7, staffId: 5, at: NOW.toISOString() });
      expect(logger.log).toHaveBeenCalledWith('to do created', { id: 7 });
    });

    it('does not write with an invalid body', async () => {
      const { service, repository } = build();
      await expect(service.create(ME, { description: '' })).rejects.toBeInstanceOf(AppError);
      expect(repository.create).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('changes the description and publishes the update event', async () => {
      const { service, repository, transport } = build();
      repository.updateDescription.mockResolvedValue(row({ description: 'New' }));

      const response = await service.update(ME, { id: '7' }, { description: 'New' });

      expect(repository.updateDescription).toHaveBeenCalledWith(5, 7, 'New');
      expect(response.description).toBe('New');
      expect(transport.publish.mock.calls[0]?.[0]).toBeInstanceOf(TodoUpdatedV1);
    });

    it('answers ERP-CORE-0004 and publishes nothing when the to do is not found', async () => {
      const { service, repository, transport } = build();
      repository.updateDescription.mockResolvedValue(null);
      await expect(service.update(ME, { id: '7' }, { description: 'x' })).rejects.toMatchObject({
        code: 'ERP-CORE-0004',
      });
      expect(transport.publish).not.toHaveBeenCalled();
    });
  });

  describe('setFinished', () => {
    it('finishes with the wall clock of now and logs "to do finished"', async () => {
      const { service, repository, transport, logger } = build();
      repository.setFinished.mockResolvedValue(row({ finished: true, dateFinished: WALL }));

      const response = await service.setFinished(ME, { id: '7' }, { finished: true });

      expect(repository.setFinished).toHaveBeenCalledWith(5, 7, true, WALL);
      expect(response.finished).toBe(true);
      expect(response.dateFinished).toBe('2026-10-02T20:30:15.000Z');
      expect(transport.publish.mock.calls[0]?.[0]).toBeInstanceOf(TodoUpdatedV1);
      expect(logger.log).toHaveBeenCalledWith('to do finished', { id: 7 });
    });

    it('reopens with the current wall clock date and logs "to do reopened"', async () => {
      const { service, repository, logger } = build();
      repository.setFinished.mockResolvedValue(row({ finished: false, dateFinished: WALL }));
      const response = await service.setFinished(ME, { id: '7' }, { finished: false });
      expect(repository.setFinished).toHaveBeenCalledWith(5, 7, false, WALL);
      expect(response.finished).toBe(false);
      expect(response.dateFinished).toBe('2026-10-02T20:30:15.000Z');
      expect(logger.log).toHaveBeenCalledWith('to do reopened', { id: 7 });
    });

    it('answers ERP-CORE-0004 and publishes nothing when the to do is not found', async () => {
      const { service, repository, transport } = build();
      repository.setFinished.mockResolvedValue(null);
      await expect(service.setFinished(ME, { id: '7' }, { finished: true })).rejects.toMatchObject({
        code: 'ERP-CORE-0004',
      });
      expect(transport.publish).not.toHaveBeenCalled();
    });
  });
  describe('reorder', () => {
    it('saves the order and publishes an update event for every item', async () => {
      const { service, repository, transport, logger } = build();
      repository.reorder.mockResolvedValue(true);

      await service.reorder(ME, {
        finished: true,
        items: [8, 3, 7],
      });

      expect(repository.reorder).toHaveBeenCalledWith(5, true, [8, 3, 7]);
      expect(transport.publish).toHaveBeenCalledTimes(3);

      expect(transport.publish.mock.calls[0]?.[0]).toBeInstanceOf(TodoUpdatedV1);
      expect(transport.publish.mock.calls[1]?.[0]).toBeInstanceOf(TodoUpdatedV1);
      expect(transport.publish.mock.calls[2]?.[0]).toBeInstanceOf(TodoUpdatedV1);
      expect(logger.log).toHaveBeenCalledWith('to do order updated', {
        count: 3,
        finished: true,
      });
    });

    it('answers ERP-CORE-0004 and publishes nothing when an item is not found', async () => {
      const { service, repository, transport } = build();
      repository.reorder.mockResolvedValue(false);

      await expect(
        service.reorder(ME, {
          finished: false,
          items: [8, 99],
        }),
      ).rejects.toMatchObject({ code: 'ERP-CORE-0004' });

      expect(transport.publish).not.toHaveBeenCalled();
    });

    it('rejects an invalid body without calling the repository', async () => {
      const { service, repository } = build();

      await expect(
        service.reorder(ME, {
          finished: 'false',
          items: [],
        }),
      ).rejects.toBeInstanceOf(AppError);

      expect(repository.reorder).not.toHaveBeenCalled();
    });
  });
  describe('remove', () => {
    it("deletes the caller's own to do, publishes the delete event and logs the id", async () => {
      const { service, repository, transport, logger } = build();
      repository.remove.mockResolvedValue(true);

      await service.remove(ME, { id: '7' });

      expect(repository.remove).toHaveBeenCalledWith(5, 7);
      const event = transport.publish.mock.calls[0]?.[0] as TodoDeletedV1;
      expect(event).toBeInstanceOf(TodoDeletedV1);
      expect(event.payload).toEqual({ id: 7, staffId: 5, at: NOW.toISOString() });
      expect(logger.log).toHaveBeenCalledWith('to do deleted', { id: 7 });
    });

    it('answers ERP-CORE-0004 and publishes nothing when nothing was deleted', async () => {
      const { service, repository, transport } = build();
      repository.remove.mockResolvedValue(false);
      await expect(service.remove(ME, { id: '7' })).rejects.toMatchObject({
        code: 'ERP-CORE-0004',
      });
      expect(transport.publish).not.toHaveBeenCalled();
    });
  });

  it('countUnfinished (the facade read) takes the staff id from the caller, not an actor', async () => {
    const { service, repository } = build();
    repository.countUnfinished.mockResolvedValue(4);
    expect(await service.countUnfinished(9)).toBe(4);
    expect(repository.countUnfinished).toHaveBeenCalledWith(9);
  });

  it('uses UTC for the wall clock when default_timezone is unusable', async () => {
    const { service, repository, transport } = build();
    transport.companyTimeZone.mockResolvedValue(null);
    repository.create.mockResolvedValue(row());
    await service.create(ME, { description: 'x' });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({ dateAdded: new Date(Date.UTC(2026, 9, 2, 20, 30, 15)) }),
    );
  });
});
