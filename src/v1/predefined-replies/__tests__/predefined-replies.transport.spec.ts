import { describe, expect, it } from 'vitest';
import { DomainEvent } from '../../../shared/events/domain-event.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { PredefinedRepliesTransport } from '../service/predefined-replies.transport.js';

class ProbeEvent extends DomainEvent<'predefined-replies.probe', { readonly id: number }> {
  static readonly NAME = 'predefined-replies.probe' as const;
  readonly name = ProbeEvent.NAME;
}

describe('PredefinedRepliesTransport', () => {
  it('forwards events to the domain event publisher in order', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const transport = new PredefinedRepliesTransport(publisher);
    const first = new ProbeEvent({ id: 1 });
    const second = new ProbeEvent({ id: 2 });

    await transport.publish(first);
    await transport.publish(second);

    expect(publisher.drain()).toEqual([first, second]);
  });
});
