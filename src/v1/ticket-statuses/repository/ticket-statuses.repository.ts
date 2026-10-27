import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import type {
  NewTicketStatus,
  TicketStatus,
  TicketStatusPatch,
} from '../model/ticket-statuses.model.js';

const RECORD_NOT_FOUND = 'P2025';

const COLUMNS = {
  ticketstatusid: true,
  name: true,
  isdefault: true,
  statuscolor: true,
  statusorder: true,
} as const;

const rowSchema = z.object({
  ticketstatusid: z.number().int(),
  name: z.string(),
  isdefault: z.number().int(),
  statuscolor: z.string().nullable(),
  statusorder: z.number().int().nullable(),
});

const rowsSchema = z.array(rowSchema);

function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === RECORD_NOT_FOUND
  );
}

@Injectable()
export class TicketStatusesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<readonly TicketStatus[]> {
    const statuses = rowsSchema.parse(
      await this.prisma.client.tbltickets_status.findMany({
        orderBy: [{ statusorder: 'asc' }, { ticketstatusid: 'asc' }],
        select: COLUMNS,
      }),
    );

    const counts = await this.prisma.client.tbltickets.groupBy({
      by: ['status'],
      _count: { _all: true },
    });

    const countByStatus = new Map(counts.map((row) => [row.status, row._count._all]));

    return statuses.map((status) => ({
      ...status,
      ticket_count: countByStatus.get(status.ticketstatusid) ?? 0,
    }));
  }

  async findById(id: number): Promise<TicketStatus | null> {
    const row = await this.prisma.client.tbltickets_status.findFirst({
      where: { ticketstatusid: id },
      select: COLUMNS,
    });

    if (row === null) return null;

    const status = rowSchema.parse(row);
    const ticket_count = await this.prisma.client.tbltickets.count({
      where: { status: id },
    });

    return { ...status, ticket_count };
  }

  async create(input: NewTicketStatus): Promise<TicketStatus> {
    const row = await this.prisma.client.tbltickets_status.create({
      data: input,
      select: COLUMNS,
    });

    return { ...rowSchema.parse(row), ticket_count: 0 };
  }

  async update(id: number, patch: TicketStatusPatch): Promise<TicketStatus | null> {
    try {
      const row = await this.prisma.client.tbltickets_status.update({
        where: { ticketstatusid: id },
        data: patch,
        select: COLUMNS,
      });

      const status = rowSchema.parse(row);
      const ticket_count = await this.prisma.client.tbltickets.count({
        where: { status: id },
      });

      return { ...status, ticket_count };
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /** True if any ticket still uses this status. */
  async hasTicketReferences(id: number): Promise<boolean> {
    return (
      (await this.prisma.client.tbltickets.count({
        where: { status: id },
      })) > 0
    );
  }

  /** Deletes by id and returns false if the row no longer exists. */
  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tbltickets_status.deleteMany({
      where: { ticketstatusid: id },
    });

    return count > 0;
  }
}
