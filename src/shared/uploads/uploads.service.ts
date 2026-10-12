/**
 * Resumable uploads over tus 1.0.0 (ADR-0041, Phase 4.2 P-11, P-12): `@tus/server` with
 * `@tus/file-store` staging under `FILE_STORAGE_DIR/.tus`, the same volume as `STORAGE`, so a
 * checked upload moves into storage by a rename.
 *
 * Creation (`onUploadCreate`, before any byte is staged): a registered purpose (else 400), a
 * caller holding one of its codes (else 403), a file name (400), a declared length (a deferred
 * length is 400), an extension the purpose allows (422 `ERP-FILES-0001`) and a length within the
 * purpose and env limits (413 `ERP-FILES-0002`). The checks read tus's own parse of
 * `Upload-Metadata`, so the purpose checked is always the purpose stored. The creating staff id is
 * stamped into the metadata from the verified token; a client `staffId` key is replaced.
 *
 * Completion (`onUploadFinish`): the size is re-checked and the bytes are sniffed (`sniff.ts`); a
 * failure removes the staged upload and answers 413 or 422, so nothing is stored. A passing file
 * moves into `STORAGE` under `newStorageKey(purpose.storageArea)`, its staged metadata is removed,
 * and then the purpose's `onComplete` runs. If that throws, the stored bytes are deleted first; an
 * `AppError` answers with its own status and problem-details body (`problemBodyOf`), anything else
 * with 500 `ERP-INTERNAL-0001` and no detail (its error name is logged).
 *
 * The staff id reaches the hooks through a WeakMap keyed by the request this service builds, not
 * through a header: nothing a client sends can name the owner (T-4.2-29). A hook refusal is marked
 * the same way, so its answer carries `application/problem+json`; tus's own protocol errors (a
 * missing `Tus-Resumable`, an offset mismatch) keep tus's plain-text bodies, except a size over
 * the env limit, which answers `ERP-FILES-0002` like the purpose limit does.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { FileStore } from '@tus/file-store';
import { Server, type Upload } from '@tus/server';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AppConfig } from '../config/app-config.js';
import { AppError } from '../errors/app-error.js';
import { PROBLEM_CONTENT_TYPE, problemBodyOf } from '../errors/problem-details.filter.js';
import { API_PREFIX } from '../http/api-prefix.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
} from '../http/auth/access-token-verifier.js';
import { LoggerService } from '../logger/logger.service.js';
import { newStorageKey, STORAGE, type StoragePort } from '../storage/storage.port.js';
import { extensionOf, mimeOf, sniffMatches } from './sniff.js';
import {
  UPLOAD_RESOURCE_HEADER,
  UPLOADS_ROUTE,
  UploadPurposeRegistry,
  type CheckedUpload,
  type UploadPurpose,
  type UploadRules,
} from './upload-purpose.js';

/** The service's tunables; the spec shortens the expiry to prove the cleanup. */
export interface UploadsOptions {
  /** How long after creation an incomplete upload expires (`TIMINGS.uploads.incompleteExpiryMs`). */
  readonly expiryMs: number;
}

export const UPLOADS_OPTIONS = Symbol('UPLOADS_OPTIONS');

/** The rules read: what the browser shows and checks before it uploads (K8). */
export interface UploadRulesAnswer extends UploadRules {
  readonly purpose: string;
}

/** What tus writes for a refused hook: it reads `status_code` and `body` from what a hook throws. */
class TusRefusal extends Error {
  override readonly name = 'TusRefusal';

  constructor(
    readonly status_code: number,
    readonly body: string,
  ) {
    super('upload refused');
  }
}

type Metadata = NonNullable<Upload['metadata']>;

const PURPOSE_KEY = 'purpose';
const FILENAME_KEY = 'filename';
const STAFF_KEY = 'staffId';
const RESERVED_KEYS: ReadonlySet<string> = new Set([PURPOSE_KEY, FILENAME_KEY, STAFF_KEY]);
/** tus's default upload id: 16 random bytes as hex. */
const TUS_UPLOAD_ID = /^[0-9a-f]{32}$/;
const STAGING_FOLDER = '.tus';
/** Only the URL's path matters to tus (`relativeLocation`); the origin is a placeholder. */
const LOCAL_ORIGIN = 'http://localhost';
const TOO_LARGE = 413;

/** The client's other metadata keys, strings, without the three this service owns. */
function purposeMetaOf(metadata: Metadata): Record<string, string> {
  return Object.fromEntries(
    Object.entries(metadata)
      .filter(([key]) => !RESERVED_KEYS.has(key))
      .map(([key, value]) => [key, value ?? '']),
  );
}

