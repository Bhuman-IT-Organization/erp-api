import { DomainEvent } from '../../../shared/events/domain-event.js';

export interface TodoEventPayload {
  readonly id: number;
  readonly staffId: number;
  /** ISO timestamp. */
  readonly at: string;
}

export class TodoCreatedV1 extends DomainEvent<'todo.record.created', TodoEventPayload> {
  static readonly NAME = 'todo.record.created' as const;
  readonly name = TodoCreatedV1.NAME;
}

/** Fired by an edit AND by finishing or reopening a to do. */
export class TodoUpdatedV1 extends DomainEvent<'todo.record.updated', TodoEventPayload> {
  static readonly NAME = 'todo.record.updated' as const;
  readonly name = TodoUpdatedV1.NAME;
}

export class TodoDeletedV1 extends DomainEvent<'todo.record.deleted', TodoEventPayload> {
  static readonly NAME = 'todo.record.deleted' as const;
  readonly name = TodoDeletedV1.NAME;
}

export const TODO_PUBLISHED_EVENTS = [TodoCreatedV1, TodoUpdatedV1, TodoDeletedV1] as const;
