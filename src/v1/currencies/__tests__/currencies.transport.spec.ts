/**
 * CurrenciesTransport: `publish` forwards to the domain-event port and nothing else. The module
 * reaches no other module from here (the registered counters are in-process, handed in through the
 * registry).
 */
import { describe, expect, it } from 'vitest';
import { DomainEvent } from '../../../shared/events/domain-event.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { CurrenciesTransport } from '../service/currencies.transport.js';

class ProbeEventV1 extends DomainEvent<'currencies.probe', { readonly id: string }> {
  static readonly NAME = 'currencies.probe' as const;
  readonly name = ProbeEventV1.NAME;
}

describe('CurrenciesTransport', () => {
  it('publish forwards to the DOMAIN_EVENT_PUBLISHER port, in order', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const transport = new CurrenciesTransport(publisher);
    const first = new ProbeEventV1({ id: 'c-1' });
    const second = new ProbeEventV1({ id: 'c-2' });

    await transport.publish(first);
    await transport.publish(second);

    expect(publisher.drain()).toEqual([first, second]);
  });

  it('has publish as its only method', () => {
    expect(
      Object.getOwnPropertyNames(CurrenciesTransport.prototype).filter(
        (name) => name !== 'constructor',
      ),
    ).toEqual(['publish']);
  });
});
