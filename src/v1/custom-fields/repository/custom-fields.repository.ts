/**
 * Repository: the module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Reader of two Perfex tables (ADR-0029; neither is Node's in `ownership.json`):
 *   `tblcustomfields`        Perfex's: Setup > Custom Fields writes every column; warehouse's
 *                            `wh_convert_to_customer` also writes it.
 *   `tblcustomfieldsvalues`  Perfex's: `handle_custom_fields_post` for every entity, purchase and
 *                            warehouse write it (README).
 *
 * Reads only: no create, update, delete or raw statement here. Every read goes through the typed
 * delegates. The value counts are ONE `groupBy` on `fieldid` over all the ids, never one query per
 * row; a failing read is not caught (fail closed).
 *
 * The flag columns are tinyints Perfex reads as 0 and 1; this file maps them to booleans.
 * `fieldto` and `field_order` are nullable columns: a NULL reads as `''` and `0`, and the keyset
 * predicate follows MySQL's NULLS FIRST ascending.
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { encodeCursor, type DecodedCursor, type KeyValue } from '../../../shared/http/keyset.js';
import type {
  CustomField,
  CustomFieldsListRequest,
  CustomFieldsPage,
  CustomFieldsSortField,
  StoredCustomFieldValue,
} from '../model/custom-fields.model.js';

const COLUMNS = {
  id: true,
  fieldto: true,
  name: true,
  slug: true,
  required: true,
  type: true,
  options: true,
  display_inline: true,
  field_order: true,
  active: true,
  show_on_pdf: true,
  show_on_ticket_form: true,
  only_admin: true,
  show_on_table: true,
  show_on_client_portal: true,
  disalow_client_to_edit: true,
  bs_column: true,
  default_value: true,
} as const;

const flag = z.union([z.boolean(), z.number().int()]).transform((value) => Number(value) === 1);

const rowSchema = z
  .object({
    id: z.number().int(),
    fieldto: z.string().nullable(),
    name: z.string(),
    slug: z.string(),
    required: flag,
    type: z.string(),
    options: z.string().nullable(),
    display_inline: flag,
    field_order: z.number().int().nullable(),
    active: flag,
    show_on_pdf: flag,
    show_on_ticket_form: flag,
    only_admin: flag,
    show_on_table: flag,
    show_on_client_portal: flag,
    disalow_client_to_edit: flag,
    bs_column: z.number().int(),
    default_value: z.string().nullable(),
  })
  .transform((row): CustomField => ({
    id: row.id,
    fieldto: row.fieldto ?? '',
    name: row.name,
    slug: row.slug,
    type: row.type,
    options: row.options ?? '',
    defaultValue: row.default_value,
    fieldOrder: row.field_order ?? 0,
    bsColumn: row.bs_column,
    active: row.active,
    required: row.required,
    displayInline: row.display_inline,
    onlyAdmin: row.only_admin,
    disallowCustomerEdit: row.disalow_client_to_edit,
    showOnTable: row.show_on_table,
    showOnPdf: row.show_on_pdf,
    showOnClientPortal: row.show_on_client_portal,
    showOnTicketForm: row.show_on_ticket_form,
  }));
const rowsSchema = z.array(rowSchema);

const valueRowSchema = z.object({
  id: z.number().int(),
  relid: z.number().int(),
  fieldid: z.number().int(),
  value: z.string(),
});
const valueRowsSchema = z.array(valueRowSchema);
const countsSchema = z.array(
  z.object({ fieldid: z.number().int(), _count: z.object({ id: z.number().int() }) }),
);

/** The wire sort field to its column. */
const SORT_COLUMNS: Readonly<Record<CustomFieldsSortField, string>> = {
  id: 'id',
  name: 'name',
  fieldto: 'fieldto',
  type: 'type',
  fieldOrder: 'field_order',
};

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];

/** The sort columns that may hold NULL; a NOT NULL column takes no `null` clause (Prisma refuses one). */
const NULLABLE_COLUMNS: ReadonlySet<string> = new Set(['fieldto', 'field_order']);

/** `?q=` over the name or the slug, and the `fieldto` filter; `{}` matches every row. */
function matchOf(request: CustomFieldsListRequest): WhereValue {
  const parts: WhereValue[] = [];
  if (request.search !== null) {
    parts.push({
      OR: [{ name: { contains: request.search } }, { slug: { contains: request.search } }],
    });
  }
  if (request.fieldto !== null) parts.push({ fieldto: { in: [...request.fieldto] } });
  return parts.length === 0 ? {} : { AND: parts };
}

/**
 * The keyset predicate over a nullable column: MySQL reads NULLs
 * first ascending and last descending; a `false` key is a NULL. Sorting by the id compares only it.
 */
