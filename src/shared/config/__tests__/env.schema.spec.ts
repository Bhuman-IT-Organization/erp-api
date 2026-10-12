import { describe, expect, it } from 'vitest';
import { envSchema } from '../env.schema.js';

/** A complete, valid development environment. Literal values only — never the real environment. */
const valid = {
  NODE_ENV: 'development',
  DATABASE_URL: 'mysql://erp:secret@127.0.0.1:33061/erp',
  REDIS_URL: 'redis://127.0.0.1:63791/0',
  LEGACY_BASE_URL: 'http://127.0.0.1:8080',
  AUTH_JWT_PRIVATE_KEY_PEM: 'LS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0t',
  FILE_STORAGE_DIR: '../erp-infra/.local/files',
  PUBLIC_BASE_URL: 'http://localhost:8088',
};

function without(key: keyof typeof valid): Record<string, string> {
  return Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key));
}

function issuePaths(result: ReturnType<typeof envSchema.safeParse>): string[] {
  return result.success ? [] : result.error.issues.map((i) => i.path.join('.'));
}

describe('envSchema', () => {
  it('parses a full env: AUTH_COOKIE_SECURE=false becomes boolean, AUTH_* defaults apply', () => {
    const result = envSchema.safeParse({ ...valid, AUTH_COOKIE_SECURE: 'false' });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.AUTH_COOKIE_SECURE).toBe(false);
    expect(result.data.AUTH_REDIS_DB).toBe(1);
    expect(result.data.AUTH_JWT_ISSUER).toBe('erp-api');
    expect(result.data.AUTH_JWT_AUDIENCE).toBe('erp-web');
    expect(result.data.RESILIENCE_BREAKER_HALF_OPEN_AFTER_MS).toBeUndefined();
  });

  it('defaults AUTH_COOKIE_SECURE to true', () => {
    const result = envSchema.safeParse(valid);
    expect(result.success && result.data.AUTH_COOKIE_SECURE).toBe(true);
  });

  it('refuses a missing REDIS_URL when NODE_ENV=development', () => {
    const result = envSchema.safeParse(without('REDIS_URL'));
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('REDIS_URL');
  });

  it('accepts a missing REDIS_URL when NODE_ENV=test', () => {
    expect(envSchema.safeParse({ ...without('REDIS_URL'), NODE_ENV: 'test' }).success).toBe(true);
  });

  it('refuses a missing AUTH_JWT_PRIVATE_KEY_PEM', () => {
    const result = envSchema.safeParse(without('AUTH_JWT_PRIVATE_KEY_PEM'));
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('AUTH_JWT_PRIVATE_KEY_PEM');
  });

  it('still refuses OWNERSHIP_GUARD=off outside production (regression)', () => {
    const result = envSchema.safeParse({ ...valid, OWNERSHIP_GUARD: 'off' });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('OWNERSHIP_GUARD');
  });

  it('requires LEGACY_BASE_URL outside NODE_ENV=test', () => {
    const rest = without('LEGACY_BASE_URL');
    const dev = envSchema.safeParse(rest);
    expect(dev.success).toBe(false);
    expect(issuePaths(dev)).toContain('LEGACY_BASE_URL');
    expect(envSchema.safeParse({ ...rest, NODE_ENV: 'test' }).success).toBe(true);
  });

  it('parses RESILIENCE_BREAKER_* outside production and refuses them in production', () => {
    const dev = envSchema.safeParse({ ...valid, RESILIENCE_BREAKER_HALF_OPEN_AFTER_MS: '3000' });
    expect(dev.success && dev.data.RESILIENCE_BREAKER_HALF_OPEN_AFTER_MS).toBe(3000);

    const prod = envSchema.safeParse({
      ...valid,
      NODE_ENV: 'production',
      RESILIENCE_BREAKER_HALF_OPEN_AFTER_MS: '3000',
    });
    expect(prod.success).toBe(false);
    expect(issuePaths(prod)).toContain('RESILIENCE_BREAKER_HALF_OPEN_AFTER_MS');
  });

  it.each(['development', 'production'])(
    'requires FILE_STORAGE_DIR when NODE_ENV=%s (ADR-0041)',
    (nodeEnv) => {
      const result = envSchema.safeParse({ ...without('FILE_STORAGE_DIR'), NODE_ENV: nodeEnv });
      expect(result.success).toBe(false);
      expect(issuePaths(result)).toContain('FILE_STORAGE_DIR');
    },
  );

  it('accepts a missing FILE_STORAGE_DIR when NODE_ENV=test', () => {
    const result = envSchema.safeParse({ ...without('FILE_STORAGE_DIR'), NODE_ENV: 'test' });
    expect(result.success).toBe(true);
    expect(result.success && result.data.FILE_STORAGE_DIR).toBeUndefined();
  });

  it('defaults the upload limits to 64 MB and 10 files (P-11)', () => {
    const result = envSchema.safeParse(valid);
    expect(result.success && result.data.UPLOAD_MAX_BYTES).toBe(67_108_864);
    expect(result.success && result.data.UPLOAD_MAX_FILES).toBe(10);
    expect(result.success && result.data.FILE_STORAGE_DIR).toBe('../erp-infra/.local/files');
  });

  it.each([
    ['UPLOAD_MAX_BYTES', '0'],
    ['UPLOAD_MAX_BYTES', '1073741825'],
    ['UPLOAD_MAX_FILES', '0'],
    ['UPLOAD_MAX_FILES', '51'],
  ])('refuses %s=%s', (key, value) => {
    const result = envSchema.safeParse({ ...valid, [key]: value });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain(key);
  });

  it('accepts the upload limits at their bounds', () => {
    const low = envSchema.safeParse({ ...valid, UPLOAD_MAX_BYTES: '1', UPLOAD_MAX_FILES: '1' });
    expect(low.success).toBe(true);
    const high = envSchema.safeParse({
      ...valid,
      UPLOAD_MAX_BYTES: '1073741824',
      UPLOAD_MAX_FILES: '50',
    });
    expect(high.success && high.data.UPLOAD_MAX_BYTES).toBe(1_073_741_824);
  });

  it('defaults QUEUE_REDIS_DB to 2 and DB_POOL_ROLE to api (BE-14, ADR-0031 §4)', () => {
    const result = envSchema.safeParse(valid);
    expect(result.success && result.data.QUEUE_REDIS_DB).toBe(2);
    expect(result.success && result.data.DB_POOL_ROLE).toBe('api');
    const worker = envSchema.safeParse({ ...valid, DB_POOL_ROLE: 'worker' });
    expect(worker.success && worker.data.DB_POOL_ROLE).toBe('worker');
  });

  it('refuses QUEUE_REDIS_DB equal to AUTH_REDIS_DB (T-4.2-33)', () => {
    const result = envSchema.safeParse({ ...valid, AUTH_REDIS_DB: '1', QUEUE_REDIS_DB: '1' });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('QUEUE_REDIS_DB');
  });

  it("refuses QUEUE_REDIS_DB equal to the cache database in REDIS_URL's path (T-4.2-33)", () => {
    const result = envSchema.safeParse({
      ...valid,
      REDIS_URL: 'redis://h:6379/0',
      QUEUE_REDIS_DB: '0',
    });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('QUEUE_REDIS_DB');
    const noPath = envSchema.safeParse({
      ...valid,
      REDIS_URL: 'redis://h:6379',
      QUEUE_REDIS_DB: '0',
    });
    expect(issuePaths(noPath)).toContain('QUEUE_REDIS_DB');
    const other = envSchema.safeParse({
      ...valid,
      REDIS_URL: 'redis://h:6379/3',
      QUEUE_REDIS_DB: '0',
    });
    expect(other.success).toBe(true);
  });

  it('reads MODULES_DISABLED as a module list, empty by default, and refuses an unknown name (ADR-0042)', () => {
    const absent = envSchema.safeParse(valid);
    expect(absent.success && absent.data.MODULES_DISABLED).toEqual([]);
    const blank = envSchema.safeParse({ ...valid, MODULES_DISABLED: ' , ' });
    expect(blank.success && blank.data.MODULES_DISABLED).toEqual([]);
    const typo = envSchema.safeParse({ ...valid, MODULES_DISABLED: 'unknown' });
    expect(typo.success).toBe(false);
    expect(issuePaths(typo)).toEqual(['MODULES_DISABLED']);
    expect(typo.success ? '' : typo.error.issues[0]?.message).toBe(
      'MODULES_DISABLED names an unknown module: unknown (known: none)',
    );
  });

  it('refuses DB_POOL_ROLE=other', () => {
    const result = envSchema.safeParse({ ...valid, DB_POOL_ROLE: 'other' });
    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain('DB_POOL_ROLE');
  });

  it('accepts a production env without the breaker overrides', () => {
    expect(
      envSchema.safeParse({ ...valid, NODE_ENV: 'production', OWNERSHIP_GUARD: 'off' }).success,
    ).toBe(true);
  });

  describe('SMTP and PUBLIC_BASE_URL (D-02, ADR-0049)', () => {
    /** A complete SMTP set; synthetic values only. */
    const smtp = {
      SMTP_HOST: 'smtp.example.test',
      SMTP_PORT: '587',
      SMTP_ENCRYPTION: 'tls',
      MAIL_FROM_ADDRESS: 'no-reply@erp.local.test',
      MAIL_FROM_NAME: 'ERP',
    };
    const credentials = { SMTP_USERNAME: 'user@example.test', SMTP_PASSWORD: 'pw-not-a-secret' };

    function messages(result: ReturnType<typeof envSchema.safeParse>): string[] {
      return result.success ? [] : result.error.issues.map((i) => i.message);
    }

    it('parses NODE_ENV=test with no SMTP variable: every SMTP field is undefined', () => {
      const result = envSchema.safeParse({
        ...without('PUBLIC_BASE_URL'),
        NODE_ENV: 'test',
      });
      expect(result.success).toBe(true);
      if (!result.success) return;
      for (const key of [
        'SMTP_HOST',
        'SMTP_PORT',
        'SMTP_ENCRYPTION',
        'SMTP_USERNAME',
        'SMTP_PASSWORD',
        'MAIL_FROM_ADDRESS',
        'MAIL_FROM_NAME',
        'PUBLIC_BASE_URL',
      ] as const) {
        expect(result.data[key], key).toBeUndefined();
      }
    });

    it('parses a complete SMTP set with credentials', () => {
      const result = envSchema.safeParse({ ...valid, ...smtp, ...credentials });
      expect(result.success).toBe(true);
      if (!result.success) return;
      expect(result.data.SMTP_PORT).toBe(587);
      expect(result.data.SMTP_ENCRYPTION).toBe('tls');
      expect(result.data.PUBLIC_BASE_URL).toBe('http://localhost:8088');
    });

    it('refuses SMTP_HOST alone, naming the four missing fields with the exact messages', () => {
      const result = envSchema.safeParse({ ...valid, SMTP_HOST: 'h' });
      expect(result.success).toBe(false);
      expect(issuePaths(result).sort()).toEqual(
        ['MAIL_FROM_ADDRESS', 'MAIL_FROM_NAME', 'SMTP_ENCRYPTION', 'SMTP_PORT'].sort(),
      );
      expect(messages(result).sort()).toEqual(
        [
          'SMTP_PORT is required when SMTP_HOST is set (D-02)',
          'SMTP_ENCRYPTION is required when SMTP_HOST is set (D-02)',
          'MAIL_FROM_ADDRESS is required when SMTP_HOST is set (D-02)',
          'MAIL_FROM_NAME is required when SMTP_HOST is set (D-02)',
        ].sort(),
      );
    });

    it('refuses SMTP_PORT without SMTP_HOST with the all-or-none message', () => {
      const result = envSchema.safeParse({ ...valid, SMTP_PORT: '25' });
      expect(result.success).toBe(false);
      expect(issuePaths(result)).toEqual(['SMTP_HOST']);
      expect(messages(result)).toEqual([
        'SMTP_HOST is required when any SMTP_ or MAIL_FROM_ variable is set (D-02: SMTP is all or none)',
      ]);
    });

    it('refuses SMTP_USERNAME without SMTP_PASSWORD', () => {
      const result = envSchema.safeParse({ ...valid, ...smtp, SMTP_USERNAME: 'user@example.test' });
      expect(result.success).toBe(false);
      expect(issuePaths(result)).toEqual(['SMTP_PASSWORD']);
      expect(messages(result)).toEqual(['SMTP_PASSWORD is required when SMTP_USERNAME is set']);
    });

    it('refuses SMTP_PASSWORD without SMTP_USERNAME', () => {
      const result = envSchema.safeParse({ ...valid, ...smtp, SMTP_PASSWORD: 'pw-not-a-secret' });
      expect(result.success).toBe(false);
      expect(issuePaths(result)).toEqual(['SMTP_PASSWORD']);
      expect(messages(result)).toEqual(['SMTP_PASSWORD is set without SMTP_USERNAME']);
    });

    it.each([
      ['SMTP_PORT', '0'],
      ['SMTP_PORT', '70000'],
      ['SMTP_ENCRYPTION', 'starttls'],
      ['MAIL_FROM_ADDRESS', 'not-an-address'],
    ])('refuses %s=%s', (key, value) => {
      const result = envSchema.safeParse({ ...valid, ...smtp, [key]: value });
      expect(result.success).toBe(false);
      expect(issuePaths(result)).toContain(key);
    });

    it('refuses SMTP_ENCRYPTION=none with SMTP_USERNAME in production; tls is accepted (T-4.3-07)', () => {
      const prod = { ...valid, ...smtp, ...credentials, NODE_ENV: 'production' };
      const none = envSchema.safeParse({ ...prod, SMTP_ENCRYPTION: 'none' });
      expect(none.success).toBe(false);
      expect(issuePaths(none)).toEqual(['SMTP_ENCRYPTION']);
      expect(messages(none)).toEqual([
        'SMTP_ENCRYPTION=none with SMTP_USERNAME would send credentials in clear; production requires ssl or tls (ADR-0049)',
      ]);
      expect(envSchema.safeParse({ ...prod, SMTP_ENCRYPTION: 'tls' }).success).toBe(true);
    });

    it('accepts SMTP_ENCRYPTION=none with a username in development (local relays)', () => {
      const result = envSchema.safeParse({
        ...valid,
        ...smtp,
        ...credentials,
        SMTP_ENCRYPTION: 'none',
      });
      expect(result.success).toBe(true);
    });

    it.each(['development', 'production'])(
      'requires PUBLIC_BASE_URL when NODE_ENV=%s (C6)',
      (nodeEnv) => {
        const result = envSchema.safeParse({ ...without('PUBLIC_BASE_URL'), NODE_ENV: nodeEnv });
        expect(result.success).toBe(false);
        expect(issuePaths(result)).toEqual(['PUBLIC_BASE_URL']);
        expect(messages(result)).toEqual([
          'PUBLIC_BASE_URL is required (email links and the logo are absolute, ADR-0049); only NODE_ENV=test may omit it',
        ]);
      },
    );

    it.each(['ftp://x', 'http://x/app', 'http://x?a=1', 'http://x#top'])(
      'refuses PUBLIC_BASE_URL=%s',
      (value) => {
        const result = envSchema.safeParse({ ...valid, PUBLIC_BASE_URL: value });
        expect(result.success).toBe(false);
        expect(issuePaths(result)).toEqual(['PUBLIC_BASE_URL']);
        expect(messages(result)).toEqual([
          'PUBLIC_BASE_URL must be http or https with no path, query or fragment',
        ]);
      },
    );

    it.each(['http://localhost:8088', 'https://erp.example.test'])(
      'accepts PUBLIC_BASE_URL=%s',
      (value) => {
        const result = envSchema.safeParse({ ...valid, PUBLIC_BASE_URL: value });
        expect(result.success && result.data.PUBLIC_BASE_URL).toBe(value);
      },
    );
  });
});
