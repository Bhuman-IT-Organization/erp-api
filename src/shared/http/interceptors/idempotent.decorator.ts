/**
 * `@Idempotent()` marks a keyed handler (BE-15 Layer 1): the request must carry `Idempotency-Key`
 * and runs at most once per staff member and key (`IdempotencyInterceptor`). Put it after
 * `@UseGuards(JwtAuthGuard, ...)`; the interceptor reads the verified `request.user`.
 */
import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { IDEMPOTENT_KEY, IdempotencyInterceptor } from './idempotency.interceptor.js';

export { IDEMPOTENT_KEY };

/** Makes a handler idempotent by `Idempotency-Key` (BE-15). */
export const Idempotent = (): MethodDecorator =>
  applyDecorators(SetMetadata(IDEMPOTENT_KEY, true), UseInterceptors(IdempotencyInterceptor));
