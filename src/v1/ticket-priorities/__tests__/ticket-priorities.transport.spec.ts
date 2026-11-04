import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DomainEvent } from '../../../shared/events/domain-event.js';
import {
  EMAIL_PIPING_DEFAULT_PRIORITY_OPTION,
  TicketPrioritiesTransport,
} from '../service/ticket-priorities.transport.js';

describe('TicketPrioritiesTransport', () => {
  const publisher = { publish: vi.fn() };
  const settings = { getOption: vi.fn() };
  const transport = new TicketPrioritiesTransport(publisher, settings as never);

  // Match this to the real DomainEvent shape if the type check complains.
  const event = {
    name: 'ticket-priorities.record.created',
    payload: { id: '1', at: '2026-10-29T09:00:00.000Z' },
  } as unknown as DomainEvent;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('hands the event to the publisher port', async () => {
    publisher.publish.mockResolvedValue(undefined);
    await transport.publish(event);
    expect(publisher.publish).toHaveBeenCalledWith(event);
  });

  it('lets a publisher failure through', async () => {
    publisher.publish.mockRejectedValue(new Error('bus down'));
    await expect(transport.publish(event)).rejects.toThrow('bus down');
  });

  it('reads the email piping default priority option by its Perfex name', async () => {
    settings.getOption.mockResolvedValue('3');
    await expect(transport.emailPipingDefaultPriority()).resolves.toBe('3');
    expect(settings.getOption).toHaveBeenCalledWith(EMAIL_PIPING_DEFAULT_PRIORITY_OPTION);
    expect(EMAIL_PIPING_DEFAULT_PRIORITY_OPTION).toBe('email_piping_default_priority');
  });

  it('returns null when the option has no row', async () => {
    settings.getOption.mockResolvedValue(null);
    await expect(transport.emailPipingDefaultPriority()).resolves.toBeNull();
  });

  it('throws when the setting cannot be read', async () => {
    settings.getOption.mockRejectedValue(new Error('settings unavailable'));
    await expect(transport.emailPipingDefaultPriority()).rejects.toThrow('settings unavailable');
  });
});
