/**
 * Versioned domain events published by the predefined-replies module.
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface PredefinedReplyEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class PredefinedReplyCreatedV1 extends DomainEvent<
  'predefined-reply.record.created',
  PredefinedReplyEventPayload
> {
  static readonly NAME = 'predefined-reply.record.created' as const;
  readonly name = PredefinedReplyCreatedV1.NAME;
}

export class PredefinedReplyUpdatedV1 extends DomainEvent<
  'predefined-reply.record.updated',
  PredefinedReplyEventPayload
> {
  static readonly NAME = 'predefined-reply.record.updated' as const;
  readonly name = PredefinedReplyUpdatedV1.NAME;
}

export const PREDEFINED_REPLY_PUBLISHED_EVENTS = [
  PredefinedReplyCreatedV1,
  PredefinedReplyUpdatedV1,
] as const;
