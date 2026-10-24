import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { AppError } from '../../../shared/errors/app-error.js';
import { Prisma } from '../../../shared/db/generated/client.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { encodeCursor, keysetWhere, type KeyValue } from '../../../shared/http/keyset.js';

import {
  LEAD_STATUSES_FACADE_MAX_ROWS,
  type LeadStatusRow,
  type LeadStatusUsage,
  type LeadStatusesListRequest,
  type LeadStatusesPage,
  type LeadStatusesSortField,
} from '../model/lead-statuses.model.js';

export interface CreateLeadStatusData {
  readonly name: string;
  readonly color?: string | null;
  readonly statusorder?: number | null;
}

export interface UpdateLeadStatusData {
  readonly name?: string;
  readonly color?: string | null;
  readonly statusorder?: number | null;
}

const COLUMNS = {
  id: true,
  name: true,
  statusorder: true,
  color: true,
  isdefault: true,
} as const;

const rowSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  statusorder: z.number().int().nullable(),
  color: z.string().nullable(),
  isdefault: z.number().int(),
});

const rowsSchema = z.array(rowSchema);

const countSchema = z.union([z.bigint(), z.number().int()]).transform(Number);

const usageRowsSchema = z.array(
  z.object({
    id: z.coerce.number().int(),
    n: countSchema,
  }),
);

type Key = readonly [KeyValue, number];

function matchOf(search: string | null): Prisma.tblleads_statusWhereInput {
  if (search === null) return {};

  return {
    name: { contains: search },
  };
}

function keyOf(row: LeadStatusRow, sortField: LeadStatusesSortField): Key {
  return sortField === 'name' ? [row.name, row.id] : [row.id, row.id];
}

function readDirection(request: LeadStatusesListRequest): 'asc' | 'desc' {
  if (request.cursor?.direction !== 'before') {
    return request.order;
  }

  return request.order === 'asc' ? 'desc' : 'asc';
}

