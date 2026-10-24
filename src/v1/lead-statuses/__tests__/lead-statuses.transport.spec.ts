import { describe, expect, it, vi } from 'vitest';

import type { SettingsFacade } from '../../settings/index.js';

import { LeadStatusesCreatedV1 } from '../events/published.js';
import { LeadStatusesTransport } from '../service/lead-statuses.transport.js';

describe('LeadStatusesTransport', () => {
  function build(value: string | null = '2') {
    const publisher = {
      publish: vi.fn(() => Promise.resolve()),
    };

    const settings = {
      getOption: vi.fn(() => Promise.resolve(value)),
    };

    const transport = new LeadStatusesTransport(publisher, settings as unknown as SettingsFacade);

    return { transport, publisher, settings };
  }

  it('reads the configured default lead status', async () => {
    const { transport, settings } = build('5');

    await expect(transport.configuredDefaultStatus()).resolves.toBe('5');

    expect(settings.getOption).toHaveBeenCalledWith('leads_default_status');
  });

  it('returns null when the default setting is absent', async () => {
    const { transport } = build(null);

    await expect(transport.configuredDefaultStatus()).resolves.toBeNull();
  });

  it('publishes a domain event', async () => {
    const { transport, publisher } = build();

    const event = new LeadStatusesCreatedV1({
      id: 3,
      at: '2026-10-22T10:00:00.000Z',
    });

    await transport.publish(event);

    expect(publisher.publish).toHaveBeenCalledTimes(1);
    expect(publisher.publish).toHaveBeenCalledWith(event);
  });

  it('propagates a publishing failure', async () => {
    const { transport, publisher } = build();

    const event = new LeadStatusesCreatedV1({
      id: 3,
      at: '2026-10-22T10:00:00.000Z',
    });

    publisher.publish.mockRejectedValueOnce(new Error('Publisher unavailable'));

    await expect(transport.publish(event)).rejects.toThrow('Publisher unavailable');
  });
});
