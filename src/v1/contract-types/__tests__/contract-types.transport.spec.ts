/**
 * ContractTypesTransport: `publish` forwards the event to the `DOMAIN_EVENT_PUBLISHER` port unchanged
 * and in order. No network: in-process.
 */
import { describe, expect, it } from 'vitest';
import { DomainEvent } from '../../../shared/events/domain-event.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { ContractTypesTransport } from '../service/contract-types.transport.js';

class ProbeEventV1 extends DomainEvent<'contract-types.probe', { readonly id: string }> {
  static readonly NAME = 'contract-types.probe' as const;
  readonly name = ProbeEventV1.NAME;
}

describe('ContractTypesTransport', () => {
  it('publish forwards to the DOMAIN_EVENT_PUBLISHER port, in order', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const transport = new ContractTypesTransport(publisher);
    const first = new ProbeEventV1({ id: 'ct-1' });
    const second = new ProbeEventV1({ id: 'ct-2' });

    await transport.publish(first);
    await transport.publish(second);

    expect(publisher.drain()).toEqual([first, second]);
  });
});
