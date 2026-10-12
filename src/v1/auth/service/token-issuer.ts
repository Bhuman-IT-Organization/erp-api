/**
 * RS256 access tokens with a `kid` and the JWKS document (ADR-0005), on `jose`.
 *
 * The private key arrives as base64 of a PKCS8 PEM in `AUTH_JWT_PRIVATE_KEY_PEM` (rendered per
 * machine by erp-infra, never committed). It is imported once in `init()` and lives only in this
 * instance: imported non-extractable, never logged, never exported. The public JWK is derived
 * from the public half (`createPublicKey`) and reduced to `kty`, `n`, `e` — private members
 * (`d/p/q/dp/dq/qi`) are never materialised, so they cannot reach the JWKS (T-1.3-26). `kid` is
 * the RFC 7638 thumbprint of that public JWK.
 *
 * `verify` pins `algorithms: ['RS256']` so an HS256 token signed with the public key as the
 * secret (`alg` confusion, T-1.3-25) and an `alg: none` token are rejected by construction; it
 * answers `null` on every failure so the guard cannot leak which check failed.
 */
import { createPublicKey } from 'node:crypto';
import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import {
  SignJWT,
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  importPKCS8,
  jwtVerify,
  type CryptoKey,
} from 'jose';
import { z } from 'zod';
import { AppConfig } from '../../../shared/config/app-config.js';
import { TIMINGS } from '../../../shared/config/timings.js';
import type { JwksResponseDto } from '../dto/auth.dto.js';
import type { TokenClaims } from '../model/auth.model.js';

const ALG = 'RS256';
/** Seconds of clock skew tolerated between the issuer and a verifier (ADR-0005 verifiers include the legacy container). */
const CLOCK_TOLERANCE_S = 5;
/** JWT `iat`/`exp` are epoch seconds; `TIMINGS` and `Date.now()` are milliseconds. */
const MS_PER_SECOND = 1_000;

export interface TokenIssuerOptions {
  privateKeyPemBase64: string;
  issuer: string;
  audience: string;
  accessTtlMs: number;
}

/** Optional provider token for explicit options (tests, or a module that signs with another key). */
export const TOKEN_ISSUER_OPTIONS = Symbol('TOKEN_ISSUER_OPTIONS');

const verifiedClaimsSchema = z.object({
  sub: z.string(),
  sid: z.string(),
  jti: z.string(),
  ver: z.number().int(),
  admin: z.boolean(),
  roles: z.array(z.number().int()),
  exp: z.number().int(),
});

export type VerifiedClaims = TokenClaims & { readonly exp: number };

@Injectable()
export class TokenIssuer implements OnModuleInit {
  private readonly options: TokenIssuerOptions;
  private privateKey: CryptoKey | null = null;
  private jwksDocument: JwksResponseDto | null = null;
  private keySet: ReturnType<typeof createLocalJWKSet> | null = null;
  private keyId: string | null = null;

  /**
   * Nest injects `AppConfig`; `create()` passes explicit options instead (the `LoggerService`
   * precedent for a class that is constructible both ways). One of the two must be present.
   */
  constructor(
    @Optional() config?: AppConfig,
    @Optional() @Inject(TOKEN_ISSUER_OPTIONS) options?: TokenIssuerOptions,
  ) {
    if (options !== undefined) {
      this.options = options;
    } else if (config !== undefined) {
      this.options = {
        privateKeyPemBase64: config.env.AUTH_JWT_PRIVATE_KEY_PEM,
        issuer: config.env.AUTH_JWT_ISSUER,
        audience: config.env.AUTH_JWT_AUDIENCE,
        accessTtlMs: TIMINGS.auth.accessTokenTtlMs,
      };
    } else {
      throw new Error('TokenIssuer needs AppConfig or TokenIssuerOptions');
    }
  }

  /** For tests: an initialised issuer from explicit options, no `AppConfig`. */
  static async create(options: TokenIssuerOptions): Promise<TokenIssuer> {
    const issuer = new TokenIssuer(undefined, options);
    await issuer.init();
    return issuer;
  }

  async onModuleInit(): Promise<void> {
    await this.init();
  }

  /** Decodes the PEM, imports the private key, derives the public JWK, its thumbprint and the JWKS. */
  async init(): Promise<void> {
    const pem = Buffer.from(this.options.privateKeyPemBase64, 'base64').toString('utf8');
    const privateKey = await importPKCS8(pem, ALG);
    const { kty, n, e } = await exportJWK(createPublicKey(pem));
    if (kty !== 'RSA' || n === undefined || e === undefined) {
      throw new Error('TokenIssuer needs an RSA private key');
    }
    const publicJwk = { kty: 'RSA', n, e } as const;
    const kid = await calculateJwkThumbprint(publicJwk);
    const key: JwksResponseDto['keys'][number] = { ...publicJwk, alg: ALG, use: 'sig', kid };
    const jwks: JwksResponseDto = Object.freeze({ keys: [Object.freeze(key)] });
    this.privateKey = privateKey;
    this.keyId = kid;
    this.jwksDocument = jwks;
    this.keySet = createLocalJWKSet(jwks);
  }

  get kid(): string {
    if (this.keyId === null) throw new Error('TokenIssuer not initialised');
    return this.keyId;
  }

  /** Signs the claims; `expiresAt` is epoch seconds (`iat + TIMINGS.auth.accessTokenTtlMs / 1000`). */
  async sign(claims: TokenClaims): Promise<{ token: string; expiresAt: number }> {
    if (this.privateKey === null || this.keyId === null) {
      throw new Error('TokenIssuer not initialised');
    }
    const now = Math.floor(Date.now() / MS_PER_SECOND);
    const expiresAt = now + Math.floor(this.options.accessTtlMs / MS_PER_SECOND);
    const token = await new SignJWT({
      sid: claims.sid,
      ver: claims.ver,
      admin: claims.admin,
      roles: [...claims.roles],
    })
      .setProtectedHeader({ alg: ALG, kid: this.keyId, typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuer(this.options.issuer)
      .setAudience(this.options.audience)
      .setJti(claims.jti)
      .setIssuedAt(now)
      .setExpirationTime(expiresAt)
      .sign(this.privateKey);
    return { token, expiresAt };
  }

  /** RS256 only, issuer and audience pinned; `null` on any failure, never throws. */
  async verify(token: string): Promise<VerifiedClaims | null> {
    if (this.keySet === null) throw new Error('TokenIssuer not initialised');
    try {
      const { payload } = await jwtVerify(token, this.keySet, {
        algorithms: ['RS256'],
        issuer: this.options.issuer,
        audience: this.options.audience,
        clockTolerance: CLOCK_TOLERANCE_S,
      });
      const parsed = verifiedClaimsSchema.safeParse(payload);
      if (!parsed.success) return null;
      const { sub, sid, jti, ver, admin, roles, exp } = parsed.data;
      return { sub, sid, jti, ver, admin, roles, exp };
    } catch {
      return null;
    }
  }

  /** The public JWKS document served at `/.well-known/jwks.json`. */
  jwks(): JwksResponseDto {
    if (this.jwksDocument === null) throw new Error('TokenIssuer not initialised');
    return this.jwksDocument;
  }
}
