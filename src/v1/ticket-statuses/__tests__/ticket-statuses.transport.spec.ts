import { describe, expect, it, vi } from 'vitest';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { SettingsFacade } from '../../settings/index.js';
import { TicketStatusCreatedV1 } from '../events/published.js';
import {
  DEFAULT_TICKET_REPLY_STATUS_OPTION,
  TicketStatusesTransport,
} from '../service/ticket-statuses.transport.js';

describe('TicketStatusesTransport', () => {
  it('reads the allow-listed reply status and publishes domain events through the shared port', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const getOption = vi.fn().mockResolvedValue('4');
    const settings = {
      getOption,
    } as unknown as SettingsFacade;
    const transport = new TicketStatusesTransport(publisher, settings);

    await expect(transport.defaultTicketReplyStatus()).resolves.toBe('4');
    expect(getOption).toHaveBeenCalledWith(DEFAULT_TICKET_REPLY_STATUS_OPTION);
    await transport.publish(new TicketStatusCreatedV1({ id: 4, at: '2026-10-24T10:30:00.000Z' }));
    expect(publisher.drain()).toHaveLength(1);
  });
});
