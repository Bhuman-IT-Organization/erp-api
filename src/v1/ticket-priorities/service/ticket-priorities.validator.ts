import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS, parseListQuery } from '../../../shared/http/pagination.js';

// validator.spec.ts, replace the import of the 4 schemas from the validator
import {
  createTicketPrioritiesBodySchema,
  updateTicketPrioritiesBodySchema,
  ticketPrioritiesParamsSchema,
  type UpdateTicketPrioritiesBody,
  type CreateTicketPrioritiesBody,
  type TicketPrioritiesParams,
  TICKET_PRIORITIES_SEARCH_MAX, // only if the dto exports it
} from '../dto/ticket-priorities.dto.js';
import type {
  TicketPrioritiesListRequest,
  TicketPrioritiesSortField,
} from '../model/ticket-priority.model.js';

export const TICKET_PRIORITIES_SORT_FIELDS = [
  'id',
  'name',
] as const satisfies readonly TicketPrioritiesSortField[];

const DEFAULT_SORT = { field: 'id', direction: 'desc' } as const;

const SORT_KINDS = { id: 'number', name: 'string' } as const satisfies Record<
  TicketPrioritiesSortField,
  'number' | 'string'
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuse(detail: string, path: readonly (string | number)[], message: string): never {
  throw new AppError('ERP-VALIDATION-0001', detail, { issues: [{ path: [...path], message }] });
}

function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const last: unknown = value.at(-1);
    return typeof last === 'string' ? last : null;
  }
  return null;
}

function parse<T>(schema: z.ZodType<T>, input: unknown, detail: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success)
    throw new AppError('ERP-VALIDATION-0001', detail, { issues: parsed.error.issues });
  return parsed.data;
}

function parseSearch(input: unknown): string | null {
  const search = scalar(isRecord(input) ? input.q : undefined);
  if (search !== null && search.length > TICKET_PRIORITIES_SEARCH_MAX) {
    refuse(
      'Query is invalid',
      ['q'],
      `q must be at most ${String(TICKET_PRIORITIES_SEARCH_MAX)} characters`,
    );
  }
  return search === '' ? null : search;
}

@Injectable()
export class TicketPrioritiesValidator {
  parseListQuery(input: unknown): TicketPrioritiesListRequest {
    const query = parseListQuery(input, TICKET_PRIORITIES_SORT_FIELDS);
    if (query.filters.length > 0)
      refuse('Query is invalid', ['filter'], 'this list takes no filter');
    const [first, ...rest] = query.sort;
    if (rest.length > 0)
      refuse('Query is invalid', ['sort'], 'the list sorts on one field at a time');
    const sort = first ?? DEFAULT_SORT;
    const cursor = decodeCursor(query.cursor, sort.field);
    if (cursor !== null && typeof cursor.key[0] !== SORT_KINDS[sort.field]) {
      refuse('Query is invalid', ['cursor'], 'cursor is not a cursor of this list');
    }
    return {
      search: parseSearch(input),
      sortField: sort.field,
      order: sort.direction,
      cursor,
      limit: query.limit,
    };
  }

  parseParams(input: unknown): TicketPrioritiesParams {
    return parse(ticketPrioritiesParamsSchema, input, 'Path parameter is invalid');
  }

  parseCreateBody(input: unknown): CreateTicketPrioritiesBody {
    return parse(createTicketPrioritiesBodySchema, input, 'Request body is invalid');
  }

  parseUpdateBody(input: unknown): UpdateTicketPrioritiesBody {
    return parse(updateTicketPrioritiesBodySchema, input, 'Request body is invalid');
  }

  /** `GET export`: the list's query (`q`, one sort), read from the first row in batches. */
  parseExportList(input: unknown): TicketPrioritiesListRequest {
    return { ...this.parseListQuery(input), cursor: null, limit: LIST_QUERY_LIMITS.max };
  }
}
