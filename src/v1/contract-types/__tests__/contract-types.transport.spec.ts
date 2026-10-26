/**
 * ContractTypesTransport: `publish` forwards the event to the `DOMAIN_EVENT_PUBLISHER` port unchanged
 * and in order, and `companyTimeZone` reads Perfex's `default_timezone` through the settings facade
 * once, answering its stored text (or `null` without a row). No network: both are in-process.
 */
import { describe, expect, it } from 'vitest';
import { DomainEvent } from '../../../shared/events/domain-event.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { FakeSettingsFacade } from '../../settings/__tests__/fakes.js';
import type { SettingsFacade } from '../../settings/index.js';
import {
  COMPANY_TIME_ZONE_OPTION,
  ContractTypesTransport,
} from '../service/contract-types.transport.js';

class ProbeEventV1 extends DomainEvent<'contract-types.probe', { readonly id: string }> {
  static readonly NAME = 'contract-types.probe' as const;
  readonly name = ProbeEventV1.NAME;
}

/** The fake answers the facade's two methods; the transport expects the class. */
function asFacade(fake: FakeSettingsFacade): SettingsFacade {
  return fake as unknown as SettingsFacade;
}

describe('ContractTypesTransport', () => {
  it('publish forwards to the DOMAIN_EVENT_PUBLISHER port, in order', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const transport = new ContractTypesTransport(publisher, asFacade(new FakeSettingsFacade()));
    const first = new ProbeEventV1({ id: 'ct-1' });
    const second = new ProbeEventV1({ id: 'ct-2' });

    await transport.publish(first);
    await transport.publish(second);

    expect(publisher.drain()).toEqual([first, second]);
  });

  it('companyTimeZone reads default_timezone once through the settings facade and answers its value', async () => {
    const settings = new FakeSettingsFacade([{ name: 'default_timezone', value: 'Asia/Dubai' }]);
    const transport = new ContractTypesTransport(
      new RecordingDomainEventPublisher(),
      asFacade(settings),
    );
    expect(COMPANY_TIME_ZONE_OPTION).toBe('default_timezone');
    expect(await transport.companyTimeZone()).toBe('Asia/Dubai');
    expect(settings.calls).toEqual([['default_timezone']]);
  });

  it('companyTimeZone answers null when Perfex has no default_timezone row', async () => {
    const transport = new ContractTypesTransport(
      new RecordingDomainEventPublisher(),
      asFacade(new FakeSettingsFacade()),
    );
    expect(await transport.companyTimeZone()).toBeNull();
  });
});
