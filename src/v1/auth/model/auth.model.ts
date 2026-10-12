/**
 * Domain entity types for identity and sessions (ADR-0005). Mapped from Prisma's `tblstaff` row
 * in `repository/auth.repository.ts` (plan 07); nothing here is a DTO — `passwordHash` never
 * leaves the service layer and `Session` never leaves the store.
 */

/** A `tblstaff` row reduced to what login needs. `passwordHash` is the bcrypt string as stored. */
export interface StaffIdentity {
  readonly staffId: number;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly isAdmin: boolean;
  readonly roleId: number | null;
  readonly active: boolean;
  readonly twoFactorEnabled: boolean;
  readonly passwordHash: string;
  /** BCP-47 from `tblstaff.default_language` (`shared/config/legacy-locale.ts`); `null` when unset or unknown. */
  readonly locale: string | null;
}

/**
 * One device's session at `auth:sess:{staffId}:{sid}`. `refreshHash` is `sha256(secret)` hex —
 * the refresh token itself is never stored; `family` is the first `sid` of the rotation chain
 * (rotation keeps `sid` and `family`, replaces `refreshHash`). Timestamps are ISO strings.
 */
export interface Session {
  readonly sid: string;
  readonly family: string;
  readonly refreshHash: string;
  readonly device: string;
  readonly ip: string;
  readonly createdAt: string;
  readonly lastSeenAt: string;
  readonly expiresAt: string;
}

/** The private claims of an access token (`iss`/`aud`/`iat`/`exp` are the issuer's). */
export interface TokenClaims {
  readonly sub: string;
  readonly sid: string;
  readonly jti: string;
  readonly ver: number;
  readonly admin: boolean;
  readonly roles: readonly number[];
}

/** `auth:perm:{staffId}`: the `feature.capability` codes of `tblstaff_permissions` plus the admin bypass. */
export interface PermissionSnapshot {
  readonly v: 1;
  readonly staffId: number;
  readonly isAdmin: boolean;
  readonly roleId: number | null;
  readonly codes: readonly string[];
  readonly builtAt: string;
}

/** `auth:lockout:{email}`: failure counter and, once the threshold is reached, the lock's end (epoch ms). */
export interface Lockout {
  readonly failures: number;
  readonly lockedUntil: number | null;
}

/** What the service hands the controller after a successful login or refresh. */
export interface IssuedTokens {
  readonly accessToken: string;
  /** Seconds until the access token expires. */
  readonly expiresIn: number;
  /** `${staffId}.${sid}.${secretBase64url}` — set as the refresh cookie, never in a body or log. */
  readonly refreshToken: string;
  readonly jti: string;
  readonly sid: string;
}

export type StaffId = StaffIdentity['staffId'];
