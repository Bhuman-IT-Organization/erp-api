import { describe, expect, it, vi } from 'vitest';
import type { DomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { SettingsFacade } from '../../settings/index.js';
import { TodoCreatedV1 } from '../events/published.js';
import { COMPANY_TIME_ZONE_OPTION, TodoTransport } from '../service/todo.transport.js';

describe('TodoTransport', () => {
  it('forwards a domain event to the publisher port', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const publisher = { publish } as unknown as DomainEventPublisher;
    const settings = {
      getOption: vi.fn().mockResolvedValue('Asia/Kolkata'),
    } as unknown as SettingsFacade;

    const transport = new TodoTransport(publisher, settings);
    const event = new TodoCreatedV1({
      id: 1,
      staffId: 5,
      at: '2026-11-05T10:00:00.000Z',
    });

    await transport.publish(event);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(event);
  });

  it('reads the company timezone using the default_timezone option', async () => {
    const publisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    } as unknown as DomainEventPublisher;
    const getOption = vi.fn().mockResolvedValue('Asia/Kolkata');
    const settings = { getOption } as unknown as SettingsFacade;

    const transport = new TodoTransport(publisher, settings);

    await expect(transport.companyTimeZone()).resolves.toBe('Asia/Kolkata');
    expect(getOption).toHaveBeenCalledTimes(1);
    expect(getOption).toHaveBeenCalledWith(COMPANY_TIME_ZONE_OPTION);
  });

  it('returns null when the company timezone option is not configured', async () => {
    const publisher = {
      publish: vi.fn().mockResolvedValue(undefined),
    } as unknown as DomainEventPublisher;
    const settings = {
      getOption: vi.fn().mockResolvedValue(null),
    } as unknown as SettingsFacade;

    const transport = new TodoTransport(publisher, settings);

    await expect(transport.companyTimeZone()).resolves.toBeNull();
  });
});
