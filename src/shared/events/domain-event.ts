/**
 * Base class of every domain event (ADR-0029). A module declares past-tense, versioned classes
 * extending it in `events/published.ts`; the payload carries ids and labels only — never an
 * entity, never an e-mail, never a hash or a token. `occurredAt` is fixed at construction.
 */
export abstract class DomainEvent<TName extends string = string, TPayload = unknown> {
  abstract readonly name: TName;
  readonly version = 1;
  readonly occurredAt: string = new Date().toISOString();

  constructor(readonly payload: TPayload) {}
}
