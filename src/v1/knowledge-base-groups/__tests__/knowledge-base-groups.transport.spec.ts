import { describe, expect, it } from 'vitest';
import { DomainEvent } from '../../../shared/events/domain-event.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { KnowledgeBaseGroupsTransport } from '../service/knowledge-base-groups.transport.js';

class ProbeEventV1 extends DomainEvent<'knowledge-base-groups.probe', { readonly id: number }> {
  static readonly NAME = 'knowledge-base-groups.probe' as const;
  readonly name = ProbeEventV1.NAME;
}

describe('KnowledgeBaseGroupsTransport', () => {
  it('publish forwards domain events to the publisher port in order', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const transport = new KnowledgeBaseGroupsTransport(publisher);
    const first = new ProbeEventV1({ id: 1 });
    const second = new ProbeEventV1({ id: 2 });

    await transport.publish(first);
    await transport.publish(second);

    expect(publisher.drain()).toEqual([first, second]);
  });
});
