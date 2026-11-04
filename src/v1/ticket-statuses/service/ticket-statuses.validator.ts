import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS, parseListQuery } from '../../../shared/http/pagination.js';
import {
  TICKET_STATUSES_SEARCH_MAX,
  ticketStatusesListQuerySchema,
  exportTicketStatusesQuerySchema,
  ticketStatusesParamsSchema,
  createTicketStatusBodySchema,
  updateTicketStatusBodySchema,
  type ExportTicketStatusesQuery,
  type TicketStatusesParams,
  type CreateTicketStatusBody,
  type UpdateTicketStatusBody,
} from '../dto/ticket-statuses.dto.js';
import type {
  TicketStatusesListRequest,
  TicketStatusesSortField,
} from '../model/ticket-statuses.model.js';

export const TICKET_STATUSES_SORT_FIELDS = [
  'id',
  'name',
] as const satisfies readonly TicketStatusesSortField[];

const DEFAULT_SORT = { field: 'id', direction: 'desc' } as const;

const SORT_KINDS = {
  id: 'number',
  name: 'string',
} as const satisfies Record<TicketStatusesSortField, 'number' | 'string'>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function refuse(detail: string, path: readonly (string | number)[], message: string): never {
  throw new AppError('ERP-VALIDATION-0001', detail, {
    issues: [{ path: [...path], message }],
  });
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
  if (!parsed.success) {
    throw new AppError('ERP-VALIDATION-0001', detail, {
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

function parseSearch(input: unknown): string | null {
  const search = scalar(isRecord(input) ? input.q : undefined);

  if (search !== null && search.length > TICKET_STATUSES_SEARCH_MAX) {
    refuse(
      'Query is invalid',
      ['q'],
      `q must be at most ${String(TICKET_STATUSES_SEARCH_MAX)} characters`,
    );
  }

  return search === '' ? null : search;
}

function rejectUnknownQueryKeys(input: unknown): void {
  if (!isRecord(input)) return;
  for (const key of Object.keys(input)) {
    if (!['limit', 'cursor', 'q', 'sort'].includes(key) && !key.startsWith('filter')) {
      refuse('Query is invalid', [key], `unknown query key "${key}"`);
    }
  }
}

@Injectable()
export class TicketStatusesValidator {
  parseListQuery(input: unknown): TicketStatusesListRequest {
    rejectUnknownQueryKeys(input);
    parse(ticketStatusesListQuerySchema, input, 'Query is invalid');

    const query = parseListQuery(input, TICKET_STATUSES_SORT_FIELDS);

    if (query.filters.length > 0) {
      refuse('Query is invalid', ['filter'], 'this list takes no filter');
    }

    const [first, ...rest] = query.sort;

    if (rest.length > 0) {
      refuse('Query is invalid', ['sort'], 'the list sorts on one field at a time');
    }

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

  parseExportQuery(input: unknown): ExportTicketStatusesQuery {
    return parse(exportTicketStatusesQuerySchema, input, 'Query is invalid');
  }

  parseExportList(input: unknown): TicketStatusesListRequest {
    const query = this.parseExportQuery(input);
    return {
      ...this.parseListQuery({ q: query.q, sort: query.sort }),
      cursor: null,
      limit: LIST_QUERY_LIMITS.max,
    };
  }

  parseParams(input: unknown): TicketStatusesParams {
    return parse(ticketStatusesParamsSchema, input, 'Path parameter is invalid');
  }

  parseCreateBody(input: unknown): CreateTicketStatusBody {
    return parse(createTicketStatusBodySchema, input, 'Request body is invalid');
  }

  parseUpdateBody(input: unknown): UpdateTicketStatusBody {
    return parse(updateTicketStatusBodySchema, input, 'Request body is invalid');
  }
}
