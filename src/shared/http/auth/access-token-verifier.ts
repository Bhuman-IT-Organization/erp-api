/**
 * Port implemented by `v1/auth`'s facade and provided under this token by `AuthModule`.
 * `shared/` never imports from `v1/`; the dependency points inward. The guards only call this
 * port — verifying the signature by `kid`, checking the token version and the revoked `jti`,
 * and reading the permission snapshot are the verifier's job.
 */

export interface AuthenticatedUser {
  readonly staffId: number;
  readonly sessionId: string;
  readonly jti: string;
  readonly isAdmin: boolean;
  readonly roleId: number | null;
  readonly tokenVersion: number;
  /** Epoch seconds from `exp`. */
  readonly expiresAt: number;
}

export interface AccessTokenVerifier {
  /** `null` on any failure (bad signature, expired, revoked, version mismatch); the guard maps it to ERP-AUTH-0004. */
  verifyAccessToken(token: string): Promise<AuthenticatedUser | null>;
  /** Admin implies true. */
  hasPermission(staffId: number, code: string): Promise<boolean>;
}

export const ACCESS_TOKEN_VERIFIER = Symbol('ACCESS_TOKEN_VERIFIER');