/** A web `Request` over the raw Node request; the body (a PATCH chunk) is streamed, never buffered. */
function webRequestOf(raw: IncomingMessage): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(raw.headers)) {
    if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const method = raw.method ?? 'GET';
  const streamed = method === 'PATCH' || method === 'POST';
  return new Request(new URL(raw.url ?? '/', LOCAL_ORIGIN), {
    method,
    headers,
    ...(streamed ? { body: Readable.toWeb(raw) as ReadableStream, duplex: 'half' } : {}),
  });
}

/** tus answers are a few headers and at most a problem body, so the body is written whole. */
async function writeResponse(raw: ServerResponse, response: Response, problem: boolean) {
  const headers = Object.fromEntries(response.headers);
  if (problem) headers['content-type'] = PROBLEM_CONTENT_TYPE;
  const body = Buffer.from(await response.arrayBuffer());
  raw.writeHead(response.status, headers);
  raw.end(body);
}

/** The tus server, its staging store, the purpose checks and the hourly cleanup's entry point. */
@Injectable()
export class UploadsService {
  private readonly tus: { readonly server: Server; readonly store: FileStore } | null;
  private readonly maxBytes: number;
  private readonly stagingDir: string;
  private readonly maxFiles: number;
  private readonly callers = new WeakMap<Request, number>();
  private readonly problems = new WeakSet<Request>();

  constructor(
    config: AppConfig,
    private readonly registry: UploadPurposeRegistry,
    @Inject(STORAGE) private readonly storage: StoragePort,
    @Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier,
    private readonly logger: LoggerService,
    @Inject(UPLOADS_OPTIONS) options: UploadsOptions,
  ) {
    this.maxBytes = config.env.UPLOAD_MAX_BYTES;
    this.maxFiles = config.env.UPLOAD_MAX_FILES;
    const dir = config.env.FILE_STORAGE_DIR;
    this.stagingDir = join(dir ?? '', STAGING_FOLDER);
    if (dir === undefined) {
      this.tus = null;
      return;
    }
    const store = new FileStore({
      directory: this.stagingDir,
      expirationPeriodInMilliseconds: options.expiryMs,
    });
    const server = new Server({
      path: `/${API_PREFIX}/${UPLOADS_ROUTE}`,
      datastore: store,
      relativeLocation: true,
      maxSize: this.maxBytes,
      onUploadCreate: (req, upload) => this.hook(req, () => this.created(req, upload)),
      onUploadFinish: (req, upload) => this.hook(req, () => this.finished(upload)),
      onResponseError: (req, error) => this.tusError(req, error),
    });
    this.tus = { server, store };
  }

