import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS, parseListQuery } from '../../../shared/http/pagination.js';
import {
  ESTIMATE_REQUEST_STATUSES_SEARCH_MAX,
  createEstimateRequestStatusBodySchema,
  estimateRequestStatusesParamsSchema,
  exportEstimateRequestStatusesQuerySchema,
  updateEstimateRequestStatusBodySchema,
  type CreateEstimateRequestStatusBody,
  type EstimateRequestStatusesParams,
  type ExportEstimateRequestStatusesQuery,
  type UpdateEstimateRequestStatusBody,
} from '../dto/estimate-request-statuses.dto.js';
import type {
  EstimateRequestStatusesListRequest,
  EstimateRequestStatusSortField,
} from '../model/estimate-request-statuses.model.js';

export const ESTIMATE_REQUEST_STATUSES_SORT_FIELDS = [
  'id',
  'name',
] as const satisfies readonly EstimateRequestStatusSortField[];

const DEFAULT_SORT = { field: 'name', direction: 'asc' } as const;
const SORT_KINDS = { id: 'number', name: 'string' } as const satisfies Record<
  EstimateRequestStatusSortField,
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

function rejectUnknownQueryKeys(input: unknown): void {
  if (!isRecord(input)) return;
  for (const key of Object.keys(input)) {
    if (!['limit', 'cursor', 'q', 'sort', 'filter'].includes(key) && !key.startsWith('filter[')) {
      refuse('Query is invalid', [key], `unknown query key "${key}"`);
    }
  }
}

function parse<T>(schema: z.ZodType<T>, input: unknown, detail: string): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError('ERP-VALIDATION-0001', detail, { issues: parsed.error.issues });
  }
  return parsed.data;
}

@Injectable()
export class EstimateRequestStatusesValidator {
  parseListQuery(input: unknown): EstimateRequestStatusesListRequest {
    rejectUnknownQueryKeys(input);
    const query = parseListQuery(input, ESTIMATE_REQUEST_STATUSES_SORT_FIELDS);
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
    const search = scalar(isRecord(input) ? input.q : undefined);
    if (search !== null && search.length > ESTIMATE_REQUEST_STATUSES_SEARCH_MAX) {
      refuse(
        'Query is invalid',
        ['q'],
        `q must be at most ${String(ESTIMATE_REQUEST_STATUSES_SEARCH_MAX)} characters`,
      );
    }
    return {
      search: search === '' ? null : search,
      sortField: sort.field,
      order: sort.direction,
      cursor,
      limit: query.limit,
    };
  }

  parseExportQuery(input: unknown): ExportEstimateRequestStatusesQuery {
    return parse(exportEstimateRequestStatusesQuerySchema, input, 'Query is invalid');
  }

  parseExportList(input: unknown): EstimateRequestStatusesListRequest {
    const query = this.parseExportQuery(input);
    return {
      ...this.parseListQuery({ q: query.q, sort: query.sort }),
      cursor: null,
      limit: LIST_QUERY_LIMITS.max,
    };
  }

  parseParams(input: unknown): EstimateRequestStatusesParams {
    return parse(estimateRequestStatusesParamsSchema, input, 'Path parameter is invalid');
  }

  parseCreateBody(input: unknown): CreateEstimateRequestStatusBody {
    return parse(createEstimateRequestStatusBodySchema, input, 'Request body is invalid');
  }

  parseUpdateBody(input: unknown): UpdateEstimateRequestStatusBody {
    return parse(updateEstimateRequestStatusBodySchema, input, 'Request body is invalid');
  }
}
