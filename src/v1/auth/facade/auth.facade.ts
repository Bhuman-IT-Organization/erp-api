/**
 * Facade: the ONLY surface other modules may import (ADR-0001). It implements the
 * `AccessTokenVerifier` port of `shared/http/auth/`, which `AuthModule` provides under
 * `ACCESS_TOKEN_VERIFIER` so `JwtAuthGuard` and `PermissionGuard` resolve it in every module
 * without importing this one.
 */
import { Injectable } from '@nestjs/common';
import type {
  AccessTokenVerifier,
  AuthenticatedUser,
} from '../../../shared/http/auth/access-token-verifier.js';
import { AuthService, type AuthDescription } from '../service/auth.service.js';

@Injectable()
export class AuthFacade implements AccessTokenVerifier {
  constructor(private readonly service: AuthService) {}

  verifyAccessToken(token: string): Promise<AuthenticatedUser | null> {
    return this.service.verifyAccessToken(token);
  }

  hasPermission(staffId: number, code: string): Promise<boolean> {
    return this.service.hasPermission(staffId, code);
  }

  describe(): AuthDescription {
    return this.service.describe();
  }
}
