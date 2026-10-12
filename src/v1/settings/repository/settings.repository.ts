/**
 * Repository: the only file in this module that touches Prisma. `tbloptions` is `unattributed` in
 * the ownership register and Perfex-owned in practice (its Settings screen and eight legacy
 * writers). It reads the allow-listed options and writes nothing: it never inserts, updates or
 * deletes a row. Every name reaches MySQL as a bound value through the typed delegate's `in`.
 */
import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import type { SettingName, SettingRow } from '../model/settings.model.js';

/** A `tbloptions` row as read: `value` is `LongText` and not null in the mirror. */
const settingRowSchema = z.object({ name: z.string(), value: z.string() });

@Injectable()
export class SettingsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** `tbloptions` rows whose name is in `names`, oldest id first; a missing name is simply absent. */
  async findByNames(names: readonly SettingName[]): Promise<readonly SettingRow[]> {
    const rows = await this.prisma.client.tbloptions.findMany({
      where: { name: { in: [...names] } },
      select: { name: true, value: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => settingRowSchema.parse(row));
  }
}
