import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { PredefinedRepliesRepository } from '../repository/predefined-replies.repository.js';
import { PredefinedRepliesService } from '../service/predefined-replies.service.js';
import { PredefinedRepliesTransport } from '../service/predefined-replies.transport.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { PredefinedRepliesValidator } from '../service/predefined-replies.validator.js';
import { PredefinedRepliesTransformer } from '../service/predefined-replies.transformer.js';

const NOW = 1_800_000_000;

function actor(isAdmin: boolean): AuthenticatedUser {
  return {
    staffId: isAdmin ? 1 : 2,
    sessionId: 'test-session',
    jti: 'test-jti',
    isAdmin,
    roleId: null,
    tokenVersion: 0,
    expiresAt: NOW,
  };
}

const ADMIN = actor(true);
const MEMBER = actor(false);

const reply = {
  id: 1,
  name: 'Greeting',
  message: 'Hello, how can we help?',
};

function build() {
  const repository = {
    list: vi.fn().mockResolvedValue({
      items: [reply],
      nextCursor: null,
      prevCursor: null,
      total: 1,
      rangeStart: 1,
    }),
    findById: vi.fn().mockResolvedValue(reply),
    listAll: vi.fn().mockResolvedValue([reply]),
    findByIds: vi.fn().mockResolvedValue([reply]),
    create: vi
      .fn()
      .mockImplementation((input: { name: string; message: string }) =>
        Promise.resolve({ id: 2, ...input }),
      ),
    update: vi.fn().mockImplementation((_id: number, input: { name?: string; message?: string }) =>
      Promise.resolve({
        id: 1,
        name: input.name ?? reply.name,
        message: input.message ?? '<p>Hello, how can we help?</p>',
      }),
    ),
    remove: vi.fn().mockResolvedValue(true),
  };

  const publisher = new RecordingDomainEventPublisher();
  const transport = new PredefinedRepliesTransport(publisher);
  const logger = { log: vi.fn() } as unknown as LoggerService;

  const service = new PredefinedRepliesService(
    repository as unknown as PredefinedRepliesRepository,
    new PredefinedRepliesValidator(),
    transport,
    logger,
    new PredefinedRepliesTransformer(),
  );

  return { service, repository, publisher, logger };
}

describe('PredefinedRepliesService', () => {
  it('rejects non-administrators before accessing the repository', async () => {
    const { service, repository } = build();

    await expect(service.list(MEMBER, {})).rejects.toMatchObject({
      code: 'ERP-AUTH-0005',
    });

    expect(repository.list).not.toHaveBeenCalled();
  });

  it('lists replies with string IDs and pagination metadata', async () => {
    const { service, repository } = build();

    const result = await service.list(ADMIN, {});

    expect(result.data).toEqual([{ id: '1', name: 'Greeting' }]);
    expect(result.meta).toMatchObject({
      total: 1,
      rangeStart: 1,
      nextCursor: null,
      prevCursor: null,
    });
    expect(repository.list).toHaveBeenCalledTimes(1);
  });

  it('returns a reply by ID', async () => {
    const { service } = build();

    await expect(service.get(ADMIN, 1)).resolves.toEqual({
      id: '1',
      name: 'Greeting',
      message: 'Hello, how can we help?',
      hasOtherFormatting: false,
    });
  });

  it('returns an error when a reply does not exist', async () => {
    const { service, repository } = build();
    repository.findById.mockResolvedValue(null);

    await expect(service.get(ADMIN, 404)).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
  });

  it('provides actor-free stored-record reads without converting HTML', async () => {
    const { service, repository } = build();
    const stored = {
      id: 7,
      name: 'Stored',
      message: '<p>&lt;b&gt;</p>',
    };
    repository.findById.mockResolvedValue(stored);
    repository.listAll.mockResolvedValue([stored]);
    repository.findByIds.mockResolvedValue([stored]);

    await expect(service.findById(7)).resolves.toEqual(stored);
    await expect(service.listAll()).resolves.toEqual([stored]);
    await expect(service.findByIds([7, 7, 404])).resolves.toEqual([stored]);
    expect(repository.findByIds).toHaveBeenCalledWith([7, 404]);
  });

  it('creates a reply through the repository', async () => {
    const { service, repository } = build();
    const input = { name: 'Thanks', message: 'Thank you!' };

    await expect(service.create(ADMIN, input)).resolves.toEqual({
      id: '2',
      ...input,
      hasOtherFormatting: false,
    });
    expect(repository.create).toHaveBeenCalledWith({
      name: input.name,
      message: '<p>Thank you!</p>',
    });
  });

  it('updates an existing reply', async () => {
    const { service, repository } = build();
    const input = { name: 'Updated', message: 'Updated message' };

    await expect(service.update(ADMIN, 1, input)).resolves.toEqual({
      id: '1',
      ...input,
      hasOtherFormatting: false,
    });
    expect(repository.update).toHaveBeenCalledWith(1, {
      name: input.name,
      message: '<p>Updated message</p>',
    });
  });

  it('returns an error when updating a missing reply', async () => {
    const { service, repository } = build();
    repository.update.mockResolvedValue(null);

    await expect(
      service.update(ADMIN, 404, { name: 'Missing', message: 'Message' }),
    ).rejects.toMatchObject({ code: 'ERP-CORE-0004' });
  });

  it('deletes a reply', async () => {
    const { service, repository } = build();

    await expect(service.remove(ADMIN, 1)).resolves.toBeUndefined();
    expect(repository.remove).toHaveBeenCalledWith(1);
  });

  it('returns an error when deleting a missing reply', async () => {
    const { service, repository } = build();
    repository.remove.mockResolvedValue(false);

    await expect(service.remove(ADMIN, 404)).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
  });

  it('preserves the stored message when only the name is updated', async () => {
    const { service, repository } = build();
    repository.findById.mockResolvedValue({
      id: 1,
      name: 'Greeting',
      message: '<p>Original</p>',
    });
    repository.update.mockImplementation((_id, input: { name?: string; message?: string }) =>
      Promise.resolve({
        id: 1,
        name: input.name ?? 'Greeting',
        message: input.message ?? '<p>Original</p>',
      }),
    );

    await expect(service.update(ADMIN, 1, { name: 'Renamed' })).resolves.toMatchObject({
      name: 'Renamed',
      message: 'Original',
    });
    expect(repository.update).toHaveBeenCalledWith(1, { name: 'Renamed' });
  });

  it('publishes create, update and delete events with only the record ID', async () => {
    const { service, publisher } = build();
    await service.create(ADMIN, { name: 'Created', message: 'Hello' });
    await service.update(ADMIN, 1, { name: 'Changed' });
    await service.remove(ADMIN, 1);

    expect(
      publisher.drain().map((event) => ({ name: event.name, payload: event.payload })),
    ).toEqual([
      { name: 'predefined-replies.record.created', payload: { id: 2 } },
      { name: 'predefined-replies.record.updated', payload: { id: 1 } },
      { name: 'predefined-replies.record.deleted', payload: { id: 1 } },
    ]);
  });
});
