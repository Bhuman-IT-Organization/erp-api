/**
 * `events/handlers/currencies-change.handler.ts`: branding's two subscriptions to `v1/currencies`
 * (D-39, Currencies planning answer 6). The properties worth a test are the wiring (exactly the two
 * names, each dropping the memo), that another name does nothing, and that no payload makes it
 * throw: the handler parses nothing, because a memo drop needs no id.
 *
 * Nothing here imports `v1/currencies`' events: the names come from branding's own
 * `events/subscribed.ts`, which makes the subscription a wire contract rather than a code
 * dependency (BE-03).
 */
import { describe, expect, it, vi } from 'vitest';
import { DomainEvent } from '../../../shared/events/domain-event.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { CurrenciesChangeEventHandler } from '../events/handlers/currencies-change.handler.js';
import { BRANDING_SUBSCRIBED_EVENTS, CURRENCIES_EVENTS } from '../events/subscribed.js';
import type { BrandingService } from '../service/branding.service.js';

class CurrenciesEvent extends DomainEvent {
  constructor(
    readonly name: string,
    payload: unknown,
  ) {
    super(payload);
  }
}

function build() {
  const bus = new RecordingDomainEventPublisher();
  const dropMemo = vi.fn();
  const service = { dropMemo } as unknown as BrandingService;
  new CurrenciesChangeEventHandler(bus, service).onModuleInit();
  return { bus, dropMemo };
}

describe('BRANDING_SUBSCRIBED_EVENTS', () => {
  it('is exactly the two currencies events (D-39 baseChanged, answer 6 updated)', () => {
    expect([...BRANDING_SUBSCRIBED_EVENTS]).toEqual([
      'currencies.record.baseChanged',
      'currencies.record.updated',
    ]);
    expect(CURRENCIES_EVENTS).toEqual({
      baseChanged: 'currencies.record.baseChanged',
      updated: 'currencies.record.updated',
    });
  });
});

describe('CurrenciesChangeEventHandler', () => {
  it('drops the memo on currencies.record.baseChanged', async () => {
    const { bus, dropMemo } = build();
    await bus.publish(
      new CurrenciesEvent(CURRENCIES_EVENTS.baseChanged, { id: 2, previousId: 1, at: 'now' }),
    );
    expect(dropMemo).toHaveBeenCalledTimes(1);
  });

  it('drops the memo on currencies.record.updated', async () => {
    const { bus, dropMemo } = build();
    await bus.publish(new CurrenciesEvent(CURRENCIES_EVENTS.updated, { id: 2, at: 'now' }));
    expect(dropMemo).toHaveBeenCalledTimes(1);
  });

  it.each(['currencies.record.created', 'currencies.record.deleted', 'taxes.record.updated'])(
    'does nothing on %s',
    async (name) => {
      const { bus, dropMemo } = build();
      await bus.publish(new CurrenciesEvent(name, { id: 2, at: 'now' }));
      expect(dropMemo).not.toHaveBeenCalled();
    },
  );

  it.each([null, undefined, 'x', 42, {}, { id: 'not a number' }])(
    'never throws on the payload %j and still drops the memo',
    async (payload) => {
      const { bus, dropMemo } = build();
      await bus.publish(new CurrenciesEvent(CURRENCIES_EVENTS.updated, payload));
      await bus.publish(new CurrenciesEvent(CURRENCIES_EVENTS.baseChanged, payload));
      expect(dropMemo).toHaveBeenCalledTimes(2);
      expect(bus.handlerFailures).toEqual([]);
    },
  );
});
