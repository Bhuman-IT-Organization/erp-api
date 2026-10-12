/**
 * Requires a valid bearer access token (threat T-1.3-08). The header must match
 * `Bearer <token>` exactly; the verifier port does the cryptographic and Redis work and answers
 * `null` for any failure, which becomes ERP-AUTH-0004 without saying which check failed. On
 * success the verified `staffId` is bound to the request context so every later log line carries
 * it (T-2-03). Order on a handler: `@UseGuards(JwtAuthGuard, PermissionGuard)`.
 */
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../errors/app-error.js';
import { bindStaffId } from '../../logger/request-context.js';
import {
  ACCESS_TOKEN_VERIFIER,
  type AccessTokenVerifier,
  type AuthenticatedUser,
} from '../auth/access-token-verifier.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

const BEARER = /^Bearer\s+(\S+)$/i;

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(ACCESS_TOKEN_VERIFIER) private readonly verifier: AccessTokenVerifier) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    const match = typeof header === 'string' ? BEARER.exec(header) : null;
    const token = match?.[1];
    if (token === undefined) throw new AppError('ERP-AUTH-0004', 'Missing bearer token');
    const user = await this.verifier.verifyAccessToken(token);
    if (user === null) throw new AppError('ERP-AUTH-0004');
    request.user = user;
    bindStaffId(user.staffId);
    return true;
  }
}
