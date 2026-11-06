import { describe, expect, it, vi } from 'vitest';
import { ANNOUNCEMENTS_PUBLISHED_EVENTS, AnnouncementsCreatedV1 } from '../events/published.js';
import { AnnouncementsTransport } from '../service/announcements.transport.js';
import type { IdentityFacade } from '../../identity/index.js';

describe('AnnouncementsTransport', () => {
  it('forwards a domain event to the publisher port, once', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const transport = new AnnouncementsTransport({ publish }, {
      namesOf: vi.fn(),
    } as unknown as IdentityFacade);
    const event = new AnnouncementsCreatedV1({ id: 5, at: '2026-11-02T10:00:00.000Z' });
    await transport.publish(event);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(event);
  });

  it('lets a publisher failure reach the caller', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('bus down'));
    const transport = new AnnouncementsTransport({ publish }, {
      namesOf: vi.fn(),
    } as unknown as IdentityFacade);
    await expect(
      transport.publish(new AnnouncementsCreatedV1({ id: 5, at: '2026-11-02T10:00:00.000Z' })),
    ).rejects.toThrow('bus down');
  });

  it('resolves names through IdentityFacade.namesOf', async () => {
    const namesOf = vi.fn().mockResolvedValue(new Map([[7, 'Ada Lovelace']]));
    const transport = new AnnouncementsTransport({ publish: vi.fn() }, {
      namesOf,
    } as unknown as IdentityFacade);

    await expect(transport.nameOf(7)).resolves.toEqual(new Map([[7, 'Ada Lovelace']]));
    expect(namesOf).toHaveBeenCalledWith([7]);
  });

  it('the module publishes exactly the three record events', () => {
    expect(ANNOUNCEMENTS_PUBLISHED_EVENTS.map((event) => event.NAME)).toEqual([
      'announcements.record.created',
      'announcements.record.updated',
      'announcements.record.deleted',
    ]);
  });
});
