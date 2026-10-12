/**
 * AuthRepository against the local mirror (DATABASE_URL from ../erp-infra/env/local/api.host.env).
 *
 * Pitfall 10 / T-1.3-47: the only rows this spec writes are the `password`, `last_login` and
 * `last_ip` of ONE dedicated row — the active staff member with the highest `staffid` (never
 * staffid 1). `beforeAll` keeps the three original values and `afterAll` restores them
 * byte-for-byte and asserts the restore changed exactly one row. Nothing here prints a hash or an
 * e-mail.
 *
 * Recovery if a run dies between the re-hash and the restore (the row then holds a hash of the
 * throwaway plaintext below): reset that staff member's password on the local database with
 *   node ../erp-infra/legacy-local/reset-password.mjs <email> <password>
 *
 * The last case pipes the re-hashed value through PHP's `crypt()` in the legacy container
 * (`docker compose exec legacy`, run from erp-infra/legacy-local) to prove the label
 * the repository writes is what Perfex's phpass verifies. It is skipped when that directory is
 * not beside this repository.
 */
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { genSaltSync, hashSync } from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppConfig } from '../../../shared/config/app-config.js';
import { HealthService } from '../../../shared/health/health.service.js';
import { PrismaService } from '../../../shared/db/prisma.service.js';
import { AuthRepository } from '../repository/auth.repository.js';
import { PasswordHasher } from '../service/password-hasher.js';

// Measured by plan 01.2-03 against the local legacy stack; the same constant as ownership-guard.int.spec.ts.
const EXPECTED_STAFF_ROWS = 33;
const BCRYPT_LENGTH = 60;
const LEGACY_LABEL_COST_10 = '$2y$10$';
const THROWAWAY_PLAINTEXT = 'int-spec-throwaway-plaintext';
const LEGACY_LOCAL_DIR = resolve(process.cwd(), '../erp-infra/legacy-local');

interface OriginalRow {
  readonly staffid: number;
  readonly email: string;
  readonly password: string;
  readonly last_login: Date | null;
  readonly last_ip: string | null;
}

/** A cost-10 hash under PHP's label, the shape the live rows carry (research Q1). */
function legacyStyleHash(plaintext: string): string {
  return hashSync(plaintext, genSaltSync(10).replace(/^\$2b\$/, '$2y$'));
}

