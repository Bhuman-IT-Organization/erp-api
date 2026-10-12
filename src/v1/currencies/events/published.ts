/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes extending
 * `DomainEvent` (`shared/events/domain-event.js`), ids not entities, versioned, each with a
 * `static readonly NAME` that the README's "Events published" table lists (the module-shape spec
 * keeps the two in step). Published through `DOMAIN_EVENT_PUBLISHER` from
 * `service/currencies.transport.ts` after the write; delivered in-process today and through the
 * transactional outbox once delivery beyond this process
 * is needed. A payload carries the currency's id and the server time of the change, never its code,
 * its symbol or a count (T-4.1-156). `baseChanged` also carries the previous base's id (`null` when
 * none was set); branding drops its memo on it and on `updated` (D-44, Currencies planning answer 6).
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface CurrenciesEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class CurrenciesCreatedV1 extends DomainEvent<
  'currencies.record.created',
  CurrenciesEventPayload
> {
  static readonly NAME = 'currencies.record.created' as const;
  readonly name = CurrenciesCreatedV1.NAME;
}

export class CurrenciesUpdatedV1 extends DomainEvent<
  'currencies.record.updated',
  CurrenciesEventPayload
> {
  static readonly NAME = 'currencies.record.updated' as const;
  readonly name = CurrenciesUpdatedV1.NAME;
}

export interface CurrenciesBaseChangedPayload extends CurrenciesEventPayload {
  /** The base before the change; `null` when no row was the base. */
  readonly previousId: number | null;
}

export class CurrenciesBaseChangedV1 extends DomainEvent<
  'currencies.record.baseChanged',
  CurrenciesBaseChangedPayload
> {
  static readonly NAME = 'currencies.record.baseChanged' as const;
  readonly name = CurrenciesBaseChangedV1.NAME;
}

export class CurrenciesDeletedV1 extends DomainEvent<
  'currencies.record.deleted',
  CurrenciesEventPayload
> {
  static readonly NAME = 'currencies.record.deleted' as const;
  readonly name = CurrenciesDeletedV1.NAME;
}

export const CURRENCIES_PUBLISHED_EVENTS = [
  CurrenciesCreatedV1,
  CurrenciesUpdatedV1,
  CurrenciesBaseChangedV1,
  CurrenciesDeletedV1,
] as const;
