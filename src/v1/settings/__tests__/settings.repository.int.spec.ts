/**
 * SettingsRepository and SettingsService against the local mirror (DATABASE_URL from
 * ../erp-infra/env/local/api.host.env). Read only. `tbloptions` holds the customer's settings and,
 * beside them, credentials: every assertion is on SHAPE and NAMES only or compares in code and
 * asserts a boolean, no value read from it appears in this file or in its output, and no count is
 * recorded.
 */
import 'reflect-metadata';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { isSettingName, SETTINGS_ALLOW_LIST } from '../model/settings.model.js';
import { SettingsRepository } from '../repository/settings.repository.js';
import { SettingsService } from '../service/settings.service.js';

describe.skipIf(!process.env.DATABASE_URL)('SettingsRepository against the local mirror', () => {
  const prisma = new PrismaService(new AppConfig(), new HealthService());
  const repository = new SettingsRepository(prisma);

  afterAll(async () => {
    await prisma.client.$disconnect();
  });

  it('findByNames(SETTINGS_ALLOW_LIST) answers parsed rows of listed names only, companyname among them', async () => {
    const rows = await repository.findByNames(SETTINGS_ALLOW_LIST);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(['name', 'value']);
      expect(typeof row.value).toBe('string');
      // MySQL's PAD SPACE collation also answers a name stored with trailing spaces; the service
      // keys it by name.trimEnd().
      expect(isSettingName(row.name.trimEnd())).toBe(true);
    }
    expect(rows.some((row) => row.name === 'companyname')).toBe(true);
  });

  it('the real service refuses default_tax before any query reaches tbloptions', async () => {
    const findMany = vi.spyOn(prisma.client.tbloptions, 'findMany');
    const service = new SettingsService(repository);
    try {
      // @ts-expect-error: default_tax is not on the allow-list (D-22); the runtime check is under test
      const pending = service.getOption('default_tax');
      await expect(pending).rejects.toMatchObject({ code: 'ERP-INTERNAL-0001' });
      expect(findMany).not.toHaveBeenCalled();
      // The spy does see a read: an allowed name reaches the table once.
      await service.getOptions(['companyname']);
      expect(findMany).toHaveBeenCalledTimes(1);
    } finally {
      findMany.mockRestore();
    }
  });
});