describe.skipIf(!process.env.DATABASE_URL)('AuthRepository against the local mirror', () => {
  const service = new PrismaService(new AppConfig(), new HealthService());
  const { client } = service;
  const repository = new AuthRepository(service);
  const hasher = new PasswordHasher();

  let original: OriginalRow;
  let rehashedValue: string;

  beforeAll(async () => {
    const row = await client.tblstaff.findFirst({
      where: { active: 1 },
      orderBy: { staffid: 'desc' },
      select: { staffid: true, email: true, password: true, last_login: true, last_ip: true },
    });
    if (row === null) throw new Error('no active staff row in the mirror');
    expect(row.staffid).not.toBe(1);
    original = row;
  });

  afterAll(async () => {
    try {
      const { count } = await client.tblstaff.updateMany({
        where: { staffid: original.staffid },
        data: {
          password: original.password,
          last_login: original.last_login,
          last_ip: original.last_ip,
        },
      });
      expect(count).toBe(1);
      const restored = await client.tblstaff.findUnique({
        where: { staffid: original.staffid },
        select: { password: true, last_login: true, last_ip: true },
      });
      expect(restored?.password).toBe(original.password);
      expect(restored?.last_ip).toBe(original.last_ip);
      expect(restored?.last_login?.getTime() ?? null).toBe(original.last_login?.getTime() ?? null);
      expect(await client.tblstaff.count()).toBe(EXPECTED_STAFF_ROWS);
    } finally {
      await service.onModuleDestroy();
    }
  });

  it(`starts from ${String(EXPECTED_STAFF_ROWS)} staff rows`, async () => {
    expect(await client.tblstaff.count()).toBe(EXPECTED_STAFF_ROWS);
  });

  it('findStaffByEmail returns the dedicated row with a 60-character hash', async () => {
    const staff = await repository.findStaffByEmail(original.email.toLowerCase());
    expect(staff?.staffId).toBe(original.staffid);
    expect(staff?.passwordHash).toHaveLength(BCRYPT_LENGTH);
    expect(staff?.active).toBe(true);
    expect(typeof staff?.isAdmin).toBe('boolean');
    expect(typeof staff?.twoFactorEnabled).toBe('boolean');
    // `default_language` is `VARCHAR(40) NULL` (31 empty / 2 `english` locally): `null` or a BCP-47 tag.
    expect(staff?.locale === null || /^[a-z]{2,3}(-[A-Z]{2})?$/.test(staff?.locale ?? '')).toBe(
      true,
    );
  });

  it('findStaffByEmail of an unknown e-mail is null', async () => {
    expect(await repository.findStaffByEmail('nobody@example.invalid')).toBeNull();
  });

  it('findStaffById(-1) is null', async () => {
    expect(await repository.findStaffById(-1)).toBeNull();
  });

  it('findStaffById of the dedicated row matches findStaffByEmail', async () => {
    const byId = await repository.findStaffById(original.staffid);
    const byEmail = await repository.findStaffByEmail(original.email.toLowerCase());
    expect(byId).toEqual(byEmail);
  });

  it('rehashPassword changes exactly one row when the stored hash still matches', async () => {
    const known = legacyStyleHash(THROWAWAY_PLAINTEXT);
    expect(known.startsWith(LEGACY_LABEL_COST_10)).toBe(true);
    const seeded = await client.tblstaff.updateMany({
      where: { staffid: original.staffid },
      data: { password: known },
    });
    expect(seeded.count).toBe(1);

    rehashedValue = await hasher.hash(THROWAWAY_PLAINTEXT);
    expect(await repository.rehashPassword(original.staffid, known, rehashedValue)).toBe(1);

    const after = await repository.findStaffById(original.staffid);
    expect(after?.passwordHash.startsWith(PasswordHasher.TARGET_PREFIX)).toBe(true);
    expect(after?.passwordHash).toBe(rehashedValue);

    // Compare-and-set: the old hash no longer matches, so a second re-hash changes nothing.
    const other = await hasher.hash(THROWAWAY_PLAINTEXT);
    expect(await repository.rehashPassword(original.staffid, known, other)).toBe(0);
    const still = await repository.findStaffById(original.staffid);
    expect(still?.passwordHash).toBe(rehashedValue);
  });

  it('rehashPassword never writes last_password_change', async () => {
    const before = await client.tblstaff.findUnique({
      where: { staffid: original.staffid },
      select: { last_password_change: true },
    });
    await repository.rehashPassword(original.staffid, rehashedValue, rehashedValue);
    const after = await client.tblstaff.findUnique({
      where: { staffid: original.staffid },
      select: { last_password_change: true },
    });
    expect(after?.last_password_change?.getTime() ?? null).toBe(
      before?.last_password_change?.getTime() ?? null,
    );
  });

  it('touchLogin writes last_login and last_ip', async () => {
    const at = new Date();
    at.setMilliseconds(0); // DATETIME(0)
    await repository.touchLogin(original.staffid, '127.0.0.1', at);
    const row = await client.tblstaff.findUnique({
      where: { staffid: original.staffid },
      select: { last_login: true, last_ip: true },
    });
    expect(row?.last_ip).toBe('127.0.0.1');
    expect(row?.last_login?.getTime()).toBe(at.getTime());
  });

  it.skipIf(!existsSync(LEGACY_LOCAL_DIR))(
    "PHP crypt() in the legacy container accepts the re-hashed row (Perfex's phpass path)",
    () => {
      const stored = rehashedValue;
      expect(stored.startsWith(PasswordHasher.TARGET_PREFIX)).toBe(true);
      // The hash and the plaintext travel as environment variables — never on a command line, never in output.
      const out = execFileSync(
        'docker',
        [
          'compose',
          'exec',
          '-T',
          '-e',
          `ERP_INT_HASH=${stored}`,
          '-e',
          `ERP_INT_PLAINTEXT=${THROWAWAY_PLAINTEXT}`,
          'legacy',
          'php',
          '-r',
          'var_dump(crypt(getenv("ERP_INT_PLAINTEXT"), getenv("ERP_INT_HASH")) === getenv("ERP_INT_HASH")); var_dump(crypt("wrong-plaintext", getenv("ERP_INT_HASH")) === getenv("ERP_INT_HASH"));',
        ],
        { cwd: LEGACY_LOCAL_DIR, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
      );
      expect(out.trim().split(/\r?\n/)).toEqual(['bool(true)', 'bool(false)']);
    },
  );
});
