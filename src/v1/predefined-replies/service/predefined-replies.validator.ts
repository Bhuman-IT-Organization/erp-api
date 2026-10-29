import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS, parseListQuery } from '../../../shared/http/pagination.js';
import {
  createPredefinedReplyBodySchema,
  exportPredefinedRepliesQuerySchema,
  listPredefinedRepliesQuerySchema,
  PREDEFINED_REPLIES_SEARCH_MAX,
  predefinedReplyParamsSchema,
  updatePredefinedReplyBodySchema,
  type CreatePredefinedReplyBody,
  type PredefinedReplyParams,
  type UpdatePredefinedReplyBody,
} from '../dto/predefined-replies.dto.js';
import type {
  PredefinedRepliesListRequest,
  PredefinedRepliesSortField,
} from '../model/predefined-replies.model.js';

export const PREDEFINED_REPLIES_SORT_FIELDS = [
  'name',
  'id',
] as const satisfies readonly PredefinedRepliesSortField[];

const SORT_KINDS = { name: 'string', id: 'number' } as const satisfies Record<
  PredefinedRepliesSortField,
  'number' | 'string'
>;

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

  if (search !== null && search.length > PREDEFINED_REPLIES_SEARCH_MAX) {
    refuse(
      'Query is invalid',
      ['q'],
      `q must be at most ${String(PREDEFINED_REPLIES_SEARCH_MAX)} characters`,
    );
  }

  return search === '' ? null : search;
}

@Injectable()
export class PredefinedRepliesValidator {
  parseListQuery(input: unknown): PredefinedRepliesListRequest {
    parse(listPredefinedRepliesQuerySchema, input, 'Query is invalid');

    const query = parseListQuery(input, PREDEFINED_REPLIES_SORT_FIELDS);

    if (query.filters.length > 0) {
      refuse('Query is invalid', ['filter'], 'this list takes no filter');
    }

    const [first, ...rest] = query.sort;

    if (rest.length > 0) {
      refuse('Query is invalid', ['sort'], 'the list sorts on one field at a time');
    }

    const sortField = first?.field ?? PREDEFINED_REPLIES_SORT_FIELDS[0];
    const sortDirection = first === undefined ? 'desc' : first.direction;
    const cursor = decodeCursor(query.cursor, sortField);

    if (cursor !== null && typeof cursor.key[0] !== SORT_KINDS[sortField]) {
      refuse('Query is invalid', ['cursor'], 'cursor is not a cursor of this list');
    }

    return {
      search: parseSearch(input),
      sortField,
      order: sortDirection,
      cursor,
      limit: query.limit,
    };
  }

  parseExportList(input: unknown): PredefinedRepliesListRequest {
    parse(exportPredefinedRepliesQuerySchema, input, 'Query is invalid');
    return { ...this.parseListQuery(input), cursor: null, limit: LIST_QUERY_LIMITS.max };
  }

  parseParams(input: unknown): PredefinedReplyParams {
    return parse(predefinedReplyParamsSchema, input, 'Path parameter is invalid');
  }

  parseCreateBody(input: unknown): CreatePredefinedReplyBody {
    return parse(createPredefinedReplyBodySchema, input, 'Request body is invalid');
  }

  parseUpdateBody(input: unknown): UpdatePredefinedReplyBody {
    const body = parse(updatePredefinedReplyBodySchema, input, 'Request body is invalid');

    if (Object.keys(body).length === 0) {
      refuse('Request body is invalid', [], 'send at least one field');
    }

    return body;
  }
}