export function keysetPredicate(
  column: string,
  cursor: DecodedCursor<string>,
  order: 'asc' | 'desc',
): WhereValue {
  const forward = (order === 'asc') === (cursor.direction === 'after');
  const [value, id] = cursor.key;
  if (column === 'id') return { id: { [forward ? 'gt' : 'lt']: id } };
  if (value === false) {
    return forward
      ? { OR: [{ [column]: null, id: { gt: id } }, { [column]: { not: null } }] }
      : { [column]: null, id: { lt: id } };
  }
  return forward
    ? { OR: [{ [column]: { gt: value } }, { [column]: value, id: { gt: id } }] }
    : {
        OR: [
          ...(NULLABLE_COLUMNS.has(column) ? [{ [column]: null }] : []),
          { [column]: { lt: value } },
          { [column]: value, id: { lt: id } },
        ],
      };
}

/** A row's cursor key: its sort column's stored value (`false` for NULL) and its id. */
function keyOf(raw: Record<string, unknown>, column: string): Key {
  const id = z.number().int().parse(raw.id);
  const value = z.union([z.string(), z.number()]).nullable().parse(raw[column]);
  return [value ?? false, id];
}

function readDirection(request: CustomFieldsListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

function pageMeta(
  sortField: CustomFieldsSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<CustomFieldsPage, 'items'> {
  const first = keys[0];
  const last = keys.at(-1);
  if (first === undefined || last === undefined) {
    return { nextCursor: null, prevCursor: null, total, rangeStart: 0 };
  }
  const rangeStart = before + 1;
  return {
    nextCursor:
      rangeStart - 1 + keys.length < total ? encodeCursor(sortField, last, 'after') : null,
    prevCursor: rangeStart > 1 ? encodeCursor(sortField, first, 'before') : null,
    total,
    rangeStart,
  };
}

@Injectable()
export class CustomFieldsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One keyset page ordered by `(sort column, id)`, then `total` and the first row's rank. */
  async list(request: CustomFieldsListRequest): Promise<CustomFieldsPage> {
    const { order, cursor, limit } = request;
    const column = SORT_COLUMNS[request.sortField];
    const match = matchOf(request);
    const read = readDirection(request);
    const delegate = this.prisma.client.tblcustomfields;
    const raw = await delegate.findMany({
      where: cursor === null ? match : { AND: [match, keysetPredicate(column, cursor, order)] },
      orderBy: column === 'id' ? [{ id: read }] : [{ [column]: read }, { id: read }],
      take: limit,
      select: COLUMNS,
    });
    if (read !== order) raw.reverse();
    const keys = raw.map((row) => keyOf(row, column));
    const first = keys[0];
    const [total, before] = await Promise.all([
      delegate.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : delegate.count({
            where: {
              AND: [
                match,
                keysetPredicate(
                  column,
                  { sort: request.sortField, key: first, direction: 'before' },
                  order,
                ),
              ],
            },
          }),
    ]);
    return { items: rowsSchema.parse(raw), ...pageMeta(request.sortField, keys, total, before) };
  }

  /** The list's own match without the cursor: what the export counts before it reads a row. */
  count(request: CustomFieldsListRequest): Promise<number> {
    return this.prisma.client.tblcustomfields.count({ where: matchOf(request) });
  }

  /** One field, or `null` when the id is missing. */
  async findById(id: number): Promise<CustomField | null> {
    const row = await this.prisma.client.tblcustomfields.findFirst({
      where: { id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  /** `fieldId -> value rows`, one grouped read; zeros for an id no row names; no ids, no query. */
  async valuesCountOf(ids: readonly number[]): Promise<ReadonlyMap<number, number>> {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.client.tblcustomfieldsvalues.groupBy({
      by: ['fieldid'],
      where: { fieldid: { in: [...ids] } },
      _count: { id: true },
    });
    const counts = new Map(countsSchema.parse(rows).map((row) => [row.fieldid, row._count.id]));
    return new Map(ids.map((id) => [id, counts.get(id) ?? 0]));
  }

  /** Every field of one entity, in Perfex's order: `field_order`, then id. */
  async definitionsOf(fieldto: string): Promise<readonly CustomField[]> {
    const rows = await this.prisma.client.tblcustomfields.findMany({
      where: { fieldto },
      orderBy: [{ field_order: 'asc' }, { id: 'asc' }],
      select: COLUMNS,
    });
    return rowsSchema.parse(rows);
  }

  /** The value rows of the records, one read, ordered by record then field. */
  async valuesOf(
    fieldto: string,
    relIds: readonly number[],
  ): Promise<readonly StoredCustomFieldValue[]> {
    if (relIds.length === 0) return [];
    const rows = await this.prisma.client.tblcustomfieldsvalues.findMany({
      where: { fieldto, relid: { in: [...relIds] } },
      orderBy: [{ relid: 'asc' }, { fieldid: 'asc' }, { id: 'asc' }],
      select: { id: true, relid: true, fieldid: true, value: true },
    });
    return valueRowsSchema
      .parse(rows)
      .map((row) => ({ relId: row.relid, fieldId: row.fieldid, value: row.value }));
  }
}
