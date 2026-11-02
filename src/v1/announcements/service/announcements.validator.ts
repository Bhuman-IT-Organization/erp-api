/**
 * Validator: the request parsing (BE-09: an expected failure is an `AppError` the shared filter
 * maps to problem details; nothing here throws a Nest exception).
 *
 * The list is parsed by `shared/http/pagination.ts`'s `parseListQuery` (BE-19), then this file adds
 * what a keyset list needs: ONE sort segment (default `-dateadded`), the opaque cursor decoded for
 * that sort with the right kind of value, and `?q=` bounded. This list takes no filter.
 */
import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import { LIST_QUERY_LIMITS, parseListQuery } from '../../../shared/http/pagination.js';
import {
  ANNOUNCEMENTS_SEARCH_MAX,
  createAnnouncementsBodySchema,
  announcementsParamsSchema,
  updateAnnouncementsBodySchema,
  type CreateAnnouncementsBody,
  type AnnouncementsParams,
  type UpdateAnnouncementsBody,
} from '../dto/announcements.dto.js';
import type {
  AnnouncementsListRequest,
  AnnouncementsSortField,
} from '../model/announcements.model.js';

/** The columns `?sort=` accepts. With no `sort`, the list reads `dateadded` descending (Perfex's order). */
export const ANNOUNCEMENTS_SORT_FIELDS = [
  'name',
  'dateadded',
] as const satisfies readonly AnnouncementsSortField[];

const DEFAULT_SORT = { field: 'dateadded', direction: 'desc' } as const;

/** The kind of value each sort column's cursor must carry: a decoded cursor is checked, not trusted. */
const SORT_KINDS = { name: 'string', dateadded: 'number' } as const satisfies Record<
  AnnouncementsSortField,
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

/** `?q=`: the last value, at most `ANNOUNCEMENTS_SEARCH_MAX` characters; an empty one is no search. */
function parseSearch(input: unknown): string | null {
  const search = scalar(isRecord(input) ? input.q : undefined);
  if (search !== null && search.length > ANNOUNCEMENTS_SEARCH_MAX) {
    refuse(
      'Query is invalid',
      ['q'],
      `q must be at most ${String(ANNOUNCEMENTS_SEARCH_MAX)} characters`,
    );
  }
  return search === '' ? null : search;
}

@Injectable()
export class AnnouncementsValidator {
  /** `GET` list: BE-19's grammar, one keyset sort (default `-dateadded`), the cursor bound to it, `q`. */
  parseListQuery(input: unknown): AnnouncementsListRequest {
    const query = parseListQuery(input, ANNOUNCEMENTS_SORT_FIELDS);
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

  /**
   * `GET export`: the list's query (`q`, one sort), read from the first row in batches of the list
   * maximum. The export parameters and the refusal of `limit` and `cursor` are the shared core's
   * (`parseExportOptions`, `shared/http/export.ts`), which the service runs first.
   */
  parseExportList(input: unknown): AnnouncementsListRequest {
    return { ...this.parseListQuery(input), cursor: null, limit: LIST_QUERY_LIMITS.max };
  }

  /** `:id`: a non-numeric or non-positive id is a 400, never a 404 probe. */
  parseParams(input: unknown): AnnouncementsParams {
    return parse(announcementsParamsSchema, input, 'Path parameter is invalid');
  }

  /** `POST`: strict, the four saved fields; trimmed name 1 to 191, trimmed message at most the maximum. */
  parseCreateBody(input: unknown): CreateAnnouncementsBody {
    return parse(createAnnouncementsBodySchema, input, 'Request body is invalid');
  }

  /** `PATCH :id`: the same body; `{}` is a 400 on `['name']`. */
  parseUpdateBody(input: unknown): UpdateAnnouncementsBody {
    return parse(updateAnnouncementsBodySchema, input, 'Request body is invalid');
  }
}
