import type { DecodedCursor } from '../../../shared/http/keyset.js';

export const TICKET_PRIORITIES_FACADE_MAX_ROWS = 1000;

export type TicketPrioritiesSortField = 'id' | 'name';

/** The model other modules see, and the shape of a stored row. */
export interface TicketPriority {
  readonly id: number;
  readonly name: string;
}

export interface NewTicketPriority {
  readonly name: string;
}

export interface TicketPrioritiesListRequest {
  readonly search: string | null;
  readonly sortField: TicketPrioritiesSortField;
  readonly order: 'asc' | 'desc';
  readonly cursor: DecodedCursor<TicketPrioritiesSortField> | null;
  readonly limit: number;
}

export interface TicketPrioritiesPage {
  readonly items: TicketPriority[];
  readonly nextCursor: string | null;
  readonly prevCursor: string | null;
  readonly total: number;
  readonly rangeStart: number;
}
