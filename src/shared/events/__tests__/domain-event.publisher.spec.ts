import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';
import { LoggerModule } from '../../logger/logger.module.js';
import { LoggerService } from '../../logger/logger.service.js';
import { DomainEvent } from '../domain-event.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  DOMAIN_EVENT_SUBSCRIBER,
  type DomainEventSubscriber,
  RecordingDomainEventPublisher,
} from '../domain-event.publisher.js';
import { EventsModule } from '../events.module.js';

class ThingHappenedV1 extends DomainEvent<'test.thing.happened', { id: number }> {
  readonly name = 'test.thing.happened' as const;
}

describe('RecordingDomainEventPublisher', () => {
  it('records published events in order and drain() returns then empties them', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const first = new ThingHappenedV1({ id: 1 });
    const second = new ThingHappenedV1({ id: 2 });
    await publisher.publish(first);
    await publisher.publish(second);
    expect(publisher.count).toBe(2);

    const drained = publisher.drain();
    expect(drained).toEqual([first, second]);
    expect(publisher.count).toBe(0);
    expect(publisher.drain()).toEqual([]);
  });

  it('a domain event carries name, version 1, an ISO occurredAt and the payload', () => {
    const event = new ThingHappenedV1({ id: 7 });
    expect(event.name).toBe('test.thing.happened');
    expect(event.version).toBe(1);
    expect(Number.isNaN(Date.parse(event.occurredAt))).toBe(false);
    expect(event.payload).toEqual({ id: 7 });
  });
});

/**
 * The subscriber half of the port (plan 03.1-11): in-process fan-out, so `v1/auth` can react to
 * `v1/identity`'s events without importing the module. Delivery is synchronous-after-commit — the
 * publisher is called outside the transaction — and a handler's rejection is contained.
 */
describe('RecordingDomainEventPublisher as DomainEventSubscriber', () => {
  it('fans an event out to every handler registered for its name, in registration order', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const seen: string[] = [];
    publisher.subscribe('test.thing.happened', () => {
      seen.push('first');
      return Promise.resolve();
    });
    publisher.subscribe('test.thing.happened', () => {
      seen.push('second');
      return Promise.resolve();
    });
    await publisher.publish(new ThingHappenedV1({ id: 1 }));
    expect(seen).toEqual(['first', 'second']);
    // Recording and fan-out are independent.
    expect(publisher.count).toBe(1);
  });

  it('delivers nothing to a handler registered for another name', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const other = vi.fn(() => Promise.resolve());
    publisher.subscribe('test.other.happened', other);
    await publisher.publish(new ThingHappenedV1({ id: 1 }));
    expect(other).not.toHaveBeenCalled();
  });

  it('contains a handler rejection: publish resolves and the failure is recorded', async () => {
    const publisher = new RecordingDomainEventPublisher();
    const failure = new Error('subscriber failed (spec)');
    const after = vi.fn(() => Promise.resolve());
    publisher.subscribe('test.thing.happened', () => Promise.reject(failure));
    publisher.subscribe('test.thing.happened', after);
    await expect(publisher.publish(new ThingHappenedV1({ id: 1 }))).resolves.toBeUndefined();
    expect(publisher.handlerFailures).toEqual([
      { eventName: 'test.thing.happened', error: failure },
    ]);
    // The second handler still runs: one subscriber's outage is not another's.
    expect(after).toHaveBeenCalledTimes(1);
  });

  /**
   * Quick task 260925-rvw (review WR-05). A contained failure is still a failure somebody must see:
   * a session revocation that did not happen is silent otherwise. The line names the event and the
   * error and never the payload (it may carry ids an operator should correlate by request id, not
   * read from a log line).
   */
  it('logs a contained handler rejection with the event name and the error, never the payload (WR-05)', async () => {
    const logger = new LoggerService();
    const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
    const publisher = new RecordingDomainEventPublisher(logger);
    const failure = new Error('redis timed out (spec)');
    publisher.subscribe('test.thing.happened', () => Promise.reject(failure));
    await expect(publisher.publish(new ThingHappenedV1({ id: 4242 }))).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith('domain event handler failed', {
      event: 'test.thing.happened',
      error: failure,
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('4242');
  });
});

/**
 * Quick task 260925-rvw (review IN-07). The binding the application boots with records nothing:
 * `drain()`, `count` and `handlerFailures` exist for specs, and a production process must not grow
 * its heap with every login and identity change for the life of the process.
 */
describe('EventsModule (the production binding)', () => {
  it('retains no event and no failure, and still fans out and logs (IN-07)', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LoggerModule, EventsModule],
    }).compile();
    const publisher = moduleRef.get<RecordingDomainEventPublisher>(DOMAIN_EVENT_PUBLISHER);
    const subscriber = moduleRef.get<DomainEventSubscriber>(DOMAIN_EVENT_SUBSCRIBER);
    const error = vi
      .spyOn(moduleRef.get(LoggerService), 'error')
      .mockImplementation(() => undefined);
    const seen = vi.fn(() => Promise.reject(new Error('handler failed (spec)')));
    subscriber.subscribe('test.thing.happened', seen);

    await publisher.publish(new ThingHappenedV1({ id: 1 }));
    await publisher.publish(new ThingHappenedV1({ id: 2 }));

    expect(publisher.count).toBe(0);
    expect(publisher.drain()).toEqual([]);
    expect(publisher.handlerFailures).toEqual([]);
    expect(seen).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(2);
    await moduleRef.close();
  });
});
