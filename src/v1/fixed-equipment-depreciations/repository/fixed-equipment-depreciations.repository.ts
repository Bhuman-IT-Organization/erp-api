import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { AppError } from '../../../shared/errors/app-error.js';
import type { ReadScope } from '../../../shared/http/decorators/scope.decorator.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';
import {
  FIXED_EQUIPMENT_DEPRECIATIONS_FACADE_MAX_ROWS,
  type FixedEquipmentDepreciation,
  type FixedEquipmentDepreciationPatch,
  type FixedEquipmentDepreciationsListRequest,
  type FixedEquipmentDepreciationsPage,
  type FixedEquipmentDepreciationsSortField,
  type NewFixedEquipmentDepreciation,
} from '../model/fixed-equipment-depreciations.model.js';

const RECORD_NOT_FOUND = 'P2025';
/** `tblfe_depreciations.id` is an unsigned INT. */
const MAX_UNSIGNED_INT_ID = 4_294_967_295;

const COLUMNS = { id: true, name: true, term: true, creator_id: true } as const;

/** The Prisma column each API sort name reads. */
const COLUMN_OF = { id: 'id', name: 'name' } as const satisfies Record<
  FixedEquipmentDepreciationsSortField,
  string
>;

const rowSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    term: z.number().nullable(),
    creator_id: z.number().int().nullable(),
  })
  .transform((row): FixedEquipmentDepreciation => ({
    id: row.id,
    name: row.name,
    term: row.term,
    creatorId: row.creator_id,
  }));
const rowsSchema = z.array(rowSchema);

type WhereValue = Record<string, unknown>;
type Key = readonly [KeyValue, number];

/**
 * The row scope, then `?q=`, AND-ed: `own` adds `creator_id = staffId` (the rows the member created,
 * as Perfex's view_own does) and only ever narrows; `q` matches the name, or an all-digit `q` the id.
 */
function whereOf(search: string | null, scope: ReadScope, staffId: number): WhereValue {
  const parts: WhereValue[] = [];
  if (scope === 'own') parts.push({ creator_id: staffId });
  if (search !== null) {
    const or: WhereValue[] = [{ name: { contains: search } }];
    if (/^\d+$/.test(search) && Number(search) <= MAX_UNSIGNED_INT_ID)
      or.push({ id: Number(search) });
    parts.push({ OR: or });
  }
  return parts.length === 0 ? {} : { AND: parts };
}

function keyOf(
  row: FixedEquipmentDepreciation,
  sortField: FixedEquipmentDepreciationsSortField,
): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

function readDirection(request: FixedEquipmentDepreciationsListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') return request.order;
  return request.order === 'asc' ? 'desc' : 'asc';
}

function pageMeta(
  sortField: FixedEquipmentDepreciationsSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<FixedEquipmentDepreciationsPage, 'items'> {
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

function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === RECORD_NOT_FOUND
  );
}

@Injectable()
export class FixedEquipmentDepreciationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    request: FixedEquipmentDepreciationsListRequest,
    scope: ReadScope,
    staffId: number,
  ): Promise<FixedEquipmentDepreciationsPage> {
    const { sortField, order, cursor, limit } = request;
    const column = COLUMN_OF[sortField];
    const match = whereOf(request.search, scope, staffId);
    const read = readDirection(request);
    const rows = await this.prisma.client.tblfe_depreciations.findMany({
      where: cursor === null ? match : { AND: [match, keysetWhere(column, 'id', cursor, order)] },
      orderBy: [{ [column]: read }, { id: read }],
      take: limit,
      select: COLUMNS,
    });
    const items = rowsSchema.parse(rows);
    if (read !== order) items.reverse();
    const keys = items.map((row) => keyOf(row, sortField));
    const first = keys[0];
    const [total, before] = await Promise.all([
      this.prisma.client.tblfe_depreciations.count({ where: match }),
      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblfe_depreciations.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  column,
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
  count(
    request: FixedEquipmentDepreciationsListRequest,
    scope: ReadScope,
    staffId: number,
  ): Promise<number> {
    return this.prisma.client.tblfe_depreciations.count({
      where: whereOf(request.search, scope, staffId),
    });
  }

  /** One row, or `null` when it is missing OR another member's under `own` (the same answer). */
  async findById(
    id: number,
    scope: ReadScope,
    staffId: number,
  ): Promise<FixedEquipmentDepreciation | null> {
    const row = await this.prisma.client.tblfe_depreciations.findFirst({
      where: scope === 'own' ? { id, creator_id: staffId } : { id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  /** `date_creator` is the database's default; `creator_id` is the member who created it. */
  async create(input: NewFixedEquipmentDepreciation): Promise<FixedEquipmentDepreciation> {
    const row = await this.prisma.client.tblfe_depreciations.create({
      data: { name: input.name, term: input.term, creator_id: input.creatorId },
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  /** The name and the term only: `creator_id` and `date_creator` stay as they were. */
  async update(
    id: number,
    patch: FixedEquipmentDepreciationPatch,
  ): Promise<FixedEquipmentDepreciation | null> {
    try {
      const row = await this.prisma.client.tblfe_depreciations.update({
        where: { id },
        data: { name: patch.name, term: patch.term },
        select: COLUMNS,
      });
      return rowSchema.parse(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tblfe_depreciations.deleteMany({
      where: { id },
    });
    return count > 0;
  }

  async listAll(): Promise<readonly FixedEquipmentDepreciation[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tblfe_depreciations.findMany({
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        take: FIXED_EQUIPMENT_DEPRECIATIONS_FACADE_MAX_ROWS + 1,
        select: COLUMNS,
      }),
    );
    if (rows.length > FIXED_EQUIPMENT_DEPRECIATIONS_FACADE_MAX_ROWS) {
      throw new AppError(
        'ERP-INTERNAL-0001',
        `more than ${String(FIXED_EQUIPMENT_DEPRECIATIONS_FACADE_MAX_ROWS)} depreciations: the full list was refused, not truncated`,
      );
    }
    return rows;
  }
}
