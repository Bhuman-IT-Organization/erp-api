/**
 * Validator: the zod request schemas and the business refusals (BE-09 — an expected failure is an
 * `AppError` the shared filter maps to problem details; nothing here throws a Nest exception).
 *
 * The list endpoints are parsed by `shared/http/pagination.ts`'s `parseListQuery` with this
 * module's allowed-field list (BE-19), not by a schema of their own: the allowlist is what stops a
 * caller probing a column the endpoint does not expose, and every refusal is the same
 * `ERP-VALIDATION-0001` a module validator produces.
 *
 * The refusals this file adds on top of the shared parser, because every list pages by keyset:
 * a `sort` on a field outside the list's keyset allowlist, more than one sort segment, and a cursor
 * that is not one of this list's. The member and role lists page on `(sortField, id)` with the
 * opaque cursor of `shared/http/keyset.ts`; the audit log still pages on its numeric row id, so its
 * cursor must be a decimal number.
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { decodeCursor } from '../../../shared/http/keyset.js';
import {
  LIST_QUERY_LIMITS,
  parseListQuery,
  type ListQuery,
  type ListSort,
} from '../../../shared/http/pagination.js';
import {
  createMemberBodySchema,
  createRoleBodySchema,
  memberParamsSchema,
  memberStatusBodySchema,
  roleParamsSchema,
  updateMemberBodySchema,
  updateRoleBodySchema,
  type CreateMemberBody,
  type CreateRoleBody,
  type MemberParams,
  type MemberStatusBody,
  type RoleParams,
  type UpdateMemberBody,
  type UpdateRoleBody,
} from '../dto/identity.dto.js';
import {
  AUDIT_LIST_FIELDS,
  MEMBER_LIST_FIELDS,
  ROLE_LIST_FIELDS,
  type AuditListField,
  type KeysetListRequest,
  type MemberListRequest,
  type MemberSortField,
  type RoleListRequest,
  type RoleSortField,
} from '../model/identity.model.js';

const NUMERIC_CURSOR = /^\d+$/;
const SEARCH_MAX_LENGTH = 100;

/**
 * The member columns `?sort=` accepts — every listed column that is a keyset key (NOT NULL, one
 * value per row). The first is the default. Not sortable (D-41): `roleName` (a join), `lastLogin`
 * (nullable) — and `roleId`, `isAdmin`, `lastName`, which are filters, not listed sort columns.
 */
export const MEMBER_SORT_FIELDS = [
  'staffId',
  'firstName',
  'email',
  'active',
] as const satisfies readonly MemberSortField[];

/** The role columns `?sort=` accepts; `memberCount` is an aggregate and does not sort (D-41). */
export const ROLE_SORT_FIELDS = ['roleId', 'name'] as const satisfies readonly RoleSortField[];

/** The one field the audit log can be keyset-ordered by; any other `sort` field is a 400. */
const AUDIT_SORT_FIELD = 'createdAt';

/**
 * The kind of value each sort column's cursor must carry. A cursor is decoded, not trusted: a
 * string value on an integer column would reach Prisma as a type error (a 500), so it is refused
 * here as the 400 every other bad cursor is. `active` is Perfex's tinyint, carried as `0`/`1`.
 */
const MEMBER_SORT_KINDS = {
  staffId: 'number',
  firstName: 'string',
  email: 'string',
  active: 'number',
} as const satisfies Record<MemberSortField, 'number' | 'string'>;
const ROLE_SORT_KINDS = { roleId: 'number', name: 'string' } as const satisfies Record<
  RoleSortField,
  'number' | 'string'
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readScalar(query: Record<string, unknown>, key: string): string | null {
  const value: unknown = query[key];
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    const last: unknown = value[value.length - 1];
    return typeof last === 'string' ? last : null;
  }
  return null;
}

function refuse(path: readonly string[], message: string): never {
  throw new AppError('ERP-VALIDATION-0001', 'Query is invalid', {
    issues: [{ path: [...path], message }],
  });
}

function isOneOf<T extends string>(allowed: readonly T[], value: string): value is T {
  return (allowed as readonly string[]).includes(value);
}

/**
 * The one sort a keyset list accepts: a single segment whose field is on `allowed`, or `fallback`
 * ascending when `?sort=` is absent. A compound sort is refused — the keyset is `(field, id)`.
 */
function keysetSort<TSort extends string>(
  sort: readonly ListSort<string>[],
  allowed: readonly TSort[],
  list: string,
): { sortField: TSort; order: 'asc' | 'desc' } {
  const [first, ...rest] = sort;
  if (rest.length > 0) refuse(['sort'], `the ${list} sorts on one field at a time`);
  if (first === undefined) {
    const [fallback] = allowed;
    if (fallback === undefined) return refuse(['sort'], `the ${list} has no sort field`);
    return { sortField: fallback, order: 'asc' };
  }
  if (!isOneOf(allowed, first.field)) {
    return refuse(['sort'], `the ${list} is keyset-ordered; sort accepts ${allowed.join(', ')}`);
  }
  return { sortField: first.field, order: first.direction };
}

/**
 * The keyset request of a member or role list: BE-19's query, `?q=` (bounded), the one sort and the
 * cursor decoded for that sort. A cursor minted under another sort, or carrying a value of the wrong
 * kind for its column, is the same 400 as a tampered one.
 */
