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
    return rowsSchema.parse(
      await this.prisma.client.tbltickets_status.findMany({
        orderBy: [{ statusorder: 'asc' }, { ticketstatusid: 'asc' }],
        select: COLUMNS,
      }),
    );
  }

  async findById(id: number): Promise<TicketStatus | null> {
    const row = await this.prisma.client.tbltickets_status.findFirst({
      where: { ticketstatusid: id },
      select: COLUMNS,
    });
    return row === null ? null : rowSchema.parse(row);
  }

  async create(input: NewTicketStatus): Promise<TicketStatus> {
    const row = await this.prisma.client.tbltickets_status.create({
      data: input,
      select: COLUMNS,
    });
    return rowSchema.parse(row);
  }

  async update(id: number, patch: TicketStatusPatch): Promise<TicketStatus | null> {
    try {
      const row = await this.prisma.client.tbltickets_status.update({
        where: { ticketstatusid: id },
        data: patch,
        select: COLUMNS,
      });
      return rowSchema.parse(row);
    } catch (error) {
      if (isRecordNotFound(error)) return null;
      throw error;
    }
  }

  /** True if any `tbltickets.status` row still names this status; failures propagate. */
  async hasTicketReferences(id: number): Promise<boolean> {
    return (await this.prisma.client.tbltickets.count({ where: { status: id } })) > 0;
  }

  /** Deletes by id and answers false if the row disappeared after the service's checks. */
  async remove(id: number): Promise<boolean> {
    const { count } = await this.prisma.client.tbltickets_status.deleteMany({
      where: { ticketstatusid: id },
    });
    return count > 0;
  }
}
