import { Global, Module } from '@nestjs/common';
import { LoggerService } from '../logger/logger.service.js';
import {
  DOMAIN_EVENT_PUBLISHER,
  DOMAIN_EVENT_SUBSCRIBER,
  RecordingDomainEventPublisher,
} from './domain-event.publisher.js';

/**
 * Provides the domain-event publisher and subscriber ports everywhere. Wave 0 bound the publisher to
 * the in-process recording publisher; plan 03.1-11 added the subscriber token so `v1/auth` can react
 * to `v1/identity`'s events without importing the module. **One instance under both tokens**
 * (`useExisting`, the `ACCESS_TOKEN_VERIFIER` shape) — a second instance would register handlers on a
 * bus nothing publishes to. The outbox phase rebinds both (ADR-0029).
 *
 * Built by a factory so the application's instance **records nothing** (`record: false`, review
 * IN-07) and logs through the global `LoggerService` (review WR-05); a spec's
 * `new RecordingDomainEventPublisher()` still records.
 */
@Global()
@Module({
  providers: [
    {
      provide: RecordingDomainEventPublisher,
      // Optional: a spec app that boots EventsModule without LoggerModule gets the default logger.
      useFactory: (logger?: LoggerService) => new RecordingDomainEventPublisher(logger, false),
      inject: [{ token: LoggerService, optional: true }],
    },
    { provide: DOMAIN_EVENT_PUBLISHER, useExisting: RecordingDomainEventPublisher },
    { provide: DOMAIN_EVENT_SUBSCRIBER, useExisting: RecordingDomainEventPublisher },
  ],
  exports: [DOMAIN_EVENT_PUBLISHER, DOMAIN_EVENT_SUBSCRIBER],
})
export class EventsModule {}
