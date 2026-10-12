/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes extending
 * `DomainEvent` (`shared/events/domain-event.js`), ids not entities, versioned, each with a
 * `static readonly NAME` that the README's "Events published" table lists (the module-shape spec
 * keeps the two in step). Published through `DOMAIN_EVENT_PUBLISHER` from
 * `service/expense-categories.transport.ts`; delivered in-process today and through the transactional
 * outbox once the first cross-module subscriber or job
 * exists. A payload carries the record's id and the server time of the change, never its fields
 * (neither the name nor the description), so an event can never leak the row's text (T-4.1-22).
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface ExpenseCategoriesEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class ExpenseCategoriesCreatedV1 extends DomainEvent<
  'expense-categories.record.created',
  ExpenseCategoriesEventPayload
> {
  static readonly NAME = 'expense-categories.record.created' as const;
  readonly name = ExpenseCategoriesCreatedV1.NAME;
}

export class ExpenseCategoriesUpdatedV1 extends DomainEvent<
  'expense-categories.record.updated',
  ExpenseCategoriesEventPayload
> {
  static readonly NAME = 'expense-categories.record.updated' as const;
  readonly name = ExpenseCategoriesUpdatedV1.NAME;
}

export class ExpenseCategoriesDeletedV1 extends DomainEvent<
  'expense-categories.record.deleted',
  ExpenseCategoriesEventPayload
> {
  static readonly NAME = 'expense-categories.record.deleted' as const;
  readonly name = ExpenseCategoriesDeletedV1.NAME;
}

export const EXPENSE_CATEGORIES_PUBLISHED_EVENTS = [
  ExpenseCategoriesCreatedV1,
  ExpenseCategoriesUpdatedV1,
  ExpenseCategoriesDeletedV1,
] as const;
