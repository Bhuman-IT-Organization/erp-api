/**
 * Repository: the module's data seam (BE-08) and the only file here that touches Prisma (DB-04).
 *
 * Owner of the one table it writes (ADR-0029; `ownership.json`):
 *   `tblservices`  node: `name` (`VARCHAR(50)`); `serviceid` is assigned by the database.
 * Read only: `tbltickets.service`, counted for the delete refusal (Perfex's `is_referenced`).
 *
 * Every row is re-parsed through its zod schema, never trusted from the generic (BE-11).
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AppError } from '../../../shared/errors/app-error.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import {
  SERVICES_FACADE_MAX_ROWS,
  type NewService,
  type ServiceRow,
  type ServicesListRequest,
  type ServicesPage,
  type ServicesSortField,
} from '../model/services.model.js';

/** Prisma's "record to update not found". */
const RECORD_NOT_FOUND = 'P2025';

/** The largest signed INT: a longer all-digit `q` is not an id. */
const MAX_INT_ID = 2_147_483_647;

/** The table's two columns; nothing else is selected. */
const COLUMNS = { serviceid: true, name: true } as const;

/** The API's sort field -> the table's column. */
const COLUMN_OF = { id: 'serviceid', name: 'name' } as const satisfies Record<
  ServicesSortField,
  string
>;

const rowSchema = z
  .object({ serviceid: z.number().int(), name: z.string() })
  .transform((row): ServiceRow => ({ id: row.serviceid, name: row.name }));
const rowsSchema = z.array(rowSchema);

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];

/** `?q=`: the name contains it; an all-digit `q` that fits the id column also matches the id. */
function matchOf(search: string | null): WhereValue {
  if (search === null) return {};
  const or: WhereValue[] = [{ name: { contains: search } }];
  if (/^\d+$/.test(search) && Number(search) <= MAX_INT_ID) or.push({ serviceid: Number(search) });
  return { OR: or };
}

function keyOf(row: ServiceRow, sortField: ServicesSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

/** A `before` cursor reads the rows just before it in the reversed order, then reverses them back. */
function readDirection(request: ServicesListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

/** Next exists while rows remain after the page, Previous while rows exist before it. */
function pageMeta(
  sortField: ServicesSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<ServicesPage, 'items'> {
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
export class ServicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** One keyset page ordered by `(sort column, serviceid)`, then `total` and the rank of the first row. */
  async list(request: ServicesListRequest): Promise<ServicesPage> {
    const { sortField, order, cursor, limit } = request;
    const column = COLUMN_OF[sortField];
    const match = matchOf(request.search);
    const read = readDirection(request);
    const rows = await this.prisma.client.tblservices.findMany({
      where:
        cursor === null ? match : { AND: [match, keysetWhere(column, 'serviceid', cursor, order)] },
      orderBy: [{ [column]: read }, { serviceid: read }],
      take: limit,
      select: COLUMNS,
    });
    const items = rowsSchema.parse(rows);
    if (read !== order) items.reverse();
    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tblservices.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblservices.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  column,
                  'serviceid',
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
  count(request: ServicesListRequest): Promise<number> {
    return this.prisma.client.tblservices.count({ where: matchOf(request.search) });
  }

  /** One row in its stored form, or `null` when the id is missing. */
  async findById(id: number): Promise<ServiceRow | null> {
    const row = await this.prisma.client.tblservices.findFirst({
      where: { serviceid: id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  /** Inserts a row with the name; the database assigns the id. */
  async create(input: NewService): Promise<ServiceRow> {
    const row = await this.prisma.client.tblservices.create({
      data: { name: input.name },
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  /** Changes the name and NOTHING else; `null` when the id is missing (Prisma P2025). */
  async update(id: number, patch: { readonly name: string }): Promise<ServiceRow | null> {
    try {
      const row = await this.prisma.client.tblservices.update({
        where: { serviceid: id },
        data: { name: patch.name },
        select: COLUMNS,
      });
      return rowSchema.parse(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /** Deletes a row; `false` when nothing was deleted (the id was missing). */
  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tblservices.deleteMany({
      where: { serviceid: id },
    });
    return count > 0;
  }

  /** Perfex's `is_referenced`: the tickets that use the service (`tbltickets.service`). Read only. */
  countTickets(id: number): Promise<number> {
    return this.prisma.client.tbltickets.count({ where: { service: id } });
  }

  /** Every service, the name ascending, then the id; refused loudly above the cap, never truncated. */
  async listAll(): Promise<readonly ServiceRow[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tblservices.findMany({
        orderBy: [{ name: 'asc' }, { serviceid: 'asc' }],
        take: SERVICES_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > SERVICES_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(SERVICES_FACADE_MAX_ROWS)} services: the full list was refused, not truncated`,
      );
    }
    return rows;
  }

  /** The rows whose id is in `ids`, in no particular order (the service orders them). */
  async findByIds(ids: readonly number[]): Promise<readonly ServiceRow[]> {
    if (ids.length === 0) return [];
    return rowsSchema.parse(
      await this.prisma.client.tblservices.findMany({
        where: { serviceid: { in: [...ids] } },
        select: COLUMNS,
      }),
    );
  }
}
