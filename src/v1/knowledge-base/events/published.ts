/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes extending
 * `DomainEvent` (`shared/events/domain-event.js`), ids not entities, versioned, each with a
 * `static readonly NAME` that the README's "Events published" table lists (the module-shape spec
 * keeps the two in step). Published through `DOMAIN_EVENT_PUBLISHER` from
 * `service/knowledge-base.transport.ts` after the write; delivered in-process today and through the
 * transactional outbox once the first cross-module
 * subscriber or job needs it. A payload carries the knowledge base's id and the server time of the
 * change, never its name (T-4.1-89).
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface KnowledgeBaseEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class KnowledgeBaseCreatedV1 extends DomainEvent<
  'knowledge-base.record.created',
  KnowledgeBaseEventPayload
> {
  static readonly NAME = 'knowledge-base.record.created' as const;
  readonly name = KnowledgeBaseCreatedV1.NAME;
}

export class KnowledgeBaseUpdatedV1 extends DomainEvent<
  'knowledge-base.record.updated',
  KnowledgeBaseEventPayload
> {
  static readonly NAME = 'knowledge-base.record.updated' as const;
  readonly name = KnowledgeBaseUpdatedV1.NAME;
}

export class KnowledgeBaseDeletedV1 extends DomainEvent<
  'knowledge-base.record.deleted',
  KnowledgeBaseEventPayload
> {
  static readonly NAME = 'knowledge-base.record.deleted' as const;
  readonly name = KnowledgeBaseDeletedV1.NAME;
}

export const KNOWLEDGE_BASE_PUBLISHED_EVENTS = [
  KnowledgeBaseCreatedV1,
  KnowledgeBaseUpdatedV1,
  KnowledgeBaseDeletedV1,
] as const;
