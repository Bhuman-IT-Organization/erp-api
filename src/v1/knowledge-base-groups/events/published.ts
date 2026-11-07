import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface KnowledgeBaseGroupsEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class KnowledgeBaseGroupsCreatedV1 extends DomainEvent<
  'knowledge-base-groups.record.created',
  KnowledgeBaseGroupsEventPayload
> {
  static readonly NAME = 'knowledge-base-groups.record.created' as const;
  readonly name = KnowledgeBaseGroupsCreatedV1.NAME;
}

export class KnowledgeBaseGroupsUpdatedV1 extends DomainEvent<
  'knowledge-base-groups.record.updated',
  KnowledgeBaseGroupsEventPayload
> {
  static readonly NAME = 'knowledge-base-groups.record.updated' as const;
  readonly name = KnowledgeBaseGroupsUpdatedV1.NAME;
}

export class KnowledgeBaseGroupsDeletedV1 extends DomainEvent<
  'knowledge-base-groups.record.deleted',
  KnowledgeBaseGroupsEventPayload
> {
  static readonly NAME = 'knowledge-base-groups.record.deleted' as const;
  readonly name = KnowledgeBaseGroupsDeletedV1.NAME;
}

export const KNOWLEDGE_BASE_GROUPS_PUBLISHED_EVENTS = [
  KnowledgeBaseGroupsCreatedV1,
  KnowledgeBaseGroupsUpdatedV1,
  KnowledgeBaseGroupsDeletedV1,
] as const;
