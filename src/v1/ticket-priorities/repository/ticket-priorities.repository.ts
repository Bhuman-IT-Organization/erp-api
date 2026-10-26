import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/db/prisma.service.js'; // Check Cost Centers for the exact Prisma import path if this gets a red line!

@Injectable()
export class TicketPrioritiesRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return await this.prisma.client.tbltickets_priorities.findMany({
      orderBy: { priorityid: 'desc' },
    });
  }

  async findById(priorityid: number) {
    return await this.prisma.client.tbltickets_priorities.findUnique({
      where: { priorityid },
    });
  }

  async create(data: { name: string }) {
    return await this.prisma.client.tbltickets_priorities.create({ data });
  }

  async update(priorityid: number, data: { name?: string }) {
    return await this.prisma.client.tbltickets_priorities.update({
      where: { priorityid },
      data,
    });
  }

  async delete(priorityid: number) {
    return await this.prisma.client.tbltickets_priorities.delete({
      where: { priorityid },
    });
  }

  async isReferenced(priorityid: number): Promise<boolean> {
    const count = await this.prisma.client.tbltickets.count({
      where: { priority: priorityid },
    });
    return count > 0;
  }
}
