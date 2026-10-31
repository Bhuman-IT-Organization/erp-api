/**
 * Repository: the module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Owner of the two tables it writes (ADR-0029; `ownership.json`):
 *   `tblcustomers_groups`  node: `name` (`VARCHAR(191)`); `id` is assigned by the database.
 * Owner of the table it writes (ADR-0029; `ownership.json`):
 *   `tblcustomers_groups`  node: `name` (`VARCHAR(191)`); `id` is assigned by the database.
 *   `tblcustomer_groups`   perfex-core: the links `(groupid, customer_id)`; Perfex keeps writing them
 *                          from the customer screens. This module only COUNTS them (read only), to
 *                          refuse a delete while a customer is in the group.
 * Every write goes through the typed delegate, which the ownership guard admits because the
 * register names `node` for `tblcustomers_groups`.
 *
 * Every row is re-parsed through its zod schema, never trusted from the generic (BE-11).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import {
  CUSTOMER_GROUPS_FACADE_MAX_ROWS,
  type CustomerGroupRow,
  type CustomerGroupsListRequest,
  type CustomerGroupsPage,
  type CustomerGroupsSortField,
  type NewCustomerGroup,
} from '../model/customer-groups.model.js';

/** Prisma's "record to update not found". */
const RECORD_NOT_FOUND = 'P2025';

/** The largest value of MySQL's `INT UNSIGNED` (the id column): a longer all-digit `q` is not an id. */
const MAX_INT_ID = 2_147_483_647;

/** The two columns of the table; nothing else is selected. */
const COLUMNS = { id: true, name: true } as const;

const rowSchema = z.object({
  id: z.number().int(),
  name: z.string(),
});
const rowsSchema = z.array(rowSchema);

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];

/** `?q=`: the name contains it; an all-digit `q` that fits the id column also matches the id. */
function matchOf(search: string | null): WhereValue {
  if (search === null) return {};
  const or: WhereValue[] = [{ name: { contains: search } }];
  if (/^\d+$/.test(search) && Number(search) <= MAX_INT_ID) or.push({ id: Number(search) });
  return { OR: or };
}

function keyOf(row: CustomerGroupRow, sortField: CustomerGroupsSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** A `before` cursor reads the rows just before it in the reversed order, then reverses them back. */
function readDirection(request: CustomerGroupsListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

/** Next exists while rows remain after the page, Previous while rows exist before it. */
function pageMeta(
  sortField: CustomerGroupsSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<CustomerGroupsPage, 'items'> {
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

/** Prisma's P2025, read from the error's `code` so no Prisma class leaves this file. */
function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === RECORD_NOT_FOUND
  );
}

@Injectable()
export class CustomerGroupsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One keyset page ordered by `(sort column, id)`, then `total` (the match without the cursor)
   * and the rank of the first row, both through `count`, exactly as the cost centers list.
   */
  async list(request: CustomerGroupsListRequest): Promise<CustomerGroupsPage> {
    const { sortField, order, cursor, limit } = request;
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.prisma.client.tblcustomers_groups.findMany({
      where:
        cursor === null ? match : { AND: [match, keysetWhere(sortField, 'id', cursor, order)] },
      orderBy: [{ [sortField]: read }, { id: read }],
      take: limit,
      select: COLUMNS,
    });
    const items = rowsSchema.parse(rows);
    if (read !== order) items.reverse();
    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tblcustomers_groups.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblcustomers_groups.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  sortField,
                  'id',
                  { sort: sortField, key: first, direction: 'before' },
                  order,
                ),
              ],
            },
          }),
    ]);
    return { items, ...pageMeta(sortField, keys, total, before) };
  }
  /** The list's own match without the cursor: what the export counts before it reads a row. */
  count(request: CustomerGroupsListRequest): Promise<number> {
    return this.prisma.client.tblcustomers_groups.count({ where: matchOf(request.search) });
  }
  /** One row in its stored form, or `null` when the id is missing. */
  async findById(id: number): Promise<CustomerGroupRow | null> {
    const row = await this.prisma.client.tblcustomers_groups.findFirst({
      where: { id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  /** Inserts a row; the database assigns the id. */
  async create(input: NewCustomerGroup): Promise<CustomerGroupRow> {
    const row = await this.prisma.client.tblcustomers_groups.create({
      data: { name: input.name },
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  /** Changes the name and NOTHING else; `null` when the id is missing (Prisma P2025). */
  async update(id: number, patch: { readonly name: string }): Promise<CustomerGroupRow | null> {
    try {
      const row = await this.prisma.client.tblcustomers_groups.update({
        where: { id },
        data: { name: patch.name },
        select: COLUMNS,
      });
      return rowSchema.parse(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /**
   * Counts the customers in the group: the rows of `tblcustomer_groups` (Perfex's table, read only)
   * for `groupid`. The service refuses the delete while this is above 0.
   */
  async countCustomers(groupId: number): Promise<number> {
    return this.prisma.client.tblcustomer_groups.count({ where: { groupid: groupId } });
  }

  /**
   * Deletes the group. `false` when the group was missing (nothing was deleted). It never touches
   * `tblcustomer_groups`: the service has already refused while any customer is in the group.
   */
  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tblcustomers_groups.deleteMany({ where: { id } });
    return count > 0;
  }

  /**
   * Every customer group, the name ascending, then the id (the order Perfex's pickers read): the
   * facade's `listAll`. Reads one row more than `CUSTOMER_GROUPS_FACADE_MAX_ROWS` and refuses
   * loudly when it finds it, never answering a truncated list.
   */
  async listAll(): Promise<readonly CustomerGroupRow[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tblcustomers_groups.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: CUSTOMER_GROUPS_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > CUSTOMER_GROUPS_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(CUSTOMER_GROUPS_FACADE_MAX_ROWS)} customer groups: the full list was refused, not truncated`,
      );
    }
    return rows;
  }

  /** The rows whose id is in `ids`, in no particular order (the service orders them). */
  async findByIds(ids: readonly number[]): Promise<readonly CustomerGroupRow[]> {
    if (ids.length === 0) return [];
    return rowsSchema.parse(
      await this.prisma.client.tblcustomers_groups.findMany({
        where: { id: { in: [...ids] } },
        select: COLUMNS,
      }),
    );
  }
}
