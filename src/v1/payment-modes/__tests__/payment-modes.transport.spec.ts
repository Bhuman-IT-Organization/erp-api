/**
 * PaymentModesTransport: `publish` forwards the event to the `DOMAIN_EVENT_PUBLISHER` port unchanged
 * and in order, and `creditExpenseMode` reads Perfex's `expense_credit_payment_mode` through the
 * settings facade once, answering its stored text (or `null` without a row). No network: both are
 * in-process.
 */
import { describe, expect, it } from 'vitest';
import { DomainEvent } from '../../../shared/events/domain-event.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { FakeSettingsFacade } from '../../settings/__tests__/fakes.js';
import type { SettingsFacade } from '../../settings/index.js';
import {
  CREDIT_EXPENSE_MODE_OPTION,
  PaymentModesTransport,
} from '../service/payment-modes.transport.js';

class ProbeEventV1 extends DomainEvent<'payment-modes.probe', { readonly id: string }> {
  static readonly NAME = 'payment-modes.probe' as const;
  readonly name = ProbeEventV1.NAME;
}

/** The fake answers the facade's two methods; the transport expects the class. */
function asFacade(fake: FakeSettingsFacade): SettingsFacade {
  return fake as unknown as SettingsFacade;
}

describe('PaymentModesTransport', () => {
  it('publish forwards to the DOMAIN_EVENT_PUBLISHER port, in order', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const transport = new PaymentModesTransport(publisher, asFacade(new FakeSettingsFacade()));
    const first = new ProbeEventV1({ id: 'pm-1' });
    const second = new ProbeEventV1({ id: 'pm-2' });

    await transport.publish(first);
    await transport.publish(second);

    expect(publisher.drain()).toEqual([first, second]);
  });

  it('creditExpenseMode reads expense_credit_payment_mode once through the settings facade and answers its value', async () => {
    const settings = new FakeSettingsFacade([{ name: 'expense_credit_payment_mode', value: '7' }]);
    const transport = new PaymentModesTransport(
      new RecordingDomainEventPublisher(),
      asFacade(settings),
    );
    expect(CREDIT_EXPENSE_MODE_OPTION).toBe('expense_credit_payment_mode');
    expect(await transport.creditExpenseMode()).toBe('7');
    expect(settings.calls).toEqual([['expense_credit_payment_mode']]);
  });

  it('creditExpenseMode answers null when Perfex has no row (the local copy sets none)', async () => {
    const transport = new PaymentModesTransport(
      new RecordingDomainEventPublisher(),
      asFacade(new FakeSettingsFacade()),
    );
    expect(await transport.creditExpenseMode()).toBeNull();
  });
});
