/**
 * `/api/v1/uploads` over a real socket (ADR-0041, P-12): a Nest + Fastify app on 127.0.0.1 port 0
 * with `registerTusContentType`, `VolumeStorage` on a temp `FILE_STORAGE_DIR`, a stub verifier and
 * the probe purpose `test.probe`. Driven by `tus-client.ts` over `node:http`. Every refusal is
 * checked for what it leaves behind: no staged bytes under `.tus`, no stored bytes under `probe/`,
 * no purpose side effect.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppConfig } from '../../config/app-config.js';
import { ConfigModule } from '../../config/config.module.js';
import type { Env } from '../../config/env.schema.js';
import { AppError } from '../../errors/app-error.js';
import { ProblemDetailsFilter, PROBLEM_CONTENT_TYPE } from '../../errors/problem-details.filter.js';
import { API_PREFIX, UNPREFIXED_ROUTES } from '../../http/api-prefix.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
  type AuthenticatedUser,
} from '../../http/auth/access-token-verifier.js';
import { registerRequestId } from '../../http/request-id.js';
import { LoggerModule } from '../../logger/logger.module.js';
import { LoggerService } from '../../logger/logger.service.js';
import { QueueModule } from '../../queue/queue.module.js';
import { StorageModule } from '../../storage/storage.module.js';
import { registerTusContentType } from '../tus-content-type.js';
import {
  UPLOAD_RESOURCE_HEADER,
  UPLOADS_ROUTE,
  UploadPurposeRegistry,
  type CheckedUpload,
  type UploadPurpose,
} from '../upload-purpose.js';
import { UPLOADS_OPTIONS, UploadsService } from '../uploads.service.js';
import { UploadsModule } from '../uploads.module.js';
import { tusCall, uploadMetadata, type TusAnswer } from './tus-client.js';

const PROBE_CODE = 'test.probe.create';
const STAFF = { holder: 11, other: 12, stranger: 13 } as const;
type Who = keyof typeof STAFF;
const BASE = `/${API_PREFIX}/${UPLOADS_ROUTE}`;
const PNG_AND_CSV = ['png', 'csv'];

/** 200 bytes of valid CSV: a header line and 49 rows. */
const CSV_200 = Buffer.from(`a,b\n${'1,2\n'.repeat(49)}`);
const HTML_BYTES = Buffer.from('<!doctype html><html><script>alert(1)</script></html>');

function userOf(staffId: number): AuthenticatedUser {
  return {
    staffId,
    sessionId: `sid-${String(staffId)}`,
    jti: `jti-${String(staffId)}`,
    isAdmin: false,
    roleId: null,
    tokenVersion: 0,
    expiresAt: 4_102_444_800,
  };
}

class StubVerifier implements AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    const staffId = (STAFF as Record<string, number | undefined>)[token];
    return Promise.resolve(staffId === undefined ? null : userOf(staffId));
  }

  hasPermission(staffId: number, code: string): Promise<boolean> {
    return Promise.resolve(staffId !== STAFF.stranger && code === PROBE_CODE);
  }
}

@Global()
@Module({
  providers: [{ provide: ACCESS_TOKEN_VERIFIER, useValue: new StubVerifier() }],
  exports: [ACCESS_TOKEN_VERIFIER],
})
class StubVerifierModule {}

class SilentLogger extends LoggerService {
  override log(): void {
    /* silent */
  }
  override warn(): void {
    /* silent */
  }
  override error(): void {
    /* silent */
  }
}

/** The probe purpose's side effects and its switchable failure. */
const probe = { completed: [] as CheckedUpload[], fail: undefined as Error | undefined };

const PROBE_PURPOSE: UploadPurpose = {
  name: 'test.probe',
  anyOf: [PROBE_CODE],
  storageArea: 'probe',
  rules: () => Promise.resolve({ maxBytes: 1024, maxFiles: 10, extensions: PNG_AND_CSV }),
  onComplete: (upload) => {
    probe.completed.push(upload);
    if (probe.fail !== undefined) return Promise.reject(probe.fail);
    return Promise.resolve({ resourceId: '42' });
  },
};

/** Limits above Fastify's 1 MiB default body limit, for the 2 MiB chunk erp-web sends (ADR-0041 §3). */
const LARGE_PURPOSE: UploadPurpose = {
  name: 'test.large',
  anyOf: [PROBE_CODE],
  storageArea: 'large',
  rules: () => Promise.resolve({ maxBytes: 3 * 1024 * 1024, maxFiles: 1, extensions: ['csv'] }),
  onComplete: () => Promise.resolve({ resourceId: '7' }),
};

