/**
 * BE-15 Layer 1: a handler marked `@Idempotent()` runs at most
 * once per `(staff, Idempotency-Key)`.
 *
 * | Situation | Answer |
 * |---|---|
 * | no key, or not 16 to 128 of `[A-Za-z0-9_-]` | 400 `ERP-CORE-0010`, handler not run |
 * | first request | claim (`SET NX PX`, in progress), run, store status and body, `Idempotent-Replayed: false` |
 * | same key, same request, still running | 409 `ERP-CORE-0011` |
 * | same key, another method, URL or body | 422 `ERP-CORE-0012` |
 * | same key after completion | the stored status and body, `Idempotent-Replayed: true` |
 * | handler throws | the key is released so a retry runs; the error answers as problem details |
 * | store unreachable | 503 `ERP-UPSTREAM-0001` before the handler runs (fail closed) |
 *
 * It runs after the guards, so `request.user` is the verified caller; without one the route forgot
 * `JwtAuthGuard` and the answer is 401. The fingerprint is the sha-256 of the canonical JSON of the
 * method, the URL and the parsed body.
 */
import {
  HttpStatus,
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { HTTP_CODE_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { catchError, from, mergeMap, of, type Observable } from 'rxjs';
import { TIMINGS } from '../../config/timings.js';
import { AppError } from '../../errors/app-error.js';
import { canonicalJson } from '../etag.js';
import {
  IDEMPOTENCY_KEY_PATTERN,
  IDEMPOTENCY_STORE,
  idempotencyRedisKey,
  type IdempotencyStore,
} from './idempotency.store.js';

/** The metadata key `@Idempotent()` sets (re-exported by `idempotent.decorator.ts`). */
export const IDEMPOTENT_KEY = 'erp:idempotent';
/** The request header that carries the key. */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
/** The response header that tells a replay from a first run. */
export const IDEMPOTENT_REPLAYED_HEADER = 'Idempotent-Replayed';

function fingerprintOf(request: FastifyRequest): string {
  const shape = { method: request.method, url: request.url, body: request.body ?? null };
  return createHash('sha256').update(canonicalJson(shape)).digest('hex');
}

/** The keyed BE-15 interceptor; apply it with `@Idempotent()`, never directly. */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    @Inject(IDEMPOTENCY_STORE) private readonly store: IdempotencyStore,
  ) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (this.reflector.get<boolean | undefined>(IDEMPOTENT_KEY, context.getHandler()) !== true) {
      return next.handle();
    }
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    if (request.user === undefined) throw new AppError('ERP-AUTH-0004');
    const header = request.headers[IDEMPOTENCY_KEY_HEADER];
    if (typeof header !== 'string' || !IDEMPOTENCY_KEY_PATTERN.test(header)) {
      throw new AppError('ERP-CORE-0010');
    }
    const key = idempotencyRedisKey(request.user.staffId, header);
    const fingerprint = fingerprintOf(request);
    const claimed = await this.guarded(() =>
      this.store.claim(key, fingerprint, TIMINGS.idempotency.inProgressTtlMs),
    );
    if (!claimed) return of(await this.answerTaken(key, fingerprint, reply));
    const status = this.statusOf(context, request.method);
    return next.handle().pipe(
      mergeMap((body: unknown) => from(this.finish(key, fingerprint, status, body, reply))),
      catchError((error: unknown) => from(this.releaseAndRethrow(key, error))),
    );
  }

  /** The key is already claimed: 409 while it runs, 422 for another request, else the replay. */
  private async answerTaken(
    key: string,
    fingerprint: string,
    reply: FastifyReply,
  ): Promise<unknown> {
    const record = await this.guarded(() => this.store.read(key));
    if (record !== null && record.fingerprint !== fingerprint) throw new AppError('ERP-CORE-0012');
    // Absent here means it was released or expired between the claim and the read: still busy.
    if (record?.state !== 'done') throw new AppError('ERP-CORE-0011');
    void reply.status(record.status).header(IDEMPOTENT_REPLAYED_HEADER, 'true');
    return record.body;
  }

  private async finish(
    key: string,
    fingerprint: string,
    status: number,
    body: unknown,
    reply: FastifyReply,
  ): Promise<unknown> {
    // ponytail: a store that fails after the handler succeeded must not turn a done write into an
    // error the client retries; the in-progress claim then expires after inProgressTtlMs.
    await this.store
      .complete(key, { state: 'done', fingerprint, status, body }, TIMINGS.idempotency.replayTtlMs)
      .catch(() => undefined);
    void reply.header(IDEMPOTENT_REPLAYED_HEADER, 'false');
    return body;
  }

  private async releaseAndRethrow(key: string, error: unknown): Promise<never> {
    await this.store.release(key).catch(() => undefined);
    throw error;
  }

  /** The handler's `@HttpCode`, else Nest's default: 201 for a POST, 200 otherwise. */
  private statusOf(context: ExecutionContext, method: string): number {
    const declared = this.reflector.get<number | undefined>(
      HTTP_CODE_METADATA,
      context.getHandler(),
    );
    return declared ?? (method === 'POST' ? HttpStatus.CREATED : HttpStatus.OK);
  }

  /** A store call; any rejection is 503 `ERP-UPSTREAM-0001` (fail closed, T-4.2-31). */
  private async guarded<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch {
      throw new AppError('ERP-UPSTREAM-0001', 'idempotency store unavailable');
    }
  }
}
