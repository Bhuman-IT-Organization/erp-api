/**
 * `events/handlers/identity-access.handler.ts` — `auth`'s four subscriptions to `v1/identity`
 * (identity-access brief §7, plus review CR-02 a). The properties worth a test are the wiring
 * (exactly four names, each on the right action), the payload guard (a payload with no `staffId`
 * is dropped, never guessed at) and the containment (a failing handler does not propagate to the
 * publisher's caller).
 *
 * Nothing here imports `v1/identity`: the names come from `auth`'s own `events/subscribed.ts`, which
 * is what makes this subscription a wire contract rather than a code dependency (BE-03).
 */
import { describe, expect, it, vi } from 'vitest';
import { DomainEvent } from '../../../shared/events/domain-event.js';
import { RecordingDomainEventPublisher } from '../../../shared/events/domain-event.publisher.js';
import { LoggerService } from '../../../shared/logger/logger.service.js';
import { IdentityAccessEventHandler } from '../events/handlers/identity-access.handler.js';
import { AUTH_SUBSCRIBED_EVENTS, IDENTITY_EVENTS } from '../events/subscribed.js';
import type { AuthService } from '../service/auth.service.js';

const STAFF_ID = 42;

class IdentityEvent extends DomainEvent {
  constructor(
    readonly name: string,
    payload: unknown,
  ) {
    super(payload);
  }
}

interface Harness {
  readonly bus: RecordingDomainEventPublisher;
  readonly endSessionsOf: ReturnType<typeof vi.fn>;
  readonly dropPermissionSnapshot: ReturnType<typeof vi.fn>;
  readonly warn: ReturnType<typeof vi.fn>;
}

function build(overrides: { endSessionsOf?: () => Promise<void> } = {}): Harness {
  const bus = new RecordingDomainEventPublisher();
  const endSessionsOf = vi.fn(overrides.endSessionsOf ?? (() => Promise.resolve()));
  const dropPermissionSnapshot = vi.fn(() => Promise.resolve());
  const logger = new LoggerService();
  const warn = vi.fn();
  vi.spyOn(logger, 'warn').mockImplementation(warn);
  const service = { endSessionsOf, dropPermissionSnapshot } as unknown as AuthService;
  new IdentityAccessEventHandler(bus, service, logger).onModuleInit();
  return { bus, endSessionsOf, dropPermissionSnapshot, warn };
}

describe('AUTH_SUBSCRIBED_EVENTS', () => {
  it('is exactly the three identity events brief §7 names, plus identity.member.accessChanged (review CR-02 a)', () => {
    expect([...AUTH_SUBSCRIBED_EVENTS]).toEqual([
      'identity.member.passwordChanged',
      'identity.member.deactivated',
      'identity.permissions.replaced',
      'identity.member.accessChanged',
    ]);
  });
});

describe('IdentityAccessEventHandler', () => {
  it('bumps the token version on identity.member.passwordChanged', async () => {
    const { bus, endSessionsOf, dropPermissionSnapshot } = build();
    await bus.publish(
      new IdentityEvent(IDENTITY_EVENTS.memberPasswordChanged, { staffId: STAFF_ID, at: 'now' }),
    );
    expect(endSessionsOf).toHaveBeenCalledWith(STAFF_ID);
    expect(dropPermissionSnapshot).not.toHaveBeenCalled();
  });

  it('bumps the token version on identity.member.deactivated', async () => {
    const { bus, endSessionsOf } = build();
    await bus.publish(
      new IdentityEvent(IDENTITY_EVENTS.memberDeactivated, { staffId: STAFF_ID, at: 'now' }),
    );
    expect(endSessionsOf).toHaveBeenCalledWith(STAFF_ID);
  });

  it('drops the permission snapshot on identity.permissions.replaced, and never the token version', async () => {
    const { bus, endSessionsOf, dropPermissionSnapshot } = build();
    await bus.publish(
      new IdentityEvent(IDENTITY_EVENTS.permissionsReplaced, { staffId: STAFF_ID, at: 'now' }),
    );
    expect(dropPermissionSnapshot).toHaveBeenCalledWith(STAFF_ID);
    expect(endSessionsOf).not.toHaveBeenCalled();
  });

  it('ends the sessions AND drops the permission snapshot on identity.member.accessChanged (CR-02 a)', async () => {
    const { bus, endSessionsOf, dropPermissionSnapshot } = build();
    await bus.publish(
      new IdentityEvent('identity.member.accessChanged', { staffId: STAFF_ID, at: 'now' }),
    );
    expect(endSessionsOf).toHaveBeenCalledWith(STAFF_ID);
    expect(dropPermissionSnapshot).toHaveBeenCalledWith(STAFF_ID);
    expect(bus.handlerFailures).toEqual([]);
  });

  it('ignores an event it does not subscribe to', async () => {
    const { bus, endSessionsOf, dropPermissionSnapshot } = build();
    await bus.publish(new IdentityEvent('identity.member.created', { staffId: STAFF_ID }));
    expect(endSessionsOf).not.toHaveBeenCalled();
    expect(dropPermissionSnapshot).not.toHaveBeenCalled();
  });

  it('drops a payload with no positive integer staffId with one warn, and acts on nothing', async () => {
    const { bus, endSessionsOf, warn } = build();
    for (const payload of [{}, { staffId: 0 }, { staffId: '42' }, null]) {
      await bus.publish(new IdentityEvent(IDENTITY_EVENTS.memberDeactivated, payload));
    }
    expect(endSessionsOf).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(4);
    expect(warn).toHaveBeenLastCalledWith('identity event dropped: payload carries no staffId', {
      event: IDENTITY_EVENTS.memberDeactivated,
    });
  });

  it('a failing handler is contained: publish resolves and the failure is recorded', async () => {
    const failure = new Error('redis is down (spec)');
    const { bus } = build({ endSessionsOf: () => Promise.reject(failure) });
    await expect(
      bus.publish(new IdentityEvent(IDENTITY_EVENTS.memberDeactivated, { staffId: STAFF_ID })),
    ).resolves.toBeUndefined();
    expect(bus.handlerFailures).toEqual([
      { eventName: IDENTITY_EVENTS.memberDeactivated, error: failure },
    ]);
  });
});
