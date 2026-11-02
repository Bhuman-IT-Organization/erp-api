/**
 * Domain events this module publishes (ADR-0029). Past-tense typed classes extending
 * `DomainEvent`, ids not entities, versioned, each with a `static readonly NAME` that the README's
 * "Events published" table lists. Published through `DOMAIN_EVENT_PUBLISHER` from
 * `service/announcements.transport.ts` after the write. A payload carries the announcement's id and
 * the server time of the change, never its name or message.
 */
import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface AnnouncementsEventPayload {
  readonly id: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class AnnouncementsCreatedV1 extends DomainEvent<
  'announcements.record.created',
  AnnouncementsEventPayload
> {
  static readonly NAME = 'announcements.record.created' as const;
  readonly name = AnnouncementsCreatedV1.NAME;
}

export class AnnouncementsUpdatedV1 extends DomainEvent<
  'announcements.record.updated',
  AnnouncementsEventPayload
> {
  static readonly NAME = 'announcements.record.updated' as const;
  readonly name = AnnouncementsUpdatedV1.NAME;
}

export class AnnouncementsDeletedV1 extends DomainEvent<
  'announcements.record.deleted',
  AnnouncementsEventPayload
> {
  static readonly NAME = 'announcements.record.deleted' as const;
  readonly name = AnnouncementsDeletedV1.NAME;
}

export const ANNOUNCEMENTS_PUBLISHED_EVENTS = [
  AnnouncementsCreatedV1,
  AnnouncementsUpdatedV1,
  AnnouncementsDeletedV1,
] as const;