  /** Hands the request to tus and writes its answer; the reply is hijacked from Fastify. */
  async serve(request: FastifyRequest, reply: FastifyReply, staffId: number): Promise<void> {
    const { server } = this.configured();
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      if (value !== undefined) reply.raw.setHeader(name, value);
    }
    reply.hijack();
    const web = webRequestOf(request.raw);
    this.callers.set(web, staffId);
    try {
      await writeResponse(reply.raw, await server.handleWeb(web), this.problems.has(web));
    } catch (error) {
      this.logger.error('upload answer failed', { errorName: (error as Error | null)?.name });
      reply.raw.destroy();
    }
  }

  /** 404 `ERP-CORE-0004` unless `uploadId` is a staged upload `staffId` created. */
  async assertOwner(uploadId: string, staffId: number): Promise<void> {
    if (!TUS_UPLOAD_ID.test(uploadId)) throw new AppError('ERP-CORE-0004');
    const staged = await this.configured().store.configstore.get(uploadId);
    if (staged?.metadata?.[STAFF_KEY] !== String(staffId)) throw new AppError('ERP-CORE-0004');
  }

  /** The rules of a purpose for its caller: 404 unknown, 403 without one of its codes. */
  async rulesOf(purposeName: string, staffId: number): Promise<UploadRulesAnswer> {
    const purpose = this.registry.get(purposeName);
    if (purpose === undefined) throw new AppError('ERP-CORE-0004');
    await this.assertHolds(staffId, purpose);
    return { purpose: purpose.name, ...(await this.rulesFor(purpose, staffId)) };
  }

  /** Removes incomplete uploads past their expiry; answers how many (plan 04's hourly job). */
  cleanUpExpired(): Promise<number> {
    return this.configured().server.cleanUpExpiredUploads();
  }

  private configured(): { readonly server: Server; readonly store: FileStore } {
    if (this.tus === null) throw new Error('FILE_STORAGE_DIR is not set');
    return this.tus;
  }

  private async created(req: Request, upload: Upload): Promise<{ metadata: Metadata }> {
    const staffId = this.callers.get(req);
    if (staffId === undefined) throw new AppError('ERP-AUTH-0004');
    const metadata = upload.metadata ?? {};
    const purpose = this.registry.get(metadata[PURPOSE_KEY] ?? '');
    if (purpose === undefined) throw new AppError('ERP-VALIDATION-0001', 'Unknown upload purpose');
    await this.assertHolds(staffId, purpose);
    await this.assertDeclared(purpose, staffId, metadata[FILENAME_KEY] ?? '', upload.size);
    return { metadata: { ...metadata, [STAFF_KEY]: String(staffId) } };
  }

  private async assertDeclared(
    purpose: UploadPurpose,
    staffId: number,
    fileName: string,
    size: number | undefined,
  ): Promise<void> {
    if (fileName === '') throw new AppError('ERP-VALIDATION-0001', 'filename is required');
    if (size === undefined) {
      throw new AppError(
        'ERP-VALIDATION-0001',
        'Upload-Length is required; a deferred length is refused',
      );
    }
    const rules = await this.rulesFor(purpose, staffId);
    if (!rules.extensions.includes(extensionOf(fileName))) throw new AppError('ERP-FILES-0001');
    if (size > rules.maxBytes) throw new AppError('ERP-FILES-0002');
  }

  private async finished(upload: Upload): Promise<{ headers: Record<string, string> }> {
    const { store } = this.configured();
    const metadata = upload.metadata ?? {};
    const purpose = this.registry.get(metadata[PURPOSE_KEY] ?? '');
    const staffId = Number(metadata[STAFF_KEY]);
    const fileName = metadata[FILENAME_KEY] ?? '';
    const extension = extensionOf(fileName);
    const staged = join(this.stagingDir, upload.id);
    if (purpose === undefined) return this.reject(upload, new AppError('ERP-VALIDATION-0001'));
    const rules = await this.rulesFor(purpose, staffId);
    const { size } = await stat(staged);
    if (size > rules.maxBytes) return this.reject(upload, new AppError('ERP-FILES-0002'));
    if (!(await sniffMatches(staged, extension, rules.extensions))) {
      return this.reject(upload, new AppError('ERP-FILES-0001'));
    }
    const mime = await mimeOf(staged, extension);
    const storageKey = newStorageKey(purpose.storageArea);
    await this.storage.putFile(storageKey, staged);
    await store.configstore.delete(upload.id);
    const checked: CheckedUpload = {
      uploadId: upload.id,
      purpose: purpose.name,
      staffId,
      fileName,
      size,
      mime,
      extension,
      storageKey,
      meta: purposeMetaOf(metadata),
    };
    const { resourceId } = await purpose.onComplete(checked).catch(async (error: unknown) => {
      await this.storage.delete(storageKey);
      throw error;
    });
    return { headers: { [UPLOAD_RESOURCE_HEADER]: resourceId } };
  }

  /** Removes the staged upload (bytes and metadata), then refuses. */
  private async reject(upload: Upload, error: AppError): Promise<never> {
    await this.configured().store.remove(upload.id);
    throw error;
  }

  /**
   * Runs a tus hook: an `AppError` becomes its own status and problem body; anything else is 500
   * `ERP-INTERNAL-0001` with no detail, its error name logged.
   */
  private async hook<T>(req: Request, run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof AppError) throw this.refusal(req, error);
      this.logger.error('upload hook failed', { errorName: (error as Error | null)?.name });
      throw this.refusal(req, new AppError('ERP-INTERNAL-0001', 'Internal error'));
    }
  }

  private refusal(req: Request, error: AppError): TusRefusal {
    this.problems.add(req);
    return new TusRefusal(error.status, JSON.stringify(problemBodyOf(error)));
  }

  /** tus's own 413 (the env limit) answers like the purpose limit; other tus errors stay as tus writes them. */
  private tusError(req: Request, error: unknown): TusRefusal | undefined {
    const status = (error as { status_code?: unknown }).status_code;
    if (this.problems.has(req) || status !== TOO_LARGE) return undefined;
    return this.refusal(req, new AppError('ERP-FILES-0002'));
  }

  private async assertHolds(staffId: number, purpose: UploadPurpose): Promise<void> {
    const held = await Promise.all(
      purpose.anyOf.map((code) => this.verifier.hasPermission(staffId, code)),
    );
    if (!held.includes(true)) {
      throw new AppError('ERP-AUTH-0005', `Missing permission ${purpose.anyOf.join(' or ')}`);
    }
  }

  /** The purpose's rules, never looser than the env limits (P-11). */
  private async rulesFor(purpose: UploadPurpose, staffId: number): Promise<UploadRules> {
    const rules = await purpose.rules(staffId);
    return {
      maxBytes: Math.min(rules.maxBytes, this.maxBytes),
      maxFiles: Math.min(rules.maxFiles, this.maxFiles),
      extensions: rules.extensions,
    };
  }
}
