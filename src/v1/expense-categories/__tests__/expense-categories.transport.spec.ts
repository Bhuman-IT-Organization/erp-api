/**
 * ExpenseCategoriesTransport over the recording publisher: `publish` forwards the event to the
 * `DOMAIN_EVENT_PUBLISHER` port unchanged and in order. No network: this skeleton has no outbound
 * call; the ADR-0031 nesting is documented in the transport and exercised by `v1/auth`'s spec.
 */
import { describe, expect, it } from 'vitest';
import { DomainEvent } from '../../../shared/events/domain-event.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { ExpenseCategoriesTransport } from '../service/expense-categories.transport.js';

class ProbeEventV1 extends DomainEvent<'expense-categories.probe', { readonly id: string }> {
  static readonly NAME = 'expense-categories.probe' as const;
  readonly name = ProbeEventV1.NAME;
}

describe('ExpenseCategoriesTransport', () => {
  it('publish forwards to the DOMAIN_EVENT_PUBLISHER port, in order', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const transport = new ExpenseCategoriesTransport(publisher);
    const first = new ProbeEventV1({ id: 'ex-1' });
    const second = new ProbeEventV1({ id: 'ex-2' });

    await transport.publish(first);
    await transport.publish(second);

    expect(publisher.count).toBe(2);
    const drained = publisher.drain();
    expect(drained).toEqual([first, second]);
    expect(drained[0]?.name).toBe('expense-categories.probe');
    expect(drained[0]?.version).toBe(1);
    expect(publisher.count).toBe(0);
  });
});
