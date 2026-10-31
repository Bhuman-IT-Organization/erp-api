import { describe, expect, it, vi } from 'vitest';
import type { DomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { ServicesCreatedV1 } from '../events/published.js';
import { ServicesTransport } from '../service/services.transport.js';

describe('ServicesTransport', () => {
  it('forwards a domain event to the publisher port', async () => {
    const publish = vi.fn().mockResolvedValue(undefined);
    const publisher = { publish } as unknown as DomainEventPublisher;
    const transport = new ServicesTransport(publisher);
    const event = new ServicesCreatedV1({ id: 1, at: '2026-10-24T10:00:00.000Z' });

    await transport.publish(event);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith(event);
  });
});
