import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../../../shared/http/auth/access-token-verifier.js';
import { PredefinedRepliesFacade } from '../facade/predefined-replies.facade.js';
import type { PredefinedRepliesService } from '../service/predefined-replies.service.js';

const actor = {
  staffId: 1,
  sessionId: 'test-session',
  jti: 'test-jti',
  isAdmin: true,
  roleId: null,
  tokenVersion: 0,
  expiresAt: 1_800_000_000,
} satisfies AuthenticatedUser;

const reply = {
  id: 1,
  name: 'Greeting',
  message: 'Hello, how can we help?',
};

function build() {
  const service = {
    list: vi.fn().mockResolvedValue({
      data: [{ ...reply, id: '1' }],
      meta: {
        nextCursor: null,
        prevCursor: null,
        total: 1,
        rangeStart: 1,
      },
    }),
    get: vi.fn().mockResolvedValue({ ...reply, id: '1' }),
  };

  const facade = new PredefinedRepliesFacade(service as unknown as PredefinedRepliesService);

  return { facade, service };
}

describe('PredefinedRepliesFacade', () => {
  it('forwards list requests to the service', async () => {
    const { facade, service } = build();
    const query = { limit: 10 };

    await expect(facade.list(actor, query)).resolves.toEqual({
      data: [{ ...reply, id: '1' }],
      meta: {
        nextCursor: null,
        prevCursor: null,
        total: 1,
        rangeStart: 1,
      },
    });

    expect(service.list).toHaveBeenCalledWith(actor, query);
  });

  it('returns a reply with a string ID', async () => {
    const { facade, service } = build();

    await expect(facade.findById(actor, 1)).resolves.toEqual({
      id: '1',
      name: 'Greeting',
      message: 'Hello, how can we help?',
    });

    expect(service.get).toHaveBeenCalledWith(actor, 1);
  });
});
