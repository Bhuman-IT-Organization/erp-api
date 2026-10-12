/**
 * The two ports domain events travel through (ADR-0029): modules inject `DOMAIN_EVENT_PUBLISHER` and
 * call `publish`, and a module that reacts to another module's event injects
 * `DOMAIN_EVENT_SUBSCRIBER` and registers a handler from its own `events/handlers/`. Neither side
 * imports a concrete publisher, and neither knows the other module.
 *
 * The transactional outbox rebinds both tokens when
 * delivery must leave the process. Until then delivery is in-process and synchronous-after-commit:
 * the publisher is called **outside** the transaction, so a handler cannot roll a write back, and a
 * handler that throws is logged and contained — a notification's subscriber must not fail the
 * request that made the change (the audit row is the record, ADR-0034 d.3).
 *
 * `v1/auth` is the first subscriber (plan 03.1-11): `identity.member.passwordChanged`,
 * `identity.member.deactivated` and `identity.permissions.replaced`.
 */
import { Injectable } from '@nestjs/common';
import { LoggerService } from '../logger/logger.service.js';
import type { DomainEvent } from './domain-event.js';

export interface DomainEventPublisher {
  publish(event: DomainEvent): Promise<void>;
}

export const DOMAIN_EVENT_PUBLISHER = Symbol('DOMAIN_EVENT_PUBLISHER');

/** One handler of one event name; it receives the event, never the transaction. */
export type DomainEventHandler = (event: DomainEvent) => Promise<void>;

/**
 * The port a subscribing module registers a handler on. `subscribe` is idempotent per (name,
 * handler) pair only in the sense that the caller registers once, from `onModuleInit`.
 */
export interface DomainEventSubscriber {
  subscribe(eventName: string, handler: DomainEventHandler): void;
}

export const DOMAIN_EVENT_SUBSCRIBER = Symbol('DOMAIN_EVENT_SUBSCRIBER');

/**
 * Fans each published event out to the handlers registered for its name and, **in specs only**,
 * keeps the events in memory in order. `drain()` returns and clears the recording; the fan-out is
 * unaffected by it.
 *
 * A handler's rejection is **contained**: `publish` awaits every handler and logs each failure with
 * the event name and the error — never the payload — rather than propagating (review WR-05). A
 * subscriber is a notification's reader and must never turn a committed change into a 500, but a
 * failed session revocation must not be silent either.
 *
 * `record` is `true` for `new RecordingDomainEventPublisher()` (what every spec builds) and `false`
 * in `EventsModule`, the binding the application boots with: a production process retains no event
 * and no failure (review IN-07), so `drain()`, `count` and `handlerFailures` stay empty there.
 */
@Injectable()
export class RecordingDomainEventPublisher implements DomainEventPublisher, DomainEventSubscriber {
  private events: DomainEvent[] = [];
  private readonly handlers = new Map<string, DomainEventHandler[]>();
  /** Every handler rejection since construction when recording: `{ eventName, error }`, oldest first. */
  readonly handlerFailures: { eventName: string; error: unknown }[] = [];

  constructor(
    private readonly logger: LoggerService = new LoggerService(),
    private readonly record = true,
  ) {}

  subscribe(eventName: string, handler: DomainEventHandler): void {
    const existing = this.handlers.get(eventName);
    if (existing === undefined) this.handlers.set(eventName, [handler]);
    else existing.push(handler);
  }

  async publish(event: DomainEvent): Promise<void> {
    if (this.record) this.events.push(event);
    for (const handler of this.handlers.get(event.name) ?? []) {
      try {
        await handler(event);
      } catch (error: unknown) {
        this.logger.error('domain event handler failed', { event: event.name, error });
        if (this.record) this.handlerFailures.push({ eventName: event.name, error });
      }
    }
  }

  /** Events published since the last drain, oldest first; empties the buffer. */
  drain(): DomainEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  get count(): number {
    return this.events.length;
  }
}
