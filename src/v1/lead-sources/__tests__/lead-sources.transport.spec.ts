import { describe, expect, it } from 'vitest';
import { DomainEvent } from '../../../shared/events/domain-event.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { LeadSourcesTransport } from '../service/lead-sources.transport.js';

class ProbeEventV1 extends DomainEvent<'lead-sources.probe', { readonly id: string }> {
  static readonly NAME = 'lead-sources.probe' as const;
  readonly name = ProbeEventV1.NAME;
}

describe('LeadSourcesTransport', () => {
  it('forwards domain events unchanged and in order', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const transport = new LeadSourcesTransport(publisher);
    const first = new ProbeEventV1({ id: 'lead-source-1' });
    const second = new ProbeEventV1({ id: 'lead-source-2' });
    await transport.publish(first);
    await transport.publish(second);
    expect(publisher.drain()).toEqual([first, second]);
  });
});
