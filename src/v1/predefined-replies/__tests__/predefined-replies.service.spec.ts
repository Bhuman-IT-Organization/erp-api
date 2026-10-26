import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import type { PredefinedRepliesRepository } from '../repository/predefined-replies.repository.js';
import { PredefinedRepliesService } from '../service/predefined-replies.service.js';
import { PredefinedRepliesValidator } from '../service/predefined-replies.validator.js';

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
    create: vi
      .fn()
      .mockImplementation((input: { name: string; message: string }) =>
        Promise.resolve({ id: 2, ...input }),
      ),
    update: vi
      .fn()
      .mockImplementation((_id: number, input: { name: string; message: string }) =>
        Promise.resolve({ id: 1, ...input }),
      ),
    remove: vi.fn().mockResolvedValue(true),
  };

  const service = new PredefinedRepliesService(
    repository as unknown as PredefinedRepliesRepository,
    new PredefinedRepliesValidator(),
  );

  return { service, repository };
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

    expect(result.data).toEqual([
      { id: '1', name: 'Greeting', message: 'Hello, how can we help?' },
    ]);
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

    await expect(service.get(ADMIN, 1)).resolves.toEqual({ ...reply, id: '1' });
  });

  it('returns an error when a reply does not exist', async () => {
    const { service, repository } = build();
    repository.findById.mockResolvedValue(null);

    await expect(service.get(ADMIN, 404)).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
  });

  it('creates a reply through the repository', async () => {
    const { service, repository } = build();
    const input = { name: 'Thanks', message: 'Thank you!' };

    await expect(service.create(ADMIN, input)).resolves.toEqual({
      id: '2',
      ...input,
    });
    expect(repository.create).toHaveBeenCalledWith(input);
  });

  it('updates an existing reply', async () => {
    const { service, repository } = build();
    const input = { name: 'Updated', message: 'Updated message' };

    await expect(service.update(ADMIN, 1, input)).resolves.toEqual({
      id: '1',
      ...input,
    });
    expect(repository.update).toHaveBeenCalledWith(1, input);
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

    await expect(service.remove(ADMIN, 1)).resolves.toEqual({
      success: true,
    });
    expect(repository.remove).toHaveBeenCalledWith(1);
  });

  it('returns an error when deleting a missing reply', async () => {
    const { service, repository } = build();
    repository.remove.mockResolvedValue(false);

    await expect(service.remove(ADMIN, 404)).rejects.toMatchObject({
      code: 'ERP-CORE-0004',
    });
  });
});