interface UploadsTestApp {
  readonly app: NestFastifyApplication;
  readonly port: number;
  readonly dir: string;
  close(): Promise<void>;
}

async function createUploadsApp(expiryMs?: number): Promise<UploadsTestApp> {
  const dir = await mkdtemp(join(tmpdir(), 'erp-uploads-'));
  const env = {
    NODE_ENV: 'test',
    FILE_STORAGE_DIR: dir,
    UPLOAD_MAX_BYTES: 67_108_864,
    UPLOAD_MAX_FILES: 10,
  } as unknown as Env;
  let builder = Test.createTestingModule({
    imports: [
      ConfigModule,
      LoggerModule,
      StorageModule,
      StubVerifierModule,
      // UploadsModule's cleanup processor registers with the queue; no REDIS_URL, so nothing connects.
      QueueModule.forRoot({ runWorkers: false }),
      UploadsModule,
    ],
  })
    .overrideProvider(AppConfig)
    .useValue({ env })
    .overrideProvider(LoggerService)
    .useValue(new SilentLogger());
  if (expiryMs !== undefined) {
    builder = builder.overrideProvider(UPLOADS_OPTIONS).useValue({ expiryMs });
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  registerRequestId(app);
  registerTusContentType(app);
  app.setGlobalPrefix(API_PREFIX, { exclude: [...UNPREFIXED_ROUTES] });
  app.useGlobalFilters(new ProblemDetailsFilter(new SilentLogger()));
  app.get(UploadPurposeRegistry).register(PROBE_PURPOSE);
  app.get(UploadPurposeRegistry).register(LARGE_PURPOSE);
  await app.listen(0, '127.0.0.1');
  const { port } = app.getHttpServer().address() as AddressInfo;
  return {
    app,
    port,
    dir,
    close: async () => {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** Every file (not folder) under `dir`, relative; `[]` when it does not exist. */
async function filesUnder(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
}

const codeOf = (answer: TusAnswer): unknown => (JSON.parse(answer.body) as { code?: unknown }).code;

describe('/api/v1/uploads (tus 1.0.0, ADR-0041)', () => {
  let ctx: UploadsTestApp;
  const staging = (): Promise<string[]> => filesUnder(join(ctx.dir, '.tus'));
  const stored = (): Promise<string[]> => filesUnder(join(ctx.dir, 'probe'));

  const bearer = (who: Who): Record<string, string> => ({ authorization: `Bearer ${who}` });

  const create = (
    who: Who | undefined,
    meta: Record<string, string>,
    extra: Record<string, string> = { 'Upload-Length': '200' },
  ): Promise<TusAnswer> =>
    tusCall(ctx.port, 'POST', BASE, {
      ...(who === undefined ? {} : bearer(who)),
      'Upload-Metadata': uploadMetadata(meta),
      ...extra,
    });

  const idOf = (answer: TusAnswer): string => {
    const location = String(answer.headers.location);
    return location.slice(location.lastIndexOf('/') + 1);
  };

  const patch = (who: Who, id: string, offset: number, bytes: Buffer): Promise<TusAnswer> =>
    tusCall(
      ctx.port,
      'PATCH',
      `${BASE}/${id}`,
      {
        ...bearer(who),
        'Upload-Offset': String(offset),
        'Content-Type': 'application/offset+octet-stream',
      },
      bytes,
    );

  /** Creates and sends `bytes` in one PATCH; answers the final PATCH. */
  const upload = async (filename: string, bytes: Buffer): Promise<TusAnswer> => {
    const created = await create(
      'holder',
      { purpose: 'test.probe', filename },
      { 'Upload-Length': String(bytes.length) },
    );
    expect(created.status).toBe(201);
    return patch('holder', idOf(created), 0, bytes);
  };

  beforeAll(async () => {
    ctx = await createUploadsApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    probe.completed = [];
    probe.fail = undefined;
    // Each case starts from an empty volume and asserts what it leaves itself.
    await rm(join(ctx.dir, 'probe'), { recursive: true, force: true });
    await rm(join(ctx.dir, 'large'), { recursive: true, force: true });
    await rm(join(ctx.dir, '.tus'), { recursive: true, force: true });
  });

  describe('creation refusals, before any byte', () => {
    it.each([
      [
        'no bearer',
        undefined,
        { purpose: 'test.probe', filename: 'rows.csv' },
        {},
        401,
        'ERP-AUTH-0004',
      ],
      [
        'a caller without the code',
        'stranger',
        { purpose: 'test.probe', filename: 'rows.csv' },
        {},
        403,
        'ERP-AUTH-0005',
      ],
      [
        'an unknown purpose',
        'holder',
        { purpose: 'test.nothing', filename: 'rows.csv' },
        {},
        400,
        'ERP-VALIDATION-0001',
      ],
      ['no filename', 'holder', { purpose: 'test.probe' }, {}, 400, 'ERP-VALIDATION-0001'],
      [
        'a deferred length',
        'holder',
        { purpose: 'test.probe', filename: 'rows.csv' },
        { 'Upload-Defer-Length': '1' },
        400,
        'ERP-VALIDATION-0001',
      ],
      [
        'an extension the purpose does not allow',
        'holder',
        { purpose: 'test.probe', filename: 'x.exe' },
        {},
        422,
        'ERP-FILES-0001',
      ],
      [
        'a length above the purpose limit',
        'holder',
        { purpose: 'test.probe', filename: 'rows.csv' },
        { 'Upload-Length': '2048' },
        413,
        'ERP-FILES-0002',
      ],
    ] as const)(
      'refuses %s and stages nothing',
      async (_label, who, meta, headers, status, code) => {
        const extra =
          'Upload-Defer-Length' in headers ? headers : { 'Upload-Length': '200', ...headers };
        const answer = await create(who, meta, extra);
        expect(answer.status).toBe(status);
        expect(answer.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
        expect(codeOf(answer)).toBe(code);
        expect(await staging()).toEqual([]);
      },
    );
  });

  it('stamps the staff id from the token over a client staffId value and header', async () => {
    const created = await create(
      'holder',
      { purpose: 'test.probe', filename: 'rows.csv', staffId: '999' },
      { 'Upload-Length': '200', 'x-erp-staff-id': '999' },
    );
    expect(created.status).toBe(201);
    const id = idOf(created);
    const info = JSON.parse(await readFile(join(ctx.dir, '.tus', `${id}.json`), 'utf8')) as {
      metadata: Record<string, string>;
    };
    expect(info.metadata.staffId).toBe(String(STAFF.holder));
    expect((await tusCall(ctx.port, 'DELETE', `${BASE}/${id}`, bearer('holder'))).status).toBe(204);
  });

  it('resumes from its offset with the creation metadata, then stores and completes once', async () => {
    const created = await create('holder', {
      purpose: 'test.probe',
      filename: 'rows.csv',
      relType: 'probe',
    });
    expect(created.status).toBe(201);
    const id = idOf(created);
    const first = await patch('holder', id, 0, CSV_200.subarray(0, 100));
    expect(first.status).toBe(204);
    const head = await tusCall(ctx.port, 'HEAD', `${BASE}/${id}`, bearer('holder'));
    expect(head.status).toBe(200);
    expect(head.headers['upload-offset']).toBe('100');
    expect(String(head.headers['upload-metadata'])).toContain(
      `filename ${Buffer.from('rows.csv').toString('base64')}`,
    );
    expect(probe.completed).toEqual([]);

    const last = await patch('holder', id, 100, CSV_200.subarray(100));
    expect(last.status).toBe(204);
    expect(last.headers[UPLOAD_RESOURCE_HEADER.toLowerCase()]).toBe('42');
    expect(probe.completed).toHaveLength(1);
    const done = probe.completed[0];
    expect(done).toMatchObject({
      uploadId: id,
      purpose: 'test.probe',
      staffId: STAFF.holder,
      fileName: 'rows.csv',
      size: 200,
      mime: 'text/csv',
      extension: 'csv',
      meta: { relType: 'probe' },
    });
    expect(done?.storageKey).toMatch(/^probe\/\d{4}\/\d{2}\/[0-9a-f-]{36}$/);
    const bytes = await readFile(join(ctx.dir, ...(done?.storageKey ?? '').split('/')));
    expect(bytes.equals(CSV_200)).toBe(true);
    expect(await staging()).toEqual([]);
  });

  it.each(['HEAD', 'PATCH', 'DELETE'])(
    "answers another staff member's %s with 404 ERP-CORE-0004",
    async (method) => {
      const created = await create('holder', { purpose: 'test.probe', filename: 'rows.csv' });
      const id = idOf(created);
      const answer =
        method === 'PATCH'
          ? await patch('other', id, 0, CSV_200)
          : await tusCall(ctx.port, method, `${BASE}/${id}`, bearer('other'));
      expect(answer.status).toBe(404);
      if (method !== 'HEAD') expect(codeOf(answer)).toBe('ERP-CORE-0004');
      expect(await staging()).toContain(id);
      expect((await tusCall(ctx.port, 'DELETE', `${BASE}/${id}`, bearer('holder'))).status).toBe(
        204,
      );
    },
  );

  it('refuses HTML bytes declared png with 422 ERP-FILES-0001 and keeps nothing', async () => {
    const answer = await upload('x.png', HTML_BYTES);
    expect(answer.status).toBe(422);
    expect(answer.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
    expect(codeOf(answer)).toBe('ERP-FILES-0001');
    expect(probe.completed).toEqual([]);
    expect(await stored()).toEqual([]);
    expect(await staging()).toEqual([]);
  });

  it('accepts a chunk above the Fastify body limit: the chunk reaches tus unread', async () => {
    const bytes = Buffer.from(`a,b\n${'1,2\n'.repeat(655_360)}`);
    expect(bytes.length).toBeGreaterThan(2 * 1024 * 1024);
    const created = await create(
      'holder',
      { purpose: 'test.large', filename: 'big.csv' },
      { 'Upload-Length': String(bytes.length) },
    );
    expect(created.status).toBe(201);
    const answer = await patch('holder', idOf(created), 0, bytes);
    expect(answer.status).toBe(204);
    expect(answer.headers[UPLOAD_RESOURCE_HEADER.toLowerCase()]).toBe('7');
    expect(await filesUnder(join(ctx.dir, 'large'))).toHaveLength(1);
    expect(await staging()).toEqual([]);
  });

  it("removes the holder's staged upload on DELETE", async () => {
    const created = await create('holder', { purpose: 'test.probe', filename: 'rows.csv' });
    await patch('holder', idOf(created), 0, CSV_200.subarray(0, 50));
    const answer = await tusCall(ctx.port, 'DELETE', `${BASE}/${idOf(created)}`, bearer('holder'));
    expect(answer.status).toBe(204);
    expect(await staging()).toEqual([]);
  });

  describe('a purpose whose onComplete fails', () => {
    it.each([
      ['ERP-CORE-0004', new AppError('ERP-CORE-0004'), 404],
      ['ERP-VALIDATION-0001', new AppError('ERP-VALIDATION-0001', 'relId is not a number'), 400],
      ['ERP-AUTH-0005', new AppError('ERP-AUTH-0005'), 403],
    ])(
      'answers %s with its own status and deletes the stored bytes',
      async (code, error, status) => {
        probe.fail = error;
        const answer = await upload('rows.csv', CSV_200);
        expect(answer.status).toBe(status);
        expect(answer.headers['content-type']).toContain(PROBLEM_CONTENT_TYPE);
        expect(codeOf(answer)).toBe(code);
        expect(probe.completed).toHaveLength(1);
        expect(await stored()).toEqual([]);
        expect(await staging()).toEqual([]);
      },
    );

    it('answers any other error as 500 ERP-INTERNAL-0001 without its message', async () => {
      probe.fail = new Error('boom');
      const answer = await upload('rows.csv', CSV_200);
      expect(answer.status).toBe(500);
      expect(codeOf(answer)).toBe('ERP-INTERNAL-0001');
      expect(answer.body).not.toContain('boom');
      expect(await stored()).toEqual([]);
      expect(await staging()).toEqual([]);
    });
  });

  describe('GET /api/v1/uploads/rules/:purpose', () => {
    it('answers the purpose rules to a holder', async () => {
      const answer = await tusCall(ctx.port, 'GET', `${BASE}/rules/test.probe`, bearer('holder'));
      expect(answer.status).toBe(200);
      expect(JSON.parse(answer.body)).toEqual({
        purpose: 'test.probe',
        maxBytes: 1024,
        maxFiles: 10,
        extensions: PNG_AND_CSV,
      });
    });

    it('refuses a caller without the code with 403', async () => {
      const answer = await tusCall(ctx.port, 'GET', `${BASE}/rules/test.probe`, bearer('stranger'));
      expect(answer.status).toBe(403);
      expect(codeOf(answer)).toBe('ERP-AUTH-0005');
    });

    it('answers an unknown purpose with 404', async () => {
      const answer = await tusCall(ctx.port, 'GET', `${BASE}/rules/test.nothing`, bearer('holder'));
      expect(answer.status).toBe(404);
      expect(codeOf(answer)).toBe('ERP-CORE-0004');
    });
  });
});

describe('UploadsService.cleanUpExpired', () => {
  it('removes an incomplete upload past its expiry and counts it', async () => {
    const ctx = await createUploadsApp(1);
    try {
      const created = await tusCall(ctx.port, 'POST', BASE, {
        authorization: 'Bearer holder',
        'Upload-Length': '200',
        'Upload-Metadata': uploadMetadata({ purpose: 'test.probe', filename: 'rows.csv' }),
      });
      expect(created.status).toBe(201);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await expect(ctx.app.get(UploadsService).cleanUpExpired()).resolves.toBe(1);
      expect(await filesUnder(join(ctx.dir, '.tus'))).toEqual([]);
    } finally {
      await ctx.close();
    }
  });
});
