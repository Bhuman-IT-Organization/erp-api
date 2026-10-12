/**
 * IdentityTransport over the recording publisher and a fake departments facade: `publish` forwards
 * the event to the `DOMAIN_EVENT_PUBLISHER` port unchanged and in order; `listDepartments` and
 * `knownDepartmentIds` answer what `DepartmentsFacade.listForPicker()` and `existingIds()` answer
 * (D-55). No network: the departments facade is an in-process call.
 */
import { describe, expect, it } from 'vitest';
import { DomainEvent } from '../../../shared/events/domain-event.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import type { DepartmentsFacade } from '../../departments/index.js';
import { FakeDepartmentsFacade } from '../../departments/__tests__/fakes.js';
import { IdentityTransport } from '../service/identity.transport.js';
import { SEED_PICKER_DEPARTMENTS } from './fakes.js';

const fakeDepartments = (): FakeDepartmentsFacade =>
  new FakeDepartmentsFacade(SEED_PICKER_DEPARTMENTS);
const asFacade = (fake: FakeDepartmentsFacade): DepartmentsFacade =>
  fake as unknown as DepartmentsFacade;

class ProbeEventV1 extends DomainEvent<'identity.probe', { readonly id: string }> {
  static readonly NAME = 'identity.probe' as const;
  readonly name = ProbeEventV1.NAME;
}

describe('IdentityTransport', () => {
  it('publish forwards to the DOMAIN_EVENT_PUBLISHER port, in order', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const transport = new IdentityTransport(publisher, asFacade(fakeDepartments()));
    const first = new ProbeEventV1({ id: 'ex-1' });
    const second = new ProbeEventV1({ id: 'ex-2' });

    await transport.publish(first);
    await transport.publish(second);

    expect(publisher.count).toBe(2);
    const drained = publisher.drain();
    expect(drained).toEqual([first, second]);
    expect(drained[0]?.name).toBe('identity.probe');
    expect(drained[0]?.version).toBe(1);
    expect(publisher.count).toBe(0);
  });

  it('listDepartments answers DepartmentsFacade.listForPicker() (D-55)', async () => {
    const departments = fakeDepartments();
    const transport = new IdentityTransport(
      new RecordingDomainEventPublisher(),
      asFacade(departments),
    );
    expect(await transport.listDepartments()).toEqual(SEED_PICKER_DEPARTMENTS);
    expect(departments.pickerCalls).toBe(1);
  });

  it('knownDepartmentIds answers DepartmentsFacade.existingIds() (D-55)', async () => {
    const departments = fakeDepartments();
    const transport = new IdentityTransport(
      new RecordingDomainEventPublisher(),
      asFacade(departments),
    );
    expect(await transport.knownDepartmentIds([3, 99])).toEqual(new Set([3]));
    expect(departments.asked).toEqual([[3, 99]]);
  });
});
