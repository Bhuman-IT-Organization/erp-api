import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface PredefinedRepliesEventPayload {
  readonly id: number;
}

export class PredefinedRepliesCreatedV1 extends DomainEvent<
  'predefined-replies.record.created',
  PredefinedRepliesEventPayload
> {
  static readonly NAME = 'predefined-replies.record.created' as const;
  readonly name = PredefinedRepliesCreatedV1.NAME;
}

export class PredefinedRepliesUpdatedV1 extends DomainEvent<
  'predefined-replies.record.updated',
  PredefinedRepliesEventPayload
> {
  static readonly NAME = 'predefined-replies.record.updated' as const;
  readonly name = PredefinedRepliesUpdatedV1.NAME;
}

export class PredefinedRepliesDeletedV1 extends DomainEvent<
  'predefined-replies.record.deleted',
  PredefinedRepliesEventPayload
> {
  static readonly NAME = 'predefined-replies.record.deleted' as const;
  readonly name = PredefinedRepliesDeletedV1.NAME;
}

export const PREDEFINED_REPLIES_PUBLISHED_EVENTS = [
  PredefinedRepliesCreatedV1,
  PredefinedRepliesUpdatedV1,
  PredefinedRepliesDeletedV1,
] as const;