function keysetRequest<TField extends string, TSort extends string>(
  input: unknown,
  query: ListQuery<TField>,
  allowed: readonly TSort[],
  kinds: Readonly<Record<TSort, 'number' | 'string'>>,
  list: string,
): KeysetListRequest<TField, TSort> {
  const { sortField, order } = keysetSort(query.sort, allowed, list);
  const cursor = decodeCursor(query.cursor, sortField);
  if (cursor !== null && typeof cursor.key[0] !== kinds[sortField]) {
    refuse(['cursor'], 'cursor is not a cursor of this list');
  }
  const raw = isRecord(input) ? input : {};
  const search = readScalar(raw, 'q');
  if (search !== null && search.length > SEARCH_MAX_LENGTH) {
    refuse(['q'], `q must be at most ${String(SEARCH_MAX_LENGTH)} characters`);
  }
  return { query, search, sortField, order, cursor };
}

/**
 * The list request an export reads with (plan 03.2-05, 04.1.1-02): the list's own filters, `q` and
 * sort, from the first row, in batches of the list's maximum. The export parameters (`format`,
 * `column`, `header`, the presentation ones) and the refusal of `limit` and `cursor` are the shared
 * core's (`parseExportOptions`, `shared/http/export.ts`), which the service runs first.
 */
function exportBatches<TField extends string, TSort extends string>(
  request: KeysetListRequest<TField, TSort>,
): KeysetListRequest<TField, TSort> {
  return {
    ...request,
    query: { ...request.query, limit: LIST_QUERY_LIMITS.max, cursor: null },
    cursor: null,
  };
}

@Injectable()
export class IdentityValidator {
  /** `:id` of the member routes; a non-numeric or non-positive id is a 400, never a 404 probe. */
  parseMemberParams(input: unknown): MemberParams {
    const parsed = memberParamsSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('ERP-VALIDATION-0001', 'Path parameter is invalid', {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  /**
   * `GET members` — BE-19's grammar over the seven allowed fields, plus Perfex's free-text `?q=`.
   * Ordering is keyset on `(sortField, staffId)`, one field of `MEMBER_SORT_FIELDS` at a time.
   */
  parseMemberListQuery(input: unknown): MemberListRequest {
    const query = parseListQuery(input, MEMBER_LIST_FIELDS);
    return keysetRequest(input, query, MEMBER_SORT_FIELDS, MEMBER_SORT_KINDS, 'member list');
  }

  /**
   * `GET audit` — BE-19's grammar over the four fields ADR-0034 decision 3 exposes. Keyset on the
   * row id, which follows `createdAt` because the id is a server-assigned auto-increment.
   */
  parseAuditListQuery(input: unknown): ListQuery<AuditListField> {
    const query = parseListQuery(input, AUDIT_LIST_FIELDS);
    this.assertNumericCursor(query.cursor);
    for (const entry of query.sort) {
      if (entry.field !== AUDIT_SORT_FIELD) {
        refuse(['sort'], `the audit log is keyset-ordered; sort accepts ${AUDIT_SORT_FIELD}`);
      }
    }
    return query;
  }

  /** `:id` of the role routes; a non-numeric or non-positive id is a 400, never a 404 probe. */
  parseRoleParams(input: unknown): RoleParams {
    const parsed = roleParamsSchema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('ERP-VALIDATION-0001', 'Path parameter is invalid', {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }

  /**
   * `GET roles` — BE-19's grammar over the two allowed fields, plus `?q=` over the role name (the
   * members list's search box, so the kit's list page speaks one grammar). Ordering is keyset on
   * `(sortField, roleId)`, one field of `ROLE_SORT_FIELDS` at a time.
   */
  parseRoleListQuery(input: unknown): RoleListRequest {
    const query = parseListQuery(input, ROLE_LIST_FIELDS);
    return keysetRequest(input, query, ROLE_SORT_FIELDS, ROLE_SORT_KINDS, 'roles list');
  }

  /** `GET members/export` - the member list's grammar (filters, `q`, one sort), every row. */
  parseMemberExportList(input: unknown): MemberListRequest {
    return exportBatches(this.parseMemberListQuery(input));
  }

  /** `GET roles/export` - the roles list's grammar (`filter[name]`, `q`, one sort), every row. */
  parseRoleExportList(input: unknown): RoleListRequest {
    return exportBatches(this.parseRoleListQuery(input));
  }

  /** `POST roles` — the whole body is a granting field (ADR-0034 d.2); an unknown key is a 400. */
  parseCreateRoleBody(input: unknown): CreateRoleBody {
    return this.parseBody(createRoleBodySchema, input);
  }

  /** `PATCH roles/:id` — every field optional, including Perfex's `applyToMembers` checkbox. */
  parseUpdateRoleBody(input: unknown): UpdateRoleBody {
    return this.parseBody(updateRoleBodySchema, input);
  }

  /** `POST members` — every profile field plus the three granting fields; an unknown key is a 400. */
  parseCreateMemberBody(input: unknown): CreateMemberBody {
    return this.parseBody(createMemberBodySchema, input);
  }

  /** `PATCH members/:id` — every field optional; an empty `password` means unchanged (brief §3). */
  parseUpdateMemberBody(input: unknown): UpdateMemberBody {
    return this.parseBody(updateMemberBodySchema, input);
  }

  /** `PATCH members/:id/status` — `{ active }`, and never a grant. */
  parseMemberStatusBody(input: unknown): MemberStatusBody {
    return this.parseBody(memberStatusBodySchema, input);
  }

  /** The audit log's keyset cursor is a row id; anything else is a 400, never a silent first page. */
  protected assertNumericCursor(cursor: string | null): void {
    if (cursor !== null && !NUMERIC_CURSOR.test(cursor)) refuse(['cursor'], 'cursor is malformed');
  }

  /** `safeParse` → `AppError('ERP-VALIDATION-0001')` with the zod issues (BE-09). */
  private parseBody<T>(schema: z.ZodType<T>, input: unknown): T {
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      throw new AppError('ERP-VALIDATION-0001', 'Request body is invalid', {
        issues: parsed.error.issues,
      });
    }
    return parsed.data;
  }
}
