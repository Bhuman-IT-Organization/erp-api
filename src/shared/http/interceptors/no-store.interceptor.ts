/**
 * No cache and no index on every answer of an anonymous surface (ADR-0051 decision 8, T-4.7-49):
 * `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow` are set on the reply BEFORE the
 * handler runs, so a thrown error's problem answer (404 and 5xx included) keeps them; `@Header()`
 * applies only to a handler that returns. Opt-in per controller with
 * `@UseInterceptors(NoStoreInterceptor)`. Guards run before interceptors, so a guard that refuses
 * on such a surface sets the same headers itself with `setNoStore` (`ModuleEnabledGuard` under
 * `@ModuleOffNotFound()`).
 */
import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type { Observable } from 'rxjs';

/** Sets both headers on the reply (ADR-0051 decision 8). */
export function setNoStore(reply: FastifyReply): void {
  void reply.header('Cache-Control', 'no-store').header('X-Robots-Tag', 'noindex, nofollow');
}

/** Sets Cache-Control: no-store and X-Robots-Tag: noindex, nofollow on the reply BEFORE the handler runs, so a thrown error's problem answer keeps them (ADR-0051 decision 8). */
@Injectable()
export class NoStoreInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    setNoStore(context.switchToHttp().getResponse<FastifyReply>());
    return next.handle();
  }
}
