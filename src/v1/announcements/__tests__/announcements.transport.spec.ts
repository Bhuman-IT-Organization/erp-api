import { describe, expect, it, vi } from 'vitest';
import type { IdentityFacade } from '../../identity/index.js';
import type { SettingsFacade } from '../../settings/index.js';
import { ANNOUNCEMENTS_PUBLISHED_EVENTS, AnnouncementsCreatedV1 } from '../events/published.js';
import {
  AnnouncementsTransport,
  COMPANY_TIME_ZONE_OPTION,
} from '../service/announcements.transport.js';

const identity = { namesOf: vi.fn() } as unknown as IdentityFacade;
const settings = { getOption: vi.fn() } as unknown as SettingsFacade;

describe('AnnouncementsTransport', () => {
  it('forwards a domain event to the publisher port, once', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const transport = new AnnouncementsTransport({ publish }, identity, settings);
    const event = new AnnouncementsCreatedV1({ id: 5, at: '2026-11-02T10:00:00.000Z' });
    await transport.publish(event);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(event);
  });

  it('lets a publisher failure reach the caller', async () => {
    const publish = vi.fn().mockRejectedValue(new Error('bus down'));
    const transport = new AnnouncementsTransport({ publish }, identity, settings);
    await expect(
      transport.publish(new AnnouncementsCreatedV1({ id: 5, at: '2026-11-02T10:00:00.000Z' })),
    ).rejects.toThrow('bus down');
  });

  it('resolves names through IdentityFacade.namesOf', async () => {
    const namesOf = vi.fn().mockResolvedValue(new Map([[7, 'Ada Lovelace']]));
    const transport = new AnnouncementsTransport(
      { publish: vi.fn() },
      { namesOf } as unknown as IdentityFacade,
      settings,
    );

    await expect(transport.nameOf(7)).resolves.toEqual(new Map([[7, 'Ada Lovelace']]));
    expect(namesOf).toHaveBeenCalledWith([7]);
  });

  it("reads Perfex's default_timezone through SettingsFacade.getOption", async () => {
    const getOption = vi.fn().mockResolvedValue('Asia/Kolkata');
    const transport = new AnnouncementsTransport({ publish: vi.fn() }, identity, {
      getOption,
    } as unknown as SettingsFacade);

    expect(COMPANY_TIME_ZONE_OPTION).toBe('default_timezone');
    await expect(transport.companyTimeZone()).resolves.toBe('Asia/Kolkata');
    expect(getOption).toHaveBeenCalledWith('default_timezone');
  });

  it('answers null when the option has no row', async () => {
    const transport = new AnnouncementsTransport({ publish: vi.fn() }, identity, {
      getOption: vi.fn().mockResolvedValue(null),
    } as unknown as SettingsFacade);
    await expect(transport.companyTimeZone()).resolves.toBeNull();
  });

  it('the module publishes exactly the three record events', () => {
    expect(ANNOUNCEMENTS_PUBLISHED_EVENTS.map((event) => event.NAME)).toEqual([
      'announcements.record.created',
      'announcements.record.updated',
      'announcements.record.deleted',
    ]);
  });
});