function pageMeta(
  sortField: LeadStatusesSortField,
  keys: readonly Key[],
  total: number,
  before: number,
): Omit<LeadStatusesPage, 'items'> {
  const first = keys[0];
  const last = keys.at(-1);

  if (first === undefined || last === undefined) {
    return {
      nextCursor: null,
      prevCursor: null,
      total,
      rangeStart: 0,
    };
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

function isMissingRecord(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2025';
}

@Injectable()
export class LeadStatusesRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Paginated list
  async list(request: LeadStatusesListRequest): Promise<LeadStatusesPage> {
    const { sortField, order, cursor, limit } = request;

    const match = matchOf(request.search);
    const read = readDirection(request);

    const rows = await this.prisma.client.tblleads_status.findMany({
      where:
        cursor === null
          ? match
          : {
              AND: [match, keysetWhere(sortField, 'id', cursor, order)],
            },

      orderBy: [{ [sortField]: read }, { id: read }],

      take: limit,
      select: COLUMNS,
    });

    const items: LeadStatusRow[] = rowsSchema.parse(rows);

    if (read !== order) {
      items.reverse();
    }

    const keys = items.map((row) => keyOf(row, sortField));

    const first = keys[0];

    const [total, before] = await Promise.all([
      this.prisma.client.tblleads_status.count({
        where: match,
      }),

      first === undefined
        ? Promise.resolve(0)
        : this.prisma.client.tblleads_status.count({
            where: {
              AND: [
                match,
                keysetWhere(
                  sortField,
                  'id',
                  {
                    sort: sortField,
                    key: first,
                    direction: 'before',
                  },
                  order,
                ),
              ],
            },
          }),
    ]);

    return {
      items,
      ...pageMeta(sortField, keys, total, before),
    };
  }

  // Count matching statuses
  count(request?: LeadStatusesListRequest): Promise<number> {
    return this.prisma.client.tblleads_status.count({
      where: matchOf(request?.search ?? null),
    });
  }

  // Find by ID
  async findById(id: number): Promise<LeadStatusRow | null> {
    const row = await this.prisma.client.tblleads_status.findUnique({
      where: { id },
      select: COLUMNS,
    });

    return row === null ? null : rowSchema.parse(row);
  }

  // Find multiple statuses
  async findByIds(ids: readonly number[]): Promise<readonly LeadStatusRow[]> {
    if (ids.length === 0) return [];

    return rowsSchema.parse(
      await this.prisma.client.tblleads_status.findMany({
        where: {
          id: {
            in: [...new Set(ids)],
          },
        },
        select: COLUMNS,
      }),
    );
  }

  // List statuses in display order
  async listAll(): Promise<readonly LeadStatusRow[]> {
    const rows = rowsSchema.parse(
      await this.prisma.client.tblleads_status.findMany({
        orderBy: [{ statusorder: 'asc' }, { id: 'asc' }],

        take: LEAD_STATUSES_FACADE_MAX_ROWS + 1,

        select: COLUMNS,
      }),
    );

    if (rows.length > LEAD_STATUSES_FACADE_MAX_ROWS) {
      throw new AppError('ERP-INTERNAL-0001', 'Too many lead statuses for an unpaged read');
    }

    return rows;
  }

  // Create status
  async create(input: CreateLeadStatusData): Promise<LeadStatusRow> {
    const row = await this.prisma.client.tblleads_status.create({
      data: {
        name: input.name,
        color: input.color ?? '#28B8DA',
        statusorder: input.statusorder ?? null,
        isdefault: 0,
      },
      select: COLUMNS,
    });

    return rowSchema.parse(row);
  }

  // Update status
  async update(id: number, patch: UpdateLeadStatusData): Promise<LeadStatusRow | null> {
    try {
      const row = await this.prisma.client.tblleads_status.update({
        where: { id },

        data: {
          ...(patch.name !== undefined ? { name: patch.name } : {}),

          ...(patch.color !== undefined ? { color: patch.color } : {}),

          ...(patch.statusorder !== undefined ? { statusorder: patch.statusorder } : {}),
        },

        select: COLUMNS,
      });

      return rowSchema.parse(row);
    } catch (error) {
      if (isMissingRecord(error)) {
        return null;
      }

      throw error;
    }
  }

  // Delete status
  async remove(id: number): Promise<boolean> {
    const result = await this.prisma.client.tblleads_status.deleteMany({
      where: { id },
    });

    return result.count > 0;
  }

  // Count references from leads and email integration
  async usageByStatuses(ids: readonly number[]): Promise<ReadonlyMap<number, LeadStatusUsage>> {
    const unique = [...new Set(ids)];

    if (unique.length === 0) {
      return new Map();
    }

    const bound = Prisma.join(unique);

    const [leadsAnswer, emailAnswer] = await Promise.all([
      this.prisma.client.$queryRaw`
          SELECT status AS id, COUNT(*) AS n
          FROM tblleads
          WHERE status IN (${bound})
          GROUP BY status
        `,

      this.prisma.client.$queryRaw`
          SELECT lead_status AS id, COUNT(*) AS n
          FROM tblleads_email_integration
          WHERE lead_status IN (${bound})
          GROUP BY lead_status
        `,
    ]);

    const totals = new Map<number, LeadStatusUsage>(
      unique.map((id) => [
        id,
        {
          leads: 0,
          emailIntegration: 0,
        },
      ]),
    );

    for (const { id, n } of usageRowsSchema.parse(leadsAnswer)) {
      const old = totals.get(id);

      if (old !== undefined) {
        totals.set(id, {
          ...old,
          leads: n,
        });
      }
    }

    for (const { id, n } of usageRowsSchema.parse(emailAnswer)) {
      const old = totals.get(id);

      if (old !== undefined) {
        totals.set(id, {
          ...old,
          emailIntegration: n,
        });
      }
    }

    return totals;
  }

  // Count usage for a single status
  async usageByStatus(id: number): Promise<LeadStatusUsage> {
    const usage = await this.usageByStatuses([id]);

    const found = usage.get(id);

    if (found === undefined) {
      throw new AppError('ERP-INTERNAL-0001', 'Lead status usage could not be counted');
    }

    return found;
  }
}
